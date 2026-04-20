import type { Scope } from "../agent/scope";
import { normalizeScope, scopeContains } from "../agent/scope";
import {
  MAX_NOTES_ADDED_PER_PROPOSAL,
  MAX_NOTES_TOUCHED_PER_OP,
  MAX_OPS_PER_PROPOSAL
} from "./limits";
import type {
  AddNotesOp,
  ClearRangeOp,
  ComposeOp,
  DeleteNotesOp,
  HumanizeOp,
  MoveNotesOp,
  QuantizeOp,
  ResizeNotesOp,
  SetVelocityOp
} from "./ops";
import type { Note, NoteId, ProjectState, TrackState } from "./state";
import { sortNotes } from "./convert";

export type RejectedOp = { op: ComposeOp; reason: string };

export type ApplyStats = {
  notesAdded: number;
  notesRemoved: number;
  notesModified: number;
};

export type ApplyResult = {
  nextState: ProjectState;
  appliedOps: ComposeOp[];
  rejectedOps: RejectedOp[];
  inverseOps: ComposeOp[];
  stats: ApplyStats;
  warnings: string[];
};

const clampPitch = (pitch: number): number => Math.max(0, Math.min(127, Math.round(pitch)));
const clampVelocity = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

const cloneState = (s: ProjectState): ProjectState => ({
  ppq: s.ppq,
  tempos: s.tempos.map((t) => ({ ...t })),
  timeSignatures: s.timeSignatures.map((ts) => ({ ...ts })),
  tracks: s.tracks.map((t) => ({
    trackIndex: t.trackIndex,
    name: t.name,
    channel: t.channel,
    notes: t.notes.map((n) => ({ ...n }))
  })),
  maxTick: s.maxTick
});

const noteEquals = (a: Note, b: Note): boolean =>
  a.pitch === b.pitch &&
  a.startTick === b.startTick &&
  a.durationTicks === b.durationTicks &&
  a.endTick === b.endTick &&
  a.velocity === b.velocity &&
  a.channel === b.channel &&
  a.trackIndex === b.trackIndex;

