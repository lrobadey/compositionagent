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

    const fakeFetch: any = async (_url: string, init: any) => {
      callIndex += 1;

      if (callIndex === 1) {
        return { ok: true, status: 200, json: async () => ({ id: "resp1", output: [{ type: "function_call", call_id: "c1", name: "get_scope_summary", arguments: JSON.stringify({ scopeId }) }] }) };
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
                name: "add_notes",
                arguments: JSON.stringify({ scopeId, notes: [{ pitch: 60, startTick: 0, durationTicks: 120, velocity: 0.5 }] })
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
          output: [{ type: "function_call", call_id: "c3", name: "finalize_proposal", arguments: JSON.stringify({ scopeId, musicalSummary: "ok" }) }]
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
  });
});
