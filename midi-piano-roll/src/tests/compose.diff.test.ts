import { describe, expect, it } from "vitest";

import { diffNotes } from "../lib/compose/diff";
import type { TrackState } from "../lib/compose/state";

describe("diffNotes", () => {
  it("detects added/removed/modified ids", () => {
    const before: TrackState = {
      trackIndex: 0,
      name: "T",
      channel: 0,
      notes: [
        { id: "a", pitch: 60, startTick: 0, durationTicks: 120, endTick: 120, velocity: 0.5, channel: 0, trackIndex: 0 },
        { id: "b", pitch: 64, startTick: 120, durationTicks: 120, endTick: 240, velocity: 0.5, channel: 0, trackIndex: 0 }
      ]
    };
    const after: TrackState = {
      trackIndex: 0,
      name: "T",
      channel: 0,
      notes: [
        { id: "a", pitch: 60, startTick: 0, durationTicks: 120, endTick: 120, velocity: 0.7, channel: 0, trackIndex: 0 }, // modified vel
        { id: "c", pitch: 67, startTick: 240, durationTicks: 120, endTick: 360, velocity: 0.5, channel: 0, trackIndex: 0 } // added
      ]
    };
    const scope = { trackIndex: 0, tickStart: 0, tickEnd: 1000 };
    const diff = diffNotes(before, after, scope);
    expect(diff.addedIds.has("c")).toBe(true);
    expect(diff.removedIds.has("b")).toBe(true);
    expect(diff.modifiedIds.has("a")).toBe(true);
  });
});

