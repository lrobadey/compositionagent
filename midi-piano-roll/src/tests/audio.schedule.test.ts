import { describe, expect, it } from "vitest";

import { TempoMap } from "../lib/midi/tempoMap";
import { scheduleNotesInWindow } from "../lib/audio/schedule";

describe("scheduleNotesInWindow", () => {
  it("orders events and keeps them inside window", () => {
    const ppq = 480;
    const tempoMap = new TempoMap(ppq, [{ tick: 0, bpm: 120 }], 1920);
    const notes = [
      { id: "a", pitch: 60, startTick: 0, durationTicks: 480, endTick: 480, velocity: 0.8, channel: 0, trackIndex: 0 },
      { id: "b", pitch: 64, startTick: 960, durationTicks: 480, endTick: 1440, velocity: 0.6, channel: 0, trackIndex: 0 },
      { id: "c", pitch: 67, startTick: 480, durationTicks: 240, endTick: 720, velocity: 0.4, channel: 0, trackIndex: 0 }
    ];

    const events = scheduleNotesInWindow(notes as any, {
      fromTick: 0,
      toTick: 1500,
      startTick: 0,
      startTime: 1,
      tempoMap
    });

    expect(events.length).toBe(3);
    expect(events[0]!.startSeconds).toBeLessThan(events[1]!.startSeconds);
    expect(events[1]!.startSeconds).toBeLessThan(events[2]!.startSeconds);
    for (const e of events) {
      expect(e.startSeconds).toBeGreaterThanOrEqual(1);
      expect(e.durationSeconds).toBeGreaterThan(0);
    }
  });
});
