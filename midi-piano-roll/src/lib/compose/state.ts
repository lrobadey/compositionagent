import type { TempoEvent, TimeSigEvent } from "../midi/types";

export type NoteId = string;

export type Note = {
  id: NoteId;
  pitch: number;
  startTick: number;
  durationTicks: number;
  endTick: number;
  velocity: number;
  channel: number;
  trackIndex: number;
};

export type TrackState = {
  trackIndex: number;
  name: string;
  channel: number;
  notes: Note[];
};

export type ProjectState = {
  ppq: number;
  tempos: TempoEvent[];
  timeSignatures: TimeSigEvent[];
  tracks: TrackState[];
  maxTick: number;
};

