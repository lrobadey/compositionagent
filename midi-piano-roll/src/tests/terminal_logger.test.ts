import { describe, expect, it } from "vitest";

// Node-only helper used by the dev proxy/vite route.
import { createTerminalLogger } from "../../agent-proxy/terminal_logger.mjs";

describe("terminal_logger", () => {
  it("pretty-prints thought + add_notes and logs tool outputs from next request", () => {
    const lines: string[] = [];
    const logger = createTerminalLogger({
      mode: "pretty",
      showDeltas: false,
      maxChars: 200,
      showOutputs: true,
      write: (s: string) => lines.push(s)
    });

    // Request starts a turn and includes a tool output for a previous call.
    logger.onRequestJson({
      model: "gpt-5.2",
      instructions: "YOU ARE IN STEP MODE",
      input: [
        { type: "function_call", call_id: "c_prev", name: "add_notes", arguments: "{}" },
        { type: "function_call_output", call_id: "c_prev", output: JSON.stringify({ ok: true }) }
      ]
    });

    // Streamed response events
    const sse = [
      `data: ${JSON.stringify({ type: "response.output_item.added", response_id: "resp_1", output_index: 0, item: { type: "function_call", id: "fc1", call_id: "c1", name: "composer_thought", arguments: "" } })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_item.done", response_id: "resp_1", output_index: 0, item: { type: "function_call", id: "fc1", call_id: "c1", name: "composer_thought", arguments: JSON.stringify({ scopeId: "S", text: "place a small motif" }) } })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_item.added", response_id: "resp_1", output_index: 1, item: { type: "function_call", id: "fc2", call_id: "c2", name: "add_notes", arguments: "" } })}\n\n`,
      `data: ${JSON.stringify({ type: "response.output_item.done", response_id: "resp_1", output_index: 1, item: { type: "function_call", id: "fc2", call_id: "c2", name: "add_notes", arguments: JSON.stringify({ scopeId: "S", notes: [{ pitch: 60, startTick: 0, durationTicks: 120, velocity: 0.5 }] }) } })}\n\n`,
      `data: ${JSON.stringify({ type: "response.done", response_id: "resp_1" })}\n\n`
    ].join("");

    logger.onSseChunkText(sse);
    logger.close();

    const joined = lines.join("\n");
    expect(joined).toContain("TURN");
    expect(joined).toContain("CALL");
    expect(joined).toContain("THOUGHT");
    expect(joined).toContain("add_notes");
    expect(joined).toContain("RESULT");
  });
});

