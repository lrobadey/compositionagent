import type { TempoMap } from "../midi/tempoMap";
import type { Note } from "../compose/state";

export type ScheduledNote = {
  id: string;
  startSeconds: number;
  durationSeconds: number;
  pitch: number;
  velocity: number;
  channel: number;
  trackIndex: number;
};

export type ScheduleWindow = {
  fromTick: number;
  toTick: number;
  startTick: number;
  startTime: number;
  tempoMap: TempoMap;
};

export const scheduleNotesInWindow = (notes: Note[], window: ScheduleWindow): ScheduledNote[] => {
  const from = Math.max(0, window.fromTick);
  const to = Math.max(from, window.toTick);
  const startSeconds = window.tempoMap.ticksToSeconds(window.startTick);
  const out: ScheduledNote[] = [];

  for (const n of notes) {
    if (n.endTick <= from || n.startTick >= to || n.durationTicks <= 0) continue;
    const noteStartSec = window.tempoMap.ticksToSeconds(n.startTick);
    const noteEndSec = window.tempoMap.ticksToSeconds(n.endTick);
    out.push({
      id: n.id,
      startSeconds: window.startTime + (noteStartSec - startSeconds),
      durationSeconds: Math.max(0.01, noteEndSec - noteStartSec),
      pitch: n.pitch,
      velocity: n.velocity,
      channel: n.channel,
      trackIndex: n.trackIndex
    });
  }

  out.sort((a, b) => a.startSeconds - b.startSeconds || a.pitch - b.pitch);
  return out;
};
