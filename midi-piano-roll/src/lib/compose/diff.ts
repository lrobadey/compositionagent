import type { Scope } from "../agent/scope";
import { normalizeScope } from "../agent/scope";
import type { NoteId, TrackState } from "./state";

export type DiffCounts = { added: number; removed: number; modified: number };

export type DiffResult = {
  addedIds: Set<NoteId>;
  removedIds: Set<NoteId>;
  modifiedIds: Set<NoteId>;
  counts: DiffCounts;
};

const intersectsScope = (
  scope: Scope,
  note: { trackIndex: number; startTick: number; endTick: number; pitch: number }
): boolean => {
  if (note.trackIndex !== scope.trackIndex) return false;
  if (note.endTick <= scope.tickStart || note.startTick >= scope.tickEnd) return false;
  if (scope.pitchMin != null && note.pitch < scope.pitchMin) return false;
  if (scope.pitchMax != null && note.pitch > scope.pitchMax) return false;
  return true;
};

export const diffNotes = (beforeTrack: TrackState, afterTrack: TrackState, scopeIn: Scope): DiffResult => {
  const scope = normalizeScope(scopeIn);
  const before = new Map(
    beforeTrack.notes.filter((n) => intersectsScope(scope, n)).map((n) => [n.id, n] as const)
  );
  const after = new Map(
    afterTrack.notes.filter((n) => intersectsScope(scope, n)).map((n) => [n.id, n] as const)
  );

  const addedIds = new Set<NoteId>();
  const removedIds = new Set<NoteId>();
  const modifiedIds = new Set<NoteId>();

  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) {
      addedIds.add(id);
      continue;
    }
    if (
      a.pitch !== b.pitch ||
      a.startTick !== b.startTick ||
      a.durationTicks !== b.durationTicks ||
      a.endTick !== b.endTick ||
      a.velocity !== b.velocity
    ) {
      modifiedIds.add(id);
    }
  }

  for (const id of before.keys()) {
    if (!after.has(id)) removedIds.add(id);
  }

  return {
    addedIds,
    removedIds,
    modifiedIds,
    counts: { added: addedIds.size, removed: removedIds.size, modified: modifiedIds.size }
  };
};

