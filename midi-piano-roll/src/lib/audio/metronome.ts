import type { MeasureMap } from "../midi/measureMap";

export type MetronomeTick = { tick: number; isBar: boolean };

export const metronomeTicksInWindow = (measureMap: MeasureMap, tickStart: number, tickEnd: number): MetronomeTick[] => {
  const from = Math.max(0, Math.floor(tickStart));
  const to = Math.max(from, Math.ceil(tickEnd));
  const lines = measureMap.gridLines(from, to, 4);
  const out: MetronomeTick[] = [];

  for (const t of lines.bars) {
    if (t < from || t >= to) continue;
    out.push({ tick: t, isBar: true });
  }
  for (const t of lines.beats) {
    if (t < from || t >= to) continue;
    out.push({ tick: t, isBar: false });
  }

  out.sort((a, b) => a.tick - b.tick || (a.isBar ? -1 : 1));
  return out;
};
