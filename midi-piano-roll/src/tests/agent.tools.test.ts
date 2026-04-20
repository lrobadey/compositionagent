import { describe, expect, it } from "vitest";

import type { ProjectState } from "../lib/compose/state";
import { DraftSession } from "../lib/agent/draft";
import { createToolRunner } from "../lib/agent/tools";

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

describe("agent tools", () => {
  it("rejects wrong scopeId", () => {
    const session = new DraftSession(mkState(), { trackIndex: 0, tickStart: 0, tickEnd: 1920 });
    const run = createToolRunner(session);
    const out = run("add_notes", { scopeId: "wrong", notes: [{ pitch: 60, startTick: 0, durationTicks: 120, velocity: 0.5 }] });
    expect((out as any).ok).toBe(false);
  });

  it("macro adds notes inside scope", () => {
    const session = new DraftSession(mkState(), { trackIndex: 0, tickStart: 0, tickEnd: 1920 });
    const run = createToolRunner(session);
    const out = run("add_chord_progression", {
      scopeId: session.scopeId,
      key: "C",
      scale: "major",
      progression: ["I", "V"],
      rhythm: "half",
      voicing: "triad",
      tickStart: 0,
      bars: 1
    });
    expect((out as any).ok).toBe(true);
    expect(session.getTrack().notes.length).toBeGreaterThan(0);
  });
});

