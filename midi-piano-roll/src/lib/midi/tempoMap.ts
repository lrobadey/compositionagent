import type { TempoEvent } from "./types";

type TempoSegment = {
  startTick: number;
  endTick: number;
  bpm: number;
  secondsPerTick: number;
  startSeconds: number;
};

const binarySearchLastLE = (arr: number[], x: number): number => {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((arr[mid] ?? 0) <= x) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
};

export class TempoMap {
  readonly ppq: number;
  readonly segments: TempoSegment[];
  readonly ticksStarts: number[];
  readonly secondsStarts: number[];

  constructor(ppq: number, tempos: TempoEvent[], maxTick: number) {
    this.ppq = ppq;

    const normalized = [...tempos]
      .filter((t) => Number.isFinite(t.tick) && Number.isFinite(t.bpm) && t.bpm > 0)
      .map((t) => ({ tick: Math.max(0, Math.round(t.tick)), bpm: t.bpm }))
      .sort((a, b) => a.tick - b.tick);
    if (normalized.length === 0 || normalized[0]!.tick !== 0) normalized.unshift({ tick: 0, bpm: 120 });

    const segs: TempoSegment[] = [];
    let startSeconds = 0;
    for (let i = 0; i < normalized.length; i++) {
      const curr = normalized[i]!;
      const next = normalized[i + 1];
      const startTick = curr.tick;
      const endTick = Math.max(startTick, Math.min(maxTick, next ? next.tick : maxTick));
      const secondsPerTick = 60 / (curr.bpm * ppq);
      segs.push({ startTick, endTick, bpm: curr.bpm, secondsPerTick, startSeconds });
      startSeconds += (endTick - startTick) * secondsPerTick;
    }
    if (segs.length === 0) segs.push({ startTick: 0, endTick: maxTick, bpm: 120, secondsPerTick: 60 / (120 * ppq), startSeconds: 0 });

    this.segments = segs;
    this.ticksStarts = segs.map((s) => s.startTick);
    this.secondsStarts = segs.map((s) => s.startSeconds);
  }

  ticksToSeconds(tick: number): number {
    const t = Math.max(0, tick);
    const idx = binarySearchLastLE(this.ticksStarts, t);
    const seg = this.segments[idx]!;
    const dticks = Math.max(0, Math.min(t, seg.endTick) - seg.startTick);
    return seg.startSeconds + dticks * seg.secondsPerTick;
  }

  secondsToTicks(seconds: number): number {
    const s = Math.max(0, seconds);
    const idx = binarySearchLastLE(this.secondsStarts, s);
    const seg = this.segments[idx]!;
    const dsec = Math.max(0, s - seg.startSeconds);
    const dticks = dsec / seg.secondsPerTick;
    return seg.startTick + dticks;
  }
}

