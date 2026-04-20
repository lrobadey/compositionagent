import type { Note } from "./state";

export type ComposeOpBase = {
  opId: string;
  scopeId: string;
  trackIndex: number;
};

export type AddNotesOp = ComposeOpBase & {
  kind: "add_notes";
  notes: Array<
    Omit<Note, "endTick"> & {
      endTick?: number;
    }
  >;
};

export type DeleteNotesOp = ComposeOpBase & {
  kind: "delete_notes";
  noteIds: string[];
};

export type MoveNotesOp = ComposeOpBase & {
  kind: "move_notes";
  noteIds: string[];
  deltaTicks: number;
  deltaPitch: number;
};

export type ResizeNotesOp = ComposeOpBase & {
  kind: "resize_notes";
  noteIds: string[];
  durationTicks?: number;
  endTick?: number;
};

export type SetVelocityOp = ComposeOpBase & {
  kind: "set_velocity";
  noteIds: string[];
  velocity: number;
};

export type ClearRangeOp = ComposeOpBase & {
  kind: "clear_range";
  tickStart: number;
  tickEnd: number;
  pitchMin?: number;
  pitchMax?: number;
};

export type QuantizeOp = ComposeOpBase & {
  kind: "quantize";
  target: "selected" | "range" | "all";
  grid: { divisionPerBeat: 4 | 8 | 16 };
  mode: "start" | "start_end";
  tickStart?: number;
  tickEnd?: number;
  noteIds?: string[];
};

export type HumanizeOp = ComposeOpBase & {
  kind: "humanize";
  target: "selected" | "range" | "all";
  timingStddevTicks: number;
  velocityStddev: number;
  seed: number;
  tickStart?: number;
  tickEnd?: number;
  noteIds?: string[];
};

export type AddChordProgressionOp = ComposeOpBase & {
  kind: "add_chord_progression";
  key: string;
  scale: "major" | "minor";
  progression: string[];
  rhythm: "whole" | "half" | "quarter";
  voicing: "triad" | "seventh";
  tickStart: number;
  bars: number;
};

export type ArpeggiateOp = ComposeOpBase & {
  kind: "arpeggiate";
  pattern: "up" | "down" | "updown" | "random";
  rate: "8th" | "16th";
  tickStart: number;
  bars: number;
  chord: { root: string; quality: "maj" | "min" | "dim" | "aug"; octave?: number };
};

export type DrumPatternBasicOp = ComposeOpBase & {
  kind: "drum_pattern_basic";
  style: "four_on_floor" | "hiphop_basic";
  bars: number;
  density: "low" | "medium" | "high";
  tickStart: number;
};

export type FinalizeProposalOp = ComposeOpBase & {
  kind: "finalize_proposal";
};

export type ComposeOp =
  | AddNotesOp
  | DeleteNotesOp
  | MoveNotesOp
  | ResizeNotesOp
  | SetVelocityOp
  | ClearRangeOp
  | QuantizeOp
  | HumanizeOp
  | AddChordProgressionOp
  | ArpeggiateOp
  | DrumPatternBasicOp
  | FinalizeProposalOp;

