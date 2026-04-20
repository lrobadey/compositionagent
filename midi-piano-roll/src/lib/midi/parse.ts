import { Midi } from "@tonejs/midi";
import type { MidiProject, MidiTrackView, TempoEvent, TimeSigEvent } from "./types";

const clampMidiPitch = (pitch: number): number => {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(0, Math.min(127, Math.round(pitch)));
};

export const parseMidi = (arrayBuffer: ArrayBuffer): MidiProject => {
  const midi = new Midi(arrayBuffer);

  const ppq = midi.header.ppq;
  const tempos: TempoEvent[] =
    midi.header.tempos?.map((t) => ({ tick: Math.round(t.ticks), bpm: t.bpm })) ?? [];
  if (tempos.length === 0) tempos.push({ tick: 0, bpm: 120 });
  tempos.sort((a, b) => a.tick - b.tick);

  const timeSignatures: TimeSigEvent[] =
    midi.header.timeSignatures?.map((ts) => ({
      tick: Math.round(ts.ticks),
      numerator: ts.timeSignature[0] ?? 4,
      denominator: ts.timeSignature[1] ?? 4
    })) ?? [];
  if (timeSignatures.length === 0) timeSignatures.push({ tick: 0, numerator: 4, denominator: 4 });
  timeSignatures.sort((a, b) => a.tick - b.tick);

  const tracks: MidiTrackView[] = midi.tracks.map((t, trackIndex) => {
    const name = (t.name ?? "").trim() || `Track ${trackIndex + 1}`;
    const notes = t.notes
      .map((n, noteIndex) => {
        const startTick = Math.round(n.ticks);
        const durationTicks = Math.max(0, Math.round(n.durationTicks));
        const endTick = startTick + durationTicks;
        const pitch = clampMidiPitch(n.midi);
        const velocity = Number.isFinite(n.velocity) ? n.velocity : 0;
        const channel = Number.isFinite(t.channel) ? t.channel : 0;
        return {
          id: `${trackIndex}:${noteIndex}`,
          pitch,
          velocity,
          startTick,
          durationTicks,
          endTick,
          channel,
          trackIndex
        };
      })
      .sort((a, b) => (a.startTick - b.startTick) || (a.pitch - b.pitch));

    let minTick = Number.POSITIVE_INFINITY;
    let maxTick = 0;
    let pitchMin = 127;
    let pitchMax = 0;
    for (const n of notes) {
      minTick = Math.min(minTick, n.startTick);
      maxTick = Math.max(maxTick, n.endTick);
      pitchMin = Math.min(pitchMin, n.pitch);
      pitchMax = Math.max(pitchMax, n.pitch);
    }
    if (!Number.isFinite(minTick)) minTick = 0;
    if (notes.length === 0) {
      pitchMin = 0;
      pitchMax = 127;
    }

    return { trackIndex, name, notes, minTick, maxTick, pitchMin, pitchMax };
  });

  const maxTick = tracks.reduce((acc, t) => Math.max(acc, t.maxTick), 0);

  return { ppq, tempos, timeSignatures, tracks, maxTick };
};

