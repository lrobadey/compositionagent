import { describe, expect, it } from "vitest";

import { applyOps } from "../lib/compose/apply";
import type { ProjectState } from "../lib/compose/state";
import type { ComposeOp } from "../lib/compose/ops";
import { globalScopeForTrack, type Scope } from "../lib/agent/scope";

const mkState = (): ProjectState => ({
  ppq: 480,
  tempos: [{ tick: 0, bpm: 120 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  tracks: [
    {
      trackIndex: 0,
      name: "Track 1",
      channel: 0,
      notes: [
        {
          id: "n1",
          pitch: 60,
          startTick: 0,
          durationTicks: 480,
          endTick: 480,
          velocity: 0.5,
          channel: 0,
          trackIndex: 0
        }
      ]
    }
  ],
  maxTick: 480
});

describe("applyOps", () => {
  it("applies add/move/resize/delete and produces inverse ops", () => {
    const state = mkState();
    const scope: Scope = { trackIndex: 0, tickStart: 0, tickEnd: 4000, pitchMin: 0, pitchMax: 127 };

    const ops: ComposeOp[] = [
      {
        kind: "add_notes",
        opId: "op1",
        scopeId: "s",
        trackIndex: 0,
        notes: [
          {
            id: "n2",
            pitch: 64,
            startTick: 480,
            durationTicks: 240,
            endTick: 720,
            velocity: 0.6,
            channel: 0,
            trackIndex: 0
          }
        ]
      },
      { kind: "move_notes", opId: "op2", scopeId: "s", trackIndex: 0, noteIds: ["n2"], deltaTicks: 240, deltaPitch: 1 },
      { kind: "resize_notes", opId: "op3", scopeId: "s", trackIndex: 0, noteIds: ["n2"], durationTicks: 480 },
      { kind: "delete_notes", opId: "op4", scopeId: "s", trackIndex: 0, noteIds: ["n1"] }
    ];

    const res = applyOps(state, ops, scope);
    expect(res.appliedOps.length).toBe(4);
    expect(res.rejectedOps.length).toBe(0);
    expect(res.inverseOps.length).toBeGreaterThan(0);

    const t = res.nextState.tracks[0]!;
    expect(t.notes.find((n) => n.id === "n1")).toBeFalsy();
    const n2 = t.notes.find((n) => n.id === "n2")!;
    expect(n2.pitch).toBe(65);
    expect(n2.startTick).toBe(720);
    expect(n2.durationTicks).toBe(480);

    const undo = applyOps(res.nextState, res.inverseOps, globalScopeForTrack(0));
    expect(undo.rejectedOps.length).toBe(0);
    const t2 = undo.nextState.tracks[0]!;
    expect(t2.notes.find((n) => n.id === "n1")).toBeTruthy();
  });

  it("rejects out-of-scope changes", () => {
    const state = mkState();
    const scope: Scope = { trackIndex: 0, tickStart: 0, tickEnd: 480, pitchMin: 60, pitchMax: 72 };
    const res = applyOps(
      state,
      [
        {
          kind: "add_notes",
          opId: "op",
          scopeId: "s",
          trackIndex: 0,
          notes: [
            {
              id: "bad",
              pitch: 90,
              startTick: 0,
              durationTicks: 120,
              endTick: 120,
              velocity: 0.5,
              channel: 0,
              trackIndex: 0
            }
          ]
        }
      ],
      scope
    );
    expect(res.appliedOps.length).toBe(0);
    expect(res.rejectedOps.length).toBe(1);
  });

  it("humanize is deterministic with a seed", () => {
    const state = mkState();
    const scope: Scope = { trackIndex: 0, tickStart: 0, tickEnd: 4000, pitchMin: 0, pitchMax: 127 };
    const op: ComposeOp = {
      kind: "humanize",
      opId: "h",
      scopeId: "s",
      trackIndex: 0,
      target: "selected",
      noteIds: ["n1"],
      timingStddevTicks: 10,
      velocityStddev: 0.1,
      seed: 123
    };

    const a = applyOps(state, [op], scope).nextState.tracks[0]!.notes.find((n) => n.id === "n1")!;
    const b = applyOps(state, [op], scope).nextState.tracks[0]!.notes.find((n) => n.id === "n1")!;
    expect(a.startTick).toBe(b.startTick);
    expect(a.velocity).toBe(b.velocity);
  });
});

