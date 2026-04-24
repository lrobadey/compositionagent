import type { MeasureMap } from "../midi/measureMap";

export type MusicalPosition = {
  bar: number;
  beat: number;
  tick?: number | null;
};

const NOTE_NAMES: Record<string, number> = {
  C: 0,
  "C#": 1,
  DB: 1,
  D: 2,
  "D#": 3,
  EB: 3,
  E: 4,
  F: 5,
  "F#": 6,
  GB: 6,
  G: 7,
  "G#": 8,
  AB: 8,
  A: 9,
  "A#": 10,
  BB: 10,
  B: 11
};

const DURATION_BEATS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  eighth_note: 0.5,
  sixteenth: 0.25,
  sixteenth_note: 0.25
};

export const DEFAULT_COMPOSER_BARS = 8;
export const DEFAULT_COMPOSER_TIME_SIGNATURE = "4/4";

export const parsePitchName = (pitchName: string): number => {
  const match = pitchName.trim().match(/^([A-Ga-g])([#bB]?)(-?\d+)$/);
  if (!match) throw new Error(`invalid pitch name: ${pitchName}`);
  const [, letter, accidental, octaveText] = match;
  const key = `${letter!.toUpperCase()}${accidental ? accidental.toUpperCase() : ""}`;
  const pitchClass = NOTE_NAMES[key];
  if (pitchClass == null) throw new Error(`invalid pitch name: ${pitchName}`);
  const octave = Number(octaveText);
  if (!Number.isFinite(octave)) throw new Error(`invalid pitch octave: ${pitchName}`);
  return Math.max(0, Math.min(127, 12 * (octave + 1) + pitchClass));
};

export const durationToTicks = (duration: string | number, ppq: number): number => {
  if (typeof duration === "number") {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("duration beats must be positive");
    return Math.max(1, Math.round(duration * ppq));
  }
  const normalized = duration.trim().toLowerCase().replaceAll(" ", "_").replace(/_note$/, "");
  const beats = DURATION_BEATS[normalized];
  if (beats == null) throw new Error(`invalid duration: ${duration}`);
  return Math.max(1, Math.round(beats * ppq));
};

export const positionToTick = (measureMap: MeasureMap, pos: MusicalPosition): number => {
  const bar = Math.max(1, Math.floor(pos.bar));
  const beat = Math.max(1, Number(pos.beat));
  const extraTick = Math.max(0, Math.round(pos.tick ?? 0));
  const barIndex = bar - 1;
  const measureStart = measureMap.measureStarts.find((m) => m.measureIndex === bar - 1);
  const segment =
    [...measureMap.segments].reverse().find((s) => s.startMeasureIndex <= barIndex) ?? measureMap.segments[0];
  const beatTicks = segment?.beatTicks ?? measureMap.ppq;
  const measureTicks = segment?.measureTicks ?? measureMap.ppq * 4;
  const segmentStartTick = segment?.startMeasureTick ?? 0;
  const segmentStartBar = segment?.startMeasureIndex ?? 0;
  const barStartTick = measureStart?.tick ?? segmentStartTick + Math.max(0, barIndex - segmentStartBar) * measureTicks;
  return Math.max(0, Math.round(barStartTick + (beat - 1) * beatTicks + extraTick));
};

export const tickToMusicalPosition = (
  measureMap: MeasureMap,
  tick: number,
  durationTicks?: number
): { bar: number; beat: number; tick: number; duration?: string } => {
  const mbt = measureMap.tickToBarBeatTick(tick);
  const out: { bar: number; beat: number; tick: number; duration?: string } = {
    bar: mbt.bar,
    beat: mbt.beat,
    tick: mbt.tick
  };
  if (durationTicks != null) out.duration = ticksToDurationName(durationTicks, measureMap.ppq);
  return out;
};

export const ticksToDurationName = (durationTicks: number, ppq: number): string => {
  const beats = durationTicks / ppq;
  if (Math.abs(beats - 4) < 0.01) return "whole";
  if (Math.abs(beats - 2) < 0.01) return "half";
  if (Math.abs(beats - 1) < 0.01) return "quarter";
  if (Math.abs(beats - 0.5) < 0.01) return "eighth";
  if (Math.abs(beats - 0.25) < 0.01) return "sixteenth";
  return `${Number(beats.toFixed(3))} beats`;
};