const prng32 = (seed: number): (() => number) => {
  let x = (seed | 0) || 123456789;
  return () => {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
};

const randNormal = (rnd: () => number): number => {
  // Box-Muller transform
  const u = Math.max(1e-12, rnd());
  const v = Math.max(1e-12, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const trackByIndex = (state: ProjectState, trackIndex: number): TrackState | null => {
  const t = state.tracks.find((x) => x.trackIndex === trackIndex);
  return t ?? null;
};

const mapNotes = (track: TrackState): Map<NoteId, Note> => new Map(track.notes.map((n) => [n.id, n]));

const validateTouchCount = (count: number): string | null => {
  if (count > MAX_NOTES_TOUCHED_PER_OP) return `op touches too many notes (${count})`;
  return null;
};

export const applyOps = (state: ProjectState, ops: ComposeOp[], scope: Scope): ApplyResult => {
  const warnings: string[] = [];
  const normalizedScope = normalizeScope(scope);
  const next = cloneState(state);

  const appliedOps: ComposeOp[] = [];
  const rejectedOps: RejectedOp[] = [];
  const inverseOps: ComposeOp[] = [];
  const stats: ApplyStats = { notesAdded: 0, notesRemoved: 0, notesModified: 0 };

  if (ops.length > MAX_OPS_PER_PROPOSAL) {
    return {
      nextState: state,
      appliedOps: [],
      rejectedOps: ops.map((op) => ({ op, reason: `too many ops (${ops.length})` })),
      inverseOps: [],
      stats,
      warnings
    };
  }

  let addedSoFar = 0;

  for (const op of ops) {
    const track = trackByIndex(next, op.trackIndex);
    if (!track) {
      rejectedOps.push({ op, reason: `unknown trackIndex ${op.trackIndex}` });
      continue;
    }
    if (normalizedScope.trackIndex !== op.trackIndex) {
      rejectedOps.push({ op, reason: "op trackIndex does not match scope trackIndex" });
      continue;
    }

    const snapshotNotes = track.notes.map((n) => ({ ...n }));
    const beforeMap = new Map(snapshotNotes.map((n) => [n.id, n] as const));
    const beforeById = new Map(beforeMap);

    const applyOne = (): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
      switch (op.kind) {
        case "add_notes":
          return applyAddNotes(track, op, normalizedScope, addedSoFar);
        case "delete_notes":
          return applyDeleteNotes(track, op, normalizedScope);
        case "move_notes":
          return applyMoveNotes(track, op, normalizedScope);
        case "resize_notes":
          return applyResizeNotes(track, op, normalizedScope);
        case "set_velocity":
          return applySetVelocity(track, op, normalizedScope);
        case "clear_range":
          return applyClearRange(track, op, normalizedScope);
        case "quantize":
          return applyQuantize(next, track, op, normalizedScope);
        case "humanize":
          return applyHumanize(track, op, normalizedScope);
        // macros are expected to be expanded before apply
        case "add_chord_progression":
        case "arpeggiate":
        case "drum_pattern_basic":
        case "finalize_proposal":
          return { ok: false, warn: ["macro/finalize op cannot be applied directly"] };
        default:
          return { ok: false, warn: ["unknown op kind"] };
      }
    };

    const result = applyOne();
    if (!result.ok) {
      track.notes = snapshotNotes;
      rejectedOps.push({ op, reason: result.warn?.join("; ") ?? "rejected" });
      continue;
    }

    if (result.warn) warnings.push(...result.warn);

    const afterMap = mapNotes(track);
    let opAdded = 0;
    let opRemoved = 0;
    let opModified = 0;
    for (const [id, after] of afterMap) {
      const before = beforeById.get(id);
      if (!before) opAdded += 1;
      else if (!noteEquals(before, after)) opModified += 1;
    }
    for (const id of beforeById.keys()) if (!afterMap.has(id)) opRemoved += 1;

    if (opAdded + opRemoved + opModified === 0) {
      track.notes = snapshotNotes;
      rejectedOps.push({ op, reason: "no_effect" });
      continue;
    }

    stats.notesAdded += opAdded;
    stats.notesRemoved += opRemoved;
    stats.notesModified += opModified;

    if (op.kind === "add_notes") {
      addedSoFar += (op.notes?.length ?? 0);
      if (addedSoFar > MAX_NOTES_ADDED_PER_PROPOSAL) {
        rejectedOps.push({ op, reason: `too many notes added in proposal (${addedSoFar})` });
        continue;
      }
    }

    appliedOps.push(op);
    if (result.inverse) inverseOps.unshift(...result.inverse);

    sortNotes(track.notes);
    next.maxTick = recomputeMaxTick(next);
  }

  return { nextState: next, appliedOps, rejectedOps, inverseOps, stats, warnings };
};

const recomputeMaxTick = (state: ProjectState): number => {
  let max = 0;
  for (const t of state.tracks) for (const n of t.notes) max = Math.max(max, n.endTick);
  return max;
};

const applyAddNotes = (
  track: TrackState,
  op: AddNotesOp,
  scope: Scope,
  addedSoFar: number
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const notesIn = op.notes ?? [];
  if (notesIn.length === 0) return { ok: true, inverse: [] };
  if (addedSoFar + notesIn.length > MAX_NOTES_ADDED_PER_PROPOSAL) {
    return { ok: false, warn: ["proposal note cap exceeded"] };
  }

  const warn: string[] = [];
  const idSet = new Set(track.notes.map((n) => n.id));
  const inverse: ComposeOp[] = [];
  const addedIds: string[] = [];

  for (const raw of notesIn) {
    const pitch = clampPitch(raw.pitch);
    const startTick = Math.max(0, Math.round(raw.startTick));
    const durationTicks = Math.max(0, Math.round(raw.durationTicks));
    if (durationTicks <= 0) {
      warn.push(`rejected note with non-positive durationTicks (id=${raw.id})`);
      continue;
    }
    const endTick = startTick + durationTicks;
    const note: Note = {
      id: raw.id || `note_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`,
      pitch,
      startTick,
      durationTicks,
      endTick,
      velocity: clampVelocity(raw.velocity),
      channel: raw.channel ?? track.channel,
      trackIndex: track.trackIndex
    };

    if (!scopeContains(scope, note)) {
      warn.push(`rejected out-of-scope note (id=${note.id})`);
      continue;
    }

    if (idSet.has(note.id)) {
      const newId = `${note.id}_${Math.random().toString(16).slice(2)}`;
      warn.push(`note id collision: ${note.id} -> ${newId}`);
      note.id = newId;
    }
    idSet.add(note.id);
    track.notes.push(note);
    addedIds.push(note.id);
  }

  if (addedIds.length > 0) {
    inverse.push({
      kind: "delete_notes",
      opId: `inv_${op.opId}`,
      scopeId: op.scopeId,
      trackIndex: op.trackIndex,
      noteIds: addedIds
    });
  }

  return { ok: true, inverse, warn: warn.length ? warn : undefined };
};

const applyDeleteNotes = (
  track: TrackState,
  op: DeleteNotesOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const ids = op.noteIds ?? [];
  const err = validateTouchCount(ids.length);
  if (err) return { ok: false, warn: [err] };

  const byId = mapNotes(track);
  const removed: Note[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (!scopeContains(scope, n)) continue;
    removed.push(n);
  }
  if (removed.length === 0) return { ok: true, inverse: [] };

  track.notes = track.notes.filter((n) => !removed.some((r) => r.id === n.id));
  const inverse: ComposeOp[] = [
    {
      kind: "add_notes",
      opId: `inv_${op.opId}`,
      scopeId: op.scopeId,
      trackIndex: op.trackIndex,
      notes: removed.map((n) => ({ ...n }))
    }
  ];
  return { ok: true, inverse };
};

const applyMoveNotes = (
  track: TrackState,
  op: MoveNotesOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const ids = op.noteIds ?? [];
  const err = validateTouchCount(ids.length);
  if (err) return { ok: false, warn: [err] };

  const deltaTicks = Math.round(op.deltaTicks);
  const deltaPitch = Math.round(op.deltaPitch);
  const byId = mapNotes(track);
  const moved: Array<{ id: string; before: Note }> = [];

  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (!scopeContains(scope, n)) continue;
    moved.push({ id, before: { ...n } });

    n.startTick = Math.max(0, n.startTick + deltaTicks);
    n.pitch = clampPitch(n.pitch + deltaPitch);
    n.endTick = n.startTick + n.durationTicks;
    if (!scopeContains(scope, n)) return { ok: false, warn: ["move would leave scope"] };
  }

  const inverse: ComposeOp[] = moved.length
    ? [
        {
          kind: "move_notes",
          opId: `inv_${op.opId}`,
          scopeId: op.scopeId,
          trackIndex: op.trackIndex,
          noteIds: moved.map((m) => m.id),
          deltaTicks: -deltaTicks,
          deltaPitch: -deltaPitch
        }
      ]
    : [];

  return { ok: true, inverse };
};

const applyResizeNotes = (
  track: TrackState,
  op: ResizeNotesOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const ids = op.noteIds ?? [];
  const err = validateTouchCount(ids.length);
  if (err) return { ok: false, warn: [err] };

  const byId = mapNotes(track);
  const changed: Array<{ id: string; beforeDuration: number }> = [];

  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (!scopeContains(scope, n)) continue;

    changed.push({ id, beforeDuration: n.durationTicks });

    let durationTicks: number | null = null;
    if (op.durationTicks != null) durationTicks = Math.round(op.durationTicks);
    if (op.endTick != null) durationTicks = Math.round(op.endTick) - n.startTick;
    if (durationTicks == null) continue;
    if (durationTicks <= 0) return { ok: false, warn: ["durationTicks must be > 0"] };

    n.durationTicks = durationTicks;
    n.endTick = n.startTick + n.durationTicks;
    if (!scopeContains(scope, n)) return { ok: false, warn: ["resize would leave scope"] };
  }

  const inverse: ComposeOp[] = changed.length
    ? [
        {
          kind: "resize_notes",
          opId: `inv_${op.opId}`,
          scopeId: op.scopeId,
          trackIndex: op.trackIndex,
          noteIds: changed.map((c) => c.id),
          // for inverse, durationTicks differs per note; encode as add_notes replacement via set of per-note restore
          durationTicks: undefined,
          endTick: undefined
        }
      ]
    : [];

  if (changed.length) {
    // expand inverse into a set of per-note resize by applying "add_notes" as full restore of those notes
    const byIdAfter = mapNotes(track);
    const restoreNotes: Note[] = [];
    for (const c of changed) {
      const n = byIdAfter.get(c.id);
      if (!n) continue;
      restoreNotes.push({ ...n, durationTicks: c.beforeDuration, endTick: n.startTick + c.beforeDuration });
    }
    return {
      ok: true,
      inverse: [
        {
          kind: "delete_notes",
          opId: `invdel_${op.opId}`,
          scopeId: op.scopeId,
          trackIndex: op.trackIndex,
          noteIds: restoreNotes.map((n) => n.id)
        },
        {
          kind: "add_notes",
          opId: `invadd_${op.opId}`,
          scopeId: op.scopeId,
          trackIndex: op.trackIndex,
          notes: restoreNotes
        }
      ]
    };
  }

  return { ok: true, inverse };
};

