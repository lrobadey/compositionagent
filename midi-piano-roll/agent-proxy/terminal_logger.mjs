const ANSI = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

const MUTATING_TOOLS = new Set([
  "add_notes",
  "delete_notes",
  "move_notes",
  "resize_notes",
  "set_velocity",
  "clear_range",
  "quantize",
  "humanize",
  "add_chord_progression",
  "arpeggiate",
  "add_drums_pattern"
]);

function clip(s, maxChars) {
  if (typeof s !== "string") return "";
  if (s.length <= maxChars) return s;
  return `${s.slice(0, Math.max(0, maxChars - 3))}...`;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeMode(raw) {
  if (!raw) return "off";
  if (raw === "1") return "pretty";
  if (raw === "0") return "off";
  if (raw === "pretty" || raw === "raw" || raw === "off") return raw;
  return "off";
}

function fmtKv(obj) {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

export function createTerminalLogger(opts) {
  const mode = normalizeMode(opts?.mode);
  const showDeltas = Boolean(opts?.showDeltas);
  const maxChars = Number.isFinite(opts?.maxChars) ? Math.max(50, Math.floor(opts.maxChars)) : 400;
  const showOutputs = opts?.showOutputs == null ? true : Boolean(opts.showOutputs);
  const write = typeof opts?.write === "function" ? opts.write : console.log;

  let turnCounter = 0;
  let stepCount = 0;
  /** @type {Map<string,string>} */
  const callIdToName = new Map();
  /** @type {Map<string,string>} */
  const callIdToArgsSoFar = new Map();
  /** @type {Set<string>} */
  const loggedToolOutputs = new Set(); // call_id
  /** @type {Map<string,number>} */
  const lastDeltaPrintAt = new Map(); // call_id -> ms

  let inTurn = false;
  let currentRespId = "";
  let sseBuf = "";

  const enabled = mode !== "off";

  function line(s = "") {
    write(s);
  }

  function header(meta) {
    if (!enabled) return;
    turnCounter += 1;
    inTurn = true;
    currentRespId = "";
    const model = meta?.model ? String(meta.model) : "";
    const stepMode = meta?.stepMode ? " stepMode" : "";
    line(`${ANSI.cyan}${ANSI.bold}+-- TURN ${turnCounter}${ANSI.reset}${ANSI.gray}${stepMode}${ANSI.reset}${model ? ` ${ANSI.dim}model=${model}${ANSI.reset}` : ""}`);
  }

  function footer() {
    if (!enabled) return;
    if (!inTurn) return;
    const resp = currentRespId ? ` resp=${currentRespId}` : "";
    line(`${ANSI.cyan}+-- done${ANSI.reset}${ANSI.gray}${resp}${ANSI.reset}`);
    inTurn = false;
  }

  function sub(prefix, text, color = "") {
    if (!enabled) return;
    const c = color || "";
    line(`${ANSI.gray}|${ANSI.reset} ${c}${prefix}${ANSI.reset}${text ? ` ${text}` : ""}`);
  }

  function toolSummary(name, argsObj) {
    if (name === "composer_thought") {
      const t = typeof argsObj?.text === "string" ? argsObj.text.trim() : "";
      return { kind: "thought", text: t };
    }
    if (name === "add_notes") {
      const notes = Array.isArray(argsObj?.notes) ? argsObj.notes : [];
      const preview = notes.slice(0, 2).map((n) => ({
        pitch: n?.pitch,
        startTick: n?.startTick,
        durationTicks: n?.durationTicks
      }));
      return { kind: "add_notes", count: notes.length, preview };
    }
    return { kind: "tool", args: argsObj };
  }

  function printToolDone(name, callId, argsText) {
    if (!enabled) return;
    const argsObj = safeJsonParse(argsText);
    const sum = toolSummary(name, argsObj);
    if (sum.kind === "thought") {
      sub(`${ANSI.magenta}THOUGHT${ANSI.reset}`, clip(sum.text, maxChars));
      return;
    }
    if (sum.kind === "add_notes") {
      const extra = sum.preview?.length ? ` preview=${fmtKv(sum.preview)}` : "";
      sub(`${ANSI.yellow}add_notes${ANSI.reset}`, `${sum.count} notes${extra}`);
      return;
    }
    sub(`${ANSI.yellow}${name}${ANSI.reset}`, argsObj ? clip(fmtKv(argsObj), maxChars) : clip(argsText, maxChars));
  }

  function printToolResult(callId, outputText) {
    if (!enabled || !showOutputs) return;
    if (loggedToolOutputs.has(callId)) return;
    loggedToolOutputs.add(callId);

    const obj = safeJsonParse(outputText);
    const toolName = callIdToName.get(callId) ?? "tool";
    const ok = Boolean(obj?.ok);
    const err = typeof obj?.error === "string" ? obj.error : "";
    const warnings = Array.isArray(obj?.warnings) ? obj.warnings : [];

    if (ok && MUTATING_TOOLS.has(toolName)) stepCount += 1;

    const status = ok ? `${ANSI.green}ok${ANSI.reset}` : `${ANSI.red}fail${ANSI.reset}`;
    const step = MUTATING_TOOLS.has(toolName) ? ` ${ANSI.gray}(Step ${stepCount})${ANSI.reset}` : "";
    const errPart = err ? ` ${ANSI.red}error=${ANSI.reset}${clip(err, maxChars)}` : "";
    const warnPart = warnings.length ? ` ${ANSI.yellow}warnings=${ANSI.reset}${warnings.length}` : "";
    sub(`${ANSI.blue}RESULT${ANSI.reset}`, `${toolName} ${status}${step}${errPart}${warnPart}`);
  }

  function onRequestJson(json) {
    if (!enabled) return;
    if (!json || typeof json !== "object") return;

    const model = typeof json.model === "string" ? json.model : "";
    const stepMode = typeof json.instructions === "string" && json.instructions.includes("YOU ARE IN STEP MODE");

    // Starting a new request implies a new turn.
    if (!inTurn) header({ model, stepMode });

    const input = Array.isArray(json.input) ? json.input : [];
    for (const it of input) {
      if (!it || typeof it !== "object") continue;
      if (it.type === "function_call") {
        if (typeof it.call_id === "string" && typeof it.name === "string") callIdToName.set(it.call_id, it.name);
      }
      if (it.type === "function_call_output") {
        if (typeof it.call_id === "string" && typeof it.output === "string") {
          printToolResult(it.call_id, it.output);
        }
      }
    }
  }

  function onSseEvent(obj) {
    if (!enabled) return;
    if (mode === "raw") {
      line(`${ANSI.dim}${fmtKv(obj)}${ANSI.reset}`);
      return;
    }

    const t = obj?.type;
    if (typeof obj?.response_id === "string") currentRespId = obj.response_id;
    if (t === "response.output_item.added") {
      const item = obj?.item;
      if (item?.type === "function_call") {
        const name = typeof item.name === "string" ? item.name : "tool";
        const callId = typeof item.call_id === "string" ? item.call_id : "";
        if (callId) {
          callIdToName.set(callId, name);
          callIdToArgsSoFar.set(callId, "");
        }
        sub(`${ANSI.cyan}CALL${ANSI.reset}`, name, ANSI.cyan);
      }
      return;
    }
    if (t === "response.function_call_arguments.delta") {
      const delta = typeof obj?.delta === "string" ? obj.delta : "";
      const itemId = typeof obj?.item_id === "string" ? obj.item_id : "";
      const outputIndex = typeof obj?.output_index === "number" ? obj.output_index : null;
      // We prefer call_id mapping, but streaming events provide item_id. We'll just keep a per-item buffer too.
      const key = itemId || String(outputIndex ?? "");
      const prev = callIdToArgsSoFar.get(key) ?? "";
      const next = `${prev}${delta}`;
      callIdToArgsSoFar.set(key, next);

      if (!showDeltas || !delta) return;
      const now = Date.now();
      const last = lastDeltaPrintAt.get(key) ?? 0;
      if (now - last < 80) return;
      lastDeltaPrintAt.set(key, now);
      sub(`${ANSI.gray}delta${ANSI.reset}`, clip(delta.replace(/\s+/g, " "), maxChars), ANSI.gray);
      return;
    }
    if (t === "response.function_call_arguments.done") {
      // We print on output_item.done since that's what we execute on; keep this silent.
      return;
    }
    if (t === "response.output_item.done") {
      const item = obj?.item;
      if (item?.type === "function_call") {
        const name = typeof item.name === "string" ? item.name : "tool";
        const callId = typeof item.call_id === "string" ? item.call_id : "";
        const argsText = typeof item.arguments === "string" ? item.arguments : "";
        if (callId) callIdToName.set(callId, name);
        printToolDone(name, callId, argsText);
      }
      return;
    }
    if (t === "response.done") {
      footer();
      return;
    }
  }

  function flushSseFramesFromBuf() {
    for (;;) {
      const sep = sseBuf.search(/\r?\n\r?\n/);
      if (sep === -1) return;
      const frame = sseBuf.slice(0, sep);
      sseBuf = sseBuf.slice(sep).replace(/^\r?\n\r?\n/, "");
      const dataLines = frame
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""));
      if (dataLines.length === 0) continue;
      const data = dataLines.join("\n");
      if (data === "[DONE]") continue;
      const obj = safeJsonParse(data);
      if (obj) onSseEvent(obj);
      else if (mode === "raw") line(`${ANSI.dim}${data}${ANSI.reset}`);
    }
  }

  function onSseChunkText(textChunk) {
    if (!enabled) return;
    if (typeof textChunk !== "string" || textChunk.length === 0) return;
    sseBuf += textChunk;
    flushSseFramesFromBuf();
  }

  function close() {
    if (!enabled) return;
    if (sseBuf.trim()) flushSseFramesFromBuf();
    footer();
  }

  return {
    enabled,
    onRequestJson,
    onSseEvent,
    onSseChunkText,
    close
  };
}
