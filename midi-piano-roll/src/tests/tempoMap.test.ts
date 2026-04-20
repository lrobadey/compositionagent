import { describe, expect, it } from "vitest";

import { TempoMap } from "../lib/midi/tempoMap";

describe("TempoMap", () => {
  it("converts ticks <-> seconds for a single tempo", () => {
    const ppq = 480;
    const map = new TempoMap(ppq, [{ tick: 0, bpm: 120 }], 960);

    expect(map.ticksToSeconds(0)).toBeCloseTo(0, 8);
    expect(map.ticksToSeconds(480)).toBeCloseTo(0.5, 8);
    expect(map.ticksToSeconds(960)).toBeCloseTo(1.0, 8);

    expect(map.secondsToTicks(0)).toBeCloseTo(0, 6);
    expect(map.secondsToTicks(0.5)).toBeCloseTo(480, 6);
    expect(map.secondsToTicks(1.0)).toBeCloseTo(960, 6);
  });

  it("is continuous across tempo changes", () => {
    const ppq = 480;
    const map = new TempoMap(
      ppq,
      [
        { tick: 0, bpm: 120 },
        { tick: 480, bpm: 60 }
      ],
      960
    );

    expect(map.ticksToSeconds(480)).toBeCloseTo(0.5, 8);
    expect(map.ticksToSeconds(960)).toBeCloseTo(1.5, 8);

    expect(map.secondsToTicks(0.5)).toBeCloseTo(480, 6);
    expect(map.secondsToTicks(1.5)).toBeCloseTo(960, 6);
  });
});

