import { Midi } from "@tonejs/midi";

import type { MidiProject } from "../midi/types";
import type { Note, ProjectState, TrackState } from "./state";

const clampPitch = (pitch: number): number => Math.max(0, Math.min(127, Math.round(pitch)));
const clampVelocity = (v: number): number => {
  const n = Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
};

const newId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
};

export const sortNotes = (notes: Note[]): void => {
  notes.sort((a, b) => (a.startTick - b.startTick) || (a.pitch - b.pitch) || (a.id < b.id ? -1 : 1));
};

export const fromParsedMidiProject = (parsed: MidiProject): ProjectState => {
  const tracks: TrackState[] = parsed.tracks.map((t) => {
    const notes: Note[] = t.notes.map((n) => ({
      id: newId(),
      pitch: clampPitch(n.pitch),
      startTick: Math.max(0, Math.round(n.startTick)),
      durationTicks: Math.max(0, Math.round(n.durationTicks)),
      endTick: Math.max(0, Math.round(n.endTick)),
      velocity: clampVelocity(n.velocity),
      channel: n.channel ?? 0,
      trackIndex: t.trackIndex
    }));
    sortNotes(notes);
    const channel = Number.isFinite(t.notes[0]?.channel) ? (t.notes[0]!.channel as number) : 0;
    return {
      trackIndex: t.trackIndex,
      name: t.name,
      channel,
      notes
    };
  });

  return {
    ppq: parsed.ppq,
    tempos: [...parsed.tempos].sort((a, b) => a.tick - b.tick),
    timeSignatures: [...parsed.timeSignatures].sort((a, b) => a.tick - b.tick),
    tracks,
    maxTick: parsed.maxTick
  };
};

export const toMidiFile = (project: ProjectState): Uint8Array => {
  const midi = new Midi();
  const headerJson = midi.header.toJSON();
  headerJson.ppq = project.ppq;
  headerJson.tempos = project.tempos.map((t) => ({
    bpm: t.bpm,
    ticks: Math.max(0, Math.round(t.tick))
  }));
  headerJson.timeSignatures = project.timeSignatures.map((ts) => ({
    ticks: Math.max(0, Math.round(ts.tick)),
    timeSignature: [ts.numerator, ts.denominator]
  }));
  midi.header.fromJSON(headerJson);
  midi.header.update();

  for (const t of project.tracks) {
    const track = midi.addTrack();
    track.name = t.name;
    track.channel = t.channel;
    for (const n of t.notes) {
      if (n.durationTicks <= 0) continue;
      track.addNote({
        midi: clampPitch(n.pitch),
        ticks: Math.max(0, Math.round(n.startTick)),
        durationTicks: Math.max(1, Math.round(n.durationTicks)),
        velocity: clampVelocity(n.velocity)
      });
    }
  }

  return midi.toArray();
};
