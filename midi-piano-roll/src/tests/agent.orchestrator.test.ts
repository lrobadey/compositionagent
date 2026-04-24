import { describe, expect, it } from "vitest";

import type { ProjectState } from "../lib/compose/state";
import { runComposerAgent } from "../lib/agent/orchestrator";

const mkState = (): ProjectState => ({
  ppq: 480,
  tempos: [{ tick: 0, bpm: 120 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  tracks: [
    {
      trackIndex: 0,
      name: "Track 1",
      channel: 0,
      notes: []
    }
  ],
  maxTick: 0
});

describe("orchestrator", () => {
  it("loops tool calls and returns a proposal after finalize", async () => {
    let callIndex = 0;
    const scopeId = "SCOPE";
    let firstBody: any = null;

    const fakeFetch: any = async (_url: string, init: any) => {
      callIndex += 1;
      if (callIndex === 1) firstBody = JSON.parse(init.body);

      if (callIndex === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "resp1", output: [{ type: "function_call", call_id: "c1", name: "review_notes", arguments: JSON.stringify({ scopeId, barStart: null, barEnd: null, limit: 200 }) }] }) };
      }
      if (callIndex === 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "resp2",
            output: [
              {
                type: "function_call",
                call_id: "c2",
                name: "place_note",
                arguments: JSON.stringify({ scopeId, notes: [{ id: null, pitchName: "C4", bar: 1, beat: 1, duration: "quarter", velocity: 0.5 }] })
              }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp3",
          output: [{ type: "function_call", call_id: "c3", name: "finalize_composition_run", arguments: JSON.stringify({ scopeId, musicalSummary: "ok" }) }]
        })
      };
    };

    const proposal = await runComposerAgent({
      userPrompt: "add one note",
      scope: { trackIndex: 0, tickStart: 0, tickEnd: 1920 },
      liveState: mkState(),
      fetchFn: fakeFetch,
      stream: false,
      proxyUrl: "http://127.0.0.1:8787/api/openai/responses",
      scopeIdOverride: scopeId
    });

    expect(proposal.ops.length).toBe(1);
    expect(proposal.draftState.tracks[0]!.notes.length).toBe(1);
    expect(proposal.draftState.tracks[0]!.notes[0]!.pitch).toBe(60);
    expect(firstBody.tools.map((t: any) => t.name)).toEqual([
      "place_note",
      "review_notes",
      "edit_note",
      "delete_notes",
      "finalize_composition_run"
    ]);
    expect(firstBody.instructions).toContain("4/4 time");
    expect(firstBody.instructions).toContain("8 bars");
    expect(firstBody.instructions).toContain("Form a short internal plan");
    expect(firstBody.instructions).toContain("1-3 notes per tool call");
    expect(firstBody.instructions).toContain("Review your work");
  });
});
