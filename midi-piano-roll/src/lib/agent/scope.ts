export type Scope = {
  trackIndex: number;
  tickStart: number;
  tickEnd: number;
  pitchMin?: number;
  pitchMax?: number;
};

export const normalizeScope = (scope: Scope): Scope => {
  const tickStart = Math.max(0, Math.floor(scope.tickStart));
  const tickEnd = Math.max(tickStart, Math.ceil(scope.tickEnd));
  const pitchMin =
    scope.pitchMin == null ? undefined : Math.max(0, Math.min(127, Math.floor(scope.pitchMin)));
  const pitchMax =
    scope.pitchMax == null ? undefined : Math.max(0, Math.min(127, Math.ceil(scope.pitchMax)));
  return {
    trackIndex: scope.trackIndex,
    tickStart,
    tickEnd,
    pitchMin,
    pitchMax
  };
};

export const scopeContains = (
  scope: Scope,
  note: { trackIndex: number; startTick: number; endTick: number; pitch: number }
): boolean => {
  if (note.trackIndex !== scope.trackIndex) return false;
  if (note.startTick < scope.tickStart) return false;
  if (note.endTick > scope.tickEnd) return false;
  if (scope.pitchMin != null && note.pitch < scope.pitchMin) return false;
  if (scope.pitchMax != null && note.pitch > scope.pitchMax) return false;
  return true;
};

export const globalScopeForTrack = (trackIndex: number): Scope => ({
  trackIndex,
  tickStart: 0,
  tickEnd: Number.MAX_SAFE_INTEGER,
  pitchMin: 0,
  pitchMax: 127
});