const applySetVelocity = (
  track: TrackState,
  op: SetVelocityOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const ids = op.noteIds ?? [];
  const err = validateTouchCount(ids.length);
  if (err) return { ok: false, warn: [err] };

  const byId = mapNotes(track);
  const changed: Array<{ id: string; before: number }> = [];
  const v = clampVelocity(op.velocity);

  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    if (!scopeContains(scope, n)) continue;
    changed.push({ id, before: n.velocity });
    n.velocity = v;
  }

  if (!changed.length) return { ok: true, inverse: [] };
  const inverse: ComposeOp[] = [
    {
      kind: "set_velocity",
      opId: `inv_${op.opId}`,
      scopeId: op.scopeId,
      trackIndex: op.trackIndex,
      noteIds: changed.map((c) => c.id),
      velocity: NaN
    }
  ];

  // represent inverse as delete+add of affected notes to restore per-note velocities
  const restore: Note[] = [];
  for (const c of changed) {
    const n = byId.get(c.id);
    if (!n) continue;
    restore.push({ ...n, velocity: c.before });
  }
  return {
    ok: true,
    inverse: [
      {
        kind: "delete_notes",
        opId: `invdel_${op.opId}`,
        scopeId: op.scopeId,
        trackIndex: op.trackIndex,
        noteIds: restore.map((n) => n.id)
      },
      {
        kind: "add_notes",
        opId: `invadd_${op.opId}`,
        scopeId: op.scopeId,
        trackIndex: op.trackIndex,
        notes: restore
      }
    ]
  };
};

