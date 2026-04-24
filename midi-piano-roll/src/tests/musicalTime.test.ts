import { describe, expect, it } from "vitest";

import { positionToTick, tickToMusicalPosition } from "../lib/agent/musicalTime";
import { MeasureMap } from "../lib/midi/measureMap";

describe("musical time", () => {
  it("converts 4/4 positions with quarter-note beats", () => {
    const map = new MeasureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }], 480 * 4 * 8);

    expect(positionToTick(map, { bar: 1, beat: 2 })).toBe(480);
    expect(tickToMusicalPosition(map, 480)).toMatchObject({ bar: 1, beat: 2, tick: 0 });
  });

  it("converts 6/8 positions with eighth-note beats", () => {
    const map = new MeasureMap(480, [{ tick: 0, numerator: 6, denominator: 8 }], 480 * 6);

    expect(positionToTick(map, { bar: 1, beat: 2 })).toBe(240);
    expect(tickToMusicalPosition(map, 240)).toMatchObject({ bar: 1, beat: 2, tick: 0 });
  });

  it("converts later 3/8 bars using the meter bar length", () => {
    const map = new MeasureMap(480, [{ tick: 0, numerator: 3, denominator: 8 }], 480 * 3);

    expect(positionToTick(map, { bar: 2, beat: 1 })).toBe(720);
    expect(tickToMusicalPosition(map, 720)).toMatchObject({ bar: 2, beat: 1, tick: 0 });
  });
});
