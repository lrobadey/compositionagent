import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
// Node-only helper for pretty terminal streaming logs (optional; controlled via env vars).
import { createTerminalLogger } from "./agent-proxy/terminal_logger.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadAgentProxyDotEnvIfPresent(): void {
  // Convenience for local dev: if OPENAI_API_KEY isn't already set, load it from agent-proxy/.env.
  // This keeps the key server-side (Vite dev server) and avoids requiring a separate proxy process.
  if (process.env.OPENAI_API_KEY) return;

  const envPath = path.resolve(__dirname, "agent-proxy/.env");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!key || value.length === 0) continue;
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

function openAiResponsesRoute(): Plugin {
  const MAX_BODY_BYTES = 1_000_000;
  const logger = createTerminalLogger({
    mode: process.env.AGENT_PROXY_LOG_STREAM,
    showDeltas: process.env.AGENT_PROXY_LOG_DELTAS === "1",
    maxChars: Number(process.env.AGENT_PROXY_LOG_MAX_CHARS ?? "400"),
    showOutputs: process.env.AGENT_PROXY_LOG_INPUT_OUTPUTS == null ? true : process.env.AGENT_PROXY_LOG_INPUT_OUTPUTS !== "0"
  });

  return {
    name: "local-openai-responses-route",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        if (url !== "/api/openai/responses") return next();

        if (req.method === "OPTIONS") {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "method_not_allowed" }));
          return;
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "missing_OPENAI_API_KEY" }));
          return;
        }

        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buf.length;
          if (size > MAX_BODY_BYTES) req.destroy();
          chunks.push(buf);
        });

        try {
          await new Promise<void>((resolve, reject) => {
            req.on("end", () => resolve());
            req.on("error", (e) => reject(e));
            req.on("close", () => resolve());
          });
        } catch (e) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "request_error", message: String(e) }));
          return;
        }

        if (size > MAX_BODY_BYTES) {
          res.statusCode = 413;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "request_too_large" }));
          return;
        }

        const bodyText = Buffer.concat(chunks).toString("utf8");
        let json: any = null;
        try {
          json = JSON.parse(bodyText || "{}");
        } catch {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "invalid_json" }));
          return;
        }

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

          const wantsStream = Boolean(json?.stream);
          const upstreamType = upstream.headers.get("content-type") ?? "application/json";
          const isSse = upstreamType.includes("text/event-stream");

          res.statusCode = upstream.status;
          res.setHeader("Content-Type", upstreamType);
          res.setHeader("Cache-Control", wantsStream ? "no-cache, no-store" : "no-store");

          if (wantsStream && isSse && upstream.body) {
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
    }
  };
}

loadAgentProxyDotEnvIfPresent();

export default defineConfig({
  plugins: [openAiResponsesRoute()],
  server: {
    port: 5173,
    strictPort: true
  }
});