const applyClearRange = (
  track: TrackState,
  op: ClearRangeOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const tickStart = Math.max(scope.tickStart, Math.floor(op.tickStart));
  const tickEnd = Math.min(scope.tickEnd, Math.ceil(op.tickEnd));
  const pitchMin = op.pitchMin == null ? scope.pitchMin : Math.max(op.pitchMin, scope.pitchMin ?? 0);
  const pitchMax = op.pitchMax == null ? scope.pitchMax : Math.min(op.pitchMax, scope.pitchMax ?? 127);

  const removed: Note[] = [];
  for (const n of track.notes) {
    if (n.endTick <= tickStart || n.startTick >= tickEnd) continue;
    if (pitchMin != null && n.pitch < pitchMin) continue;
    if (pitchMax != null && n.pitch > pitchMax) continue;
    if (!scopeContains(scope, n)) continue;
    removed.push(n);
  }
  const err = validateTouchCount(removed.length);
  if (err) return { ok: false, warn: [err] };

  if (!removed.length) return { ok: true, inverse: [] };
  track.notes = track.notes.filter((n) => !removed.some((r) => r.id === n.id));
  return {
    ok: true,
    inverse: [
      {
        kind: "add_notes",
        opId: `inv_${op.opId}`,
        scopeId: op.scopeId,
        trackIndex: op.trackIndex,
        notes: removed.map((n) => ({ ...n }))
      }
    ]
  };
};

