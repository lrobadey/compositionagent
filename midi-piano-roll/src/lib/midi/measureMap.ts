import type { TimeSigEvent } from "./types";

export type MeasureStart = { measureIndex: number; tick: number };

type TimeSigSegment = {
  startTick: number;
  endTick: number;
  numerator: number;
  denominator: number;
  beatTicks: number;
  measureTicks: number;
  startMeasureIndex: number;
  startMeasureTick: number;
};

const isPow2 = (n: number): boolean => (n & (n - 1)) === 0 && n > 0;

const sanitizeTimeSig = (ts: TimeSigEvent): TimeSigEvent => {
  const tick = Math.max(0, Math.round(ts.tick));
  const numerator = Number.isFinite(ts.numerator) && ts.numerator > 0 ? Math.round(ts.numerator) : 4;
  let denominator = Number.isFinite(ts.denominator) && ts.denominator > 0 ? Math.round(ts.denominator) : 4;
  if (!isPow2(denominator)) denominator = 4;
  return { tick, numerator, denominator };
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

export class MeasureMap {
  readonly ppq: number;
  readonly segments: TimeSigSegment[];
  readonly starts: number[];
  readonly measureStarts: MeasureStart[];

  constructor(ppq: number, timeSignatures: TimeSigEvent[], maxTick: number) {
    this.ppq = ppq;
    const normalized = [...timeSignatures]
      .filter((ts) => Number.isFinite(ts.tick))
      .map(sanitizeTimeSig)
      .sort((a, b) => a.tick - b.tick);
    if (normalized.length === 0 || normalized[0]!.tick !== 0) normalized.unshift({ tick: 0, numerator: 4, denominator: 4 });

    const segs: TimeSigSegment[] = [];
    let currentMeasureIndex = 0;
    for (let i = 0; i < normalized.length; i++) {
      const curr = normalized[i]!;
      const next = normalized[i + 1];
      const startTick = curr.tick;
      const endTick = Math.max(startTick, Math.min(maxTick, next ? next.tick : maxTick));

      const beatTicks = (ppq * 4) / curr.denominator;
      const measureTicks = beatTicks * curr.numerator;

      const startMeasureTick = startTick;
      const startMeasureIndex = currentMeasureIndex;

      const segment: TimeSigSegment = {
        startTick,
        endTick,
        numerator: curr.numerator,
        denominator: curr.denominator,
        beatTicks,
        measureTicks,
        startMeasureIndex,
        startMeasureTick
      };
      segs.push(segment);

      const measuresInSeg = measureTicks > 0 ? Math.floor((endTick - startTick) / measureTicks) : 0;
      currentMeasureIndex += Math.max(0, measuresInSeg);
    }
    this.segments = segs;
    this.starts = segs.map((s) => s.startTick);

    const starts: MeasureStart[] = [];
    for (const seg of segs) {
      if (seg.measureTicks <= 0) continue;
      const startAt = seg.startTick;
      const endAt = seg.endTick;
      let m = 0;
      for (let t = startAt; t <= endAt; t += seg.measureTicks, m++) {
        starts.push({ measureIndex: seg.startMeasureIndex + m, tick: t });
        if (t === endAt) break;
      }
    }
    this.measureStarts = starts;
  }

  private segmentForTick(tick: number): TimeSigSegment {
    const idx = binarySearchLastLE(this.starts, Math.max(0, tick));
    return this.segments[idx]!;
  }

  tickToBarBeatTick(tick: number): { bar: number; beat: number; tick: number } {
    const seg = this.segmentForTick(tick);
    const local = Math.max(0, tick - seg.startTick);
    const measureOffset = seg.measureTicks > 0 ? Math.floor(local / seg.measureTicks) : 0;
    const withinMeasure = seg.measureTicks > 0 ? local - measureOffset * seg.measureTicks : local;
    const beatOffset = seg.beatTicks > 0 ? Math.floor(withinMeasure / seg.beatTicks) : 0;
    const withinBeat = seg.beatTicks > 0 ? withinMeasure - beatOffset * seg.beatTicks : withinMeasure;

    return {
      bar: seg.startMeasureIndex + measureOffset + 1,
      beat: beatOffset + 1,
      tick: Math.round(withinBeat)
    };
  }

  gridLines(tickMin: number, tickMax: number, subdivision: number): { bars: number[]; beats: number[]; subs: number[] } {
    const min = Math.max(0, Math.floor(tickMin));
    const max = Math.max(min, Math.ceil(tickMax));
    const bars: number[] = [];
    const beats: number[] = [];
    const subs: number[] = [];

    for (const seg of this.segments) {
      const segMin = Math.max(min, seg.startTick);
      const segMax = Math.min(max, seg.endTick);
      if (segMax <= segMin) continue;

      const beatTicks = Math.max(1, Math.round(seg.beatTicks));
      const subTicks = Math.max(1, Math.round(beatTicks / Math.max(1, subdivision)));
      const measureTicks = Math.max(beatTicks, Math.round(seg.measureTicks));

      const firstSub = Math.floor(segMin / subTicks) * subTicks;
      for (let t = firstSub; t <= segMax; t += subTicks) {
        if (t < segMin) continue;
        const isBar = t % measureTicks === 0;
        const isBeat = t % beatTicks === 0;
        if (isBar) bars.push(t);
        else if (isBeat) beats.push(t);
        else subs.push(t);
        if (t === segMax) break;
      }
    }

    return { bars, beats, subs };
  }
}

