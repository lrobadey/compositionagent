import { describe, expect, it } from "vitest";

import { MeasureMap } from "../lib/midi/measureMap";
import { metronomeTicksInWindow } from "../lib/audio/metronome";

describe("metronomeTicksInWindow", () => {
  it("produces beats with accented bars", () => {
    const ppq = 480;
    const mm = new MeasureMap(ppq, [{ tick: 0, numerator: 4, denominator: 4 }], 1920);
    const ticks = metronomeTicksInWindow(mm, 0, 1920);
    const bars = ticks.filter((t) => t.isBar).map((t) => t.tick);
    const beats = ticks.filter((t) => !t.isBar).map((t) => t.tick);

    expect(bars).toContain(0);
    expect(beats).toContain(480);
    expect(beats).toContain(960);
    expect(beats).toContain(1440);
  });
});