const applyQuantize = (
  state: ProjectState,
  track: TrackState,
  op: QuantizeOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const div = op.grid.divisionPerBeat;
  const gridTicks = Math.max(1, Math.round(state.ppq / div));
  const byId = mapNotes(track);

  const candidates: Note[] = [];
  if (op.target === "selected" && op.noteIds) {
    for (const id of op.noteIds) {
      const n = byId.get(id);
      if (n && scopeContains(scope, n)) candidates.push(n);
    }
  } else if (op.target === "range" && op.tickStart != null && op.tickEnd != null) {
    const a = Math.max(scope.tickStart, Math.floor(op.tickStart));
    const b = Math.min(scope.tickEnd, Math.ceil(op.tickEnd));
    for (const n of track.notes) if (n.startTick >= a && n.endTick <= b && scopeContains(scope, n)) candidates.push(n);
  } else if (op.target === "all") {
    for (const n of track.notes) if (scopeContains(scope, n)) candidates.push(n);
  }

  const err = validateTouchCount(candidates.length);
  if (err) return { ok: false, warn: [err] };

  const restore: Note[] = candidates.map((n) => ({ ...n }));

  for (const n of candidates) {
    const qStart = Math.round(n.startTick / gridTicks) * gridTicks;
    if (op.mode === "start_end") {
      const qEnd = Math.round(n.endTick / gridTicks) * gridTicks;
      const dur = qEnd - qStart;
      if (dur <= 0) continue;
      n.startTick = Math.max(0, qStart);
      n.durationTicks = dur;
      n.endTick = n.startTick + n.durationTicks;
    } else {
      n.startTick = Math.max(0, qStart);
      n.endTick = n.startTick + n.durationTicks;
    }
    if (!scopeContains(scope, n)) return { ok: false, warn: ["quantize would leave scope"] };
  }

  return {
    ok: true,
    inverse: restore.length
      ? [
          {
            kind: "delete_notes",
            opId: `invdel_${op.opId}`,
            scopeId: op.scopeId,
            trackIndex: op.trackIndex,
            noteIds: restore.map((n) => n.id)
          },
          {
            kind: "add_notes",
            opId: `invadd_${op.opId}`,
            scopeId: op.scopeId,
            trackIndex: op.trackIndex,
            notes: restore
          }
        ]
      : []
  };
};

const applyHumanize = (
  track: TrackState,
  op: HumanizeOp,
  scope: Scope
): { ok: boolean; inverse?: ComposeOp[]; warn?: string[] } => {
  const byId = mapNotes(track);
  const candidates: Note[] = [];

  if (op.target === "selected" && op.noteIds) {
    for (const id of op.noteIds) {
      const n = byId.get(id);
      if (n && scopeContains(scope, n)) candidates.push(n);
    }
  } else if (op.target === "range" && op.tickStart != null && op.tickEnd != null) {
    const a = Math.max(scope.tickStart, Math.floor(op.tickStart));
    const b = Math.min(scope.tickEnd, Math.ceil(op.tickEnd));
    for (const n of track.notes) if (n.startTick >= a && n.endTick <= b && scopeContains(scope, n)) candidates.push(n);
  } else if (op.target === "all") {
    for (const n of track.notes) if (scopeContains(scope, n)) candidates.push(n);
  }

  const err = validateTouchCount(candidates.length);
  if (err) return { ok: false, warn: [err] };

  const restore: Note[] = candidates.map((n) => ({ ...n }));
  const rnd = prng32(op.seed);
  const timingStd = Math.max(0, op.timingStddevTicks);
  const velStd = Math.max(0, op.velocityStddev);

  for (const n of candidates) {
    const dt = timingStd > 0 ? Math.round(randNormal(rnd) * timingStd) : 0;
    const dv = velStd > 0 ? randNormal(rnd) * velStd : 0;
    n.startTick = Math.max(0, n.startTick + dt);
    n.endTick = n.startTick + n.durationTicks;
    n.velocity = clampVelocity(n.velocity + dv);
    if (!scopeContains(scope, n)) return { ok: false, warn: ["humanize would leave scope"] };
  }

  return {
    ok: true,
    inverse: restore.length
      ? [
          {
            kind: "delete_notes",
            opId: `invdel_${op.opId}`,
            scopeId: op.scopeId,
            trackIndex: op.trackIndex,
            noteIds: restore.map((n) => n.id)
          },
          {
            kind: "add_notes",
            opId: `invadd_${op.opId}`,
            scopeId: op.scopeId,
            trackIndex: op.trackIndex,
            notes: restore
          }
        ]
      : []
  };
};
