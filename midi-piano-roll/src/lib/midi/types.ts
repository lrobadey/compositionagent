export type MidiNoteId = string;

export type MidiNote = {
  id: MidiNoteId;
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
  endTick: number;
  channel: number;
  trackIndex: number;
};

export type MidiTrackView = {
  trackIndex: number;
  name: string;
  notes: MidiNote[];
  minTick: number;
  maxTick: number;
  pitchMin: number;
  pitchMax: number;
};

export type TempoEvent = {
  tick: number;
  bpm: number;
};

export type TimeSigEvent = {
  tick: number;
  numerator: number;
  denominator: number;
};

export type MidiProject = {
  ppq: number;
  tempos: TempoEvent[];
  timeSignatures: TimeSigEvent[];
  tracks: MidiTrackView[];
  maxTick: number;
};

