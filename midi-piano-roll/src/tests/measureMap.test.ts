import { describe, expect, it } from "vitest";

import { MeasureMap } from "../lib/midi/measureMap";

describe("MeasureMap", () => {
  it("computes bar/beat/tick for 4/4 then 3/4", () => {
    const ppq = 480;
    const fourFourMeasure = 4 * ppq;
    const map = new MeasureMap(
      ppq,
      [
        { tick: 0, numerator: 4, denominator: 4 },
        { tick: 2 * fourFourMeasure, numerator: 3, denominator: 4 }
      ],
      10_000
    );

    expect(map.tickToBarBeatTick(0)).toEqual({ bar: 1, beat: 1, tick: 0 });
    expect(map.tickToBarBeatTick(fourFourMeasure)).toEqual({ bar: 2, beat: 1, tick: 0 });
    expect(map.tickToBarBeatTick(2 * fourFourMeasure)).toEqual({ bar: 3, beat: 1, tick: 0 });
    // After the change to 3/4 at bar 3 start, tick + 3 beats lands at the next bar.
    expect(map.tickToBarBeatTick(2 * fourFourMeasure + 3 * ppq)).toEqual({ bar: 4, beat: 1, tick: 0 });
  });

  it("returns grid lines with bar lines included", () => {
    const ppq = 480;
    const map = new MeasureMap(ppq, [{ tick: 0, numerator: 4, denominator: 4 }], 4000);
    const { bars, beats, subs } = map.gridLines(0, 2000, 4);
    expect(bars.length).toBeGreaterThan(0);
    expect(beats.length).toBeGreaterThan(0);
    expect(subs.length).toBeGreaterThan(0);
  });
});
