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
  maxTick: 480 * 4 * 8
});

describe("step mode", () => {
  it("rejects add_notes over the per-step limit", async () => {
    let callIndex = 0;
    const scopeId = "SCOPE";

    const fakeFetch: any = async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "resp1",
            output: [
              {
                type: "function_call",
                call_id: "c1",
                name: "add_notes",
                arguments: JSON.stringify({
                  scopeId,
                  notes: Array.from({ length: 5 }).map((_, i) => ({
                    id: null,
                    pitch: 60 + i,
                    startTick: i * 120,
                    durationTicks: 120,
                    velocity: 0.5
                  }))
                })
              }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp2",
          output: [
            {
              type: "function_call",
              call_id: "c2",
              name: "finalize_proposal",
              arguments: JSON.stringify({ scopeId, musicalSummary: "ok" })
            }
          ]
        })
      };
    };

    const proposal = await runComposerAgent({
      userPrompt: "add notes",
      scope: { trackIndex: 0, tickStart: 0, tickEnd: 1920 },
      liveState: mkState(),
      fetchFn: fakeFetch,
      scopeIdOverride: scopeId,
      stream: false,
      stepMode: true,
      stepMaxNotesPerAdd: 4,
      stepMaxSteps: 64,
      maxToolCalls: 50
    });

    expect(proposal.ops.length).toBe(0);
    expect(proposal.draftState.tracks[0]!.notes.length).toBe(0);
    expect(proposal.musicalSummary).toBe("ok");
  });

  it("skips additional mutating tool calls in the same response", async () => {
    let callIndex = 0;
    const scopeId = "SCOPE";

    const fakeFetch: any = async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "resp1",
            output: [
              {
                type: "function_call",
                call_id: "t1",
                name: "composer_thought",
                arguments: JSON.stringify({ scopeId, text: "add first note" })
              },
              {
                type: "function_call",
                call_id: "c1",
                name: "add_notes",
                arguments: JSON.stringify({
                  scopeId,
                  notes: [{ id: null, pitch: 60, startTick: 0, durationTicks: 120, velocity: 0.5 }]
                })
              },
              {
                type: "function_call",
                call_id: "t2",
                name: "composer_thought",
                arguments: JSON.stringify({ scopeId, text: "add second note" })
              },
              {
                type: "function_call",
                call_id: "c2",
                name: "add_notes",
                arguments: JSON.stringify({
                  scopeId,
                  notes: [{ id: null, pitch: 62, startTick: 120, durationTicks: 120, velocity: 0.5 }]
                })
              }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp2",
          output: [
            {
              type: "function_call",
              call_id: "c3",
              name: "finalize_proposal",
              arguments: JSON.stringify({ scopeId, musicalSummary: "ok" })
            }
          ]
        })
      };
    };

    const proposal = await runComposerAgent({
      userPrompt: "add notes",
      scope: { trackIndex: 0, tickStart: 0, tickEnd: 1920 },
      liveState: mkState(),
      fetchFn: fakeFetch,
      scopeIdOverride: scopeId,
      stream: false,
      stepMode: true,
      stepMaxNotesPerAdd: 4,
      stepMaxSteps: 64,
      maxToolCalls: 50
    });

    expect(proposal.ops.length).toBe(2);
    expect(proposal.draftState.tracks[0]!.notes.length).toBe(2);
    expect(proposal.draftState.tracks[0]!.notes[0]!.pitch).toBe(60);
    expect(proposal.draftState.tracks[0]!.notes[1]!.pitch).toBe(62);
  });

  it("allows deliberate musical placement without a separate thought tool", async () => {
    let callIndex = 0;
    const scopeId = "SCOPE";

    const fakeFetch: any = async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "resp1",
            output: [
              {
                type: "function_call",
                call_id: "c1",
                name: "place_note",
                arguments: JSON.stringify({
                  scopeId,
                  notes: [{ id: null, pitchName: "C4", bar: 1, beat: 1, duration: "quarter", velocity: 0.5 }]
                })
              }
            ]
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp2",
          output: [
            {
              type: "function_call",
              call_id: "c2",
              name: "finalize_proposal",
              arguments: JSON.stringify({ scopeId, musicalSummary: "ok" })
            }
          ]
        })
      };
    };

    const proposal = await runComposerAgent({
      userPrompt: "add notes",
      scope: { trackIndex: 0, tickStart: 0, tickEnd: 1920 },
      liveState: mkState(),
      fetchFn: fakeFetch,
      scopeIdOverride: scopeId,
      stream: false,
      stepMode: true,
      stepMaxNotesPerAdd: 4,
      stepMaxSteps: 64,
      maxToolCalls: 50
    });

    expect(proposal.ops.length).toBe(1);
    expect(proposal.draftState.tracks[0]!.notes.length).toBe(1);
    expect(proposal.draftState.tracks[0]!.notes[0]!.pitch).toBe(60);
  });

  it("stops after step cap without requiring finalize_proposal", async () => {
    let callIndex = 0;
    const scopeId = "SCOPE";

    const fakeFetch: any = async () => {
      callIndex += 1;
      if (callIndex > 2) throw new Error("should not fetch after step cap");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: `resp${callIndex}`,
          output: [
            {
              type: "function_call",
              call_id: `t${callIndex}`,
              name: "composer_thought",
              arguments: JSON.stringify({ scopeId, text: `step ${callIndex}` })
            },
            {
              type: "function_call",
              call_id: `a${callIndex}`,
              name: "add_notes",
              arguments: JSON.stringify({
                scopeId,
                notes: [{ id: null, pitch: 60 + callIndex, startTick: (callIndex - 1) * 120, durationTicks: 120, velocity: 0.5 }]
              })
            }
          ]
        })
      };
    };

    const proposal = await runComposerAgent({
      userPrompt: "add notes",
      scope: { trackIndex: 0, tickStart: 0, tickEnd: 1920 },
      liveState: mkState(),
      fetchFn: fakeFetch,
      scopeIdOverride: scopeId,
      stream: false,
      stepMode: true,
      stepMaxNotesPerAdd: 4,
      stepMaxSteps: 2,
      maxToolCalls: 50
    });

    expect(callIndex).toBe(2);
    expect(proposal.ops.length).toBe(2);
    expect(proposal.draftState.tracks[0]!.notes.length).toBe(2);
    expect(proposal.musicalSummary).toContain("Stopped after 2 steps");
  });
});
