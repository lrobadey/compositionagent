import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { createTerminalLogger } from "./terminal_logger.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.AGENT_PROXY_PORT ?? "8787");
const MAX_BODY_BYTES = 1_000_000;
const RATE_LIMIT_PER_MIN = 30;

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Missing OPENAI_API_KEY in environment.");
}

const logger = createTerminalLogger({
  mode: process.env.AGENT_PROXY_LOG_STREAM,
  showDeltas: process.env.AGENT_PROXY_LOG_DELTAS === "1",
  maxChars: Number(process.env.AGENT_PROXY_LOG_MAX_CHARS ?? "400"),
  showOutputs: process.env.AGENT_PROXY_LOG_INPUT_OUTPUTS == null ? true : process.env.AGENT_PROXY_LOG_INPUT_OUTPUTS !== "0"
});

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowedOrigins = new Set(
  (process.env.AGENT_PROXY_ORIGINS && process.env.AGENT_PROXY_ORIGINS.trim()
    ? process.env.AGENT_PROXY_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : process.env.AGENT_PROXY_ORIGIN && process.env.AGENT_PROXY_ORIGIN.trim()
      ? [process.env.AGENT_PROXY_ORIGIN.trim()]
      : DEFAULT_ALLOWED_ORIGINS
  ).map((s) => s.replace(/\/+$/, ""))
);

/** @type {Map<string, {count: number, resetAt: number}>} */
const rate = new Map();

function nowMs() {
  return Date.now();
}

function ipOf(req) {
  return req.socket?.remoteAddress ?? "unknown";
}

function checkRate(ip) {
  const n = nowMs();
  const r = rate.get(ip);
  if (!r || n >= r.resetAt) {
    rate.set(ip, { count: 1, resetAt: n + 60_000 });
    return { ok: true };
  }
  if (r.count >= RATE_LIMIT_PER_MIN) return { ok: false, retryAfterSec: Math.ceil((r.resetAt - n) / 1000) };
  r.count += 1;
  return { ok: true };
}

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody(req) {
  let size = 0;
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin.replace(/\/+$/, "") : "";
  const isAllowedOrigin = origin ? allowedOrigins.has(origin) : true;
  // Always set CORS headers when Origin is present so browsers can read error JSON.
  if (origin) setCors(res, origin);

  if (req.method === "OPTIONS") {
    res.statusCode = origin && isAllowedOrigin ? 204 : 403;
    res.end();
    return;
  }

  if (origin && !isAllowedOrigin) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "forbidden_origin", allowed: Array.from(allowedOrigins) }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/api/openai/responses") {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const ip = ipOf(req);
  const rl = checkRate(ip);
  if (!rl.ok) {
    res.statusCode = 429;
    res.setHeader("Retry-After", String(rl.retryAfterSec ?? 60));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "rate_limited" }));
    return;
  }

  if (!apiKey) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "missing_OPENAI_API_KEY" }));
    return;
  }

  let bodyText = "";
  try {
    bodyText = await readBody(req);
  } catch (e) {
    res.statusCode = 413;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "request_too_large" }));
    return;
  }

  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "invalid_json" }));
    return;
  }

  // Light hardening: don't allow callers to override model via URL, only via body (still validated by OpenAI).
  try {
    if (logger.enabled) logger.onRequestJson(json);

    const abort = new AbortController();
    const abortUpstream = () => abort.abort();
    req.once("close", abortUpstream);
    res.once("close", abortUpstream);

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(json),
      signal: abort.signal
    });

    res.statusCode = upstream.status;
    const upstreamType = upstream.headers.get("content-type") ?? "application/json";
    res.setHeader("Content-Type", upstreamType);
    res.setHeader("Cache-Control", "no-store");

    const wantsStream = Boolean(json?.stream);
    const isSse = upstreamType.includes("text/event-stream");

    if (wantsStream && isSse && upstream.body) {
      res.setHeader("Cache-Control", "no-cache, no-store");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      const reader = upstream.body.getReader();
      const decoder = logger.enabled ? new TextDecoder("utf-8") : null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            if (decoder && logger.enabled) logger.onSseChunkText(decoder.decode(value, { stream: true }));
            res.write(Buffer.from(value));
          }
        }
      } finally {
        if (decoder && logger.enabled) logger.onSseChunkText(decoder.decode());
        if (logger.enabled) logger.close();
        res.end();
        req.off("close", abortUpstream);
        res.off("close", abortUpstream);
      }
      return;
    }

    const text = await upstream.text();
    res.end(text);
    if (logger.enabled) logger.close();
  } catch (e) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "upstream_error", message: String(e) }));
    if (logger.enabled) logger.close();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Agent proxy listening on http://${HOST}:${PORT}`);
  console.log(`Allowing Origins: ${Array.from(allowedOrigins).join(", ")}`);
});

// periodic cleanup
(async () => {
  for (;;) {
    await delay(60_000);
    const n = nowMs();
    for (const [ip, r] of rate.entries()) if (n >= r.resetAt) rate.delete(ip);
  }
})();
