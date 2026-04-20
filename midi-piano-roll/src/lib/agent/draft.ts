import { MeasureMap } from "../midi/measureMap";
import type { TimeSigEvent } from "../midi/types";
import { applyOps } from "../compose/apply";
import { MAX_OPS_PER_PROPOSAL } from "../compose/limits";
import type { ComposeOp } from "../compose/ops";
import type { ProjectState, TrackState } from "../compose/state";
import { diffNotes } from "../compose/diff";
import type { Scope } from "./scope";
import { normalizeScope } from "./scope";

export type Proposal = {
  proposalId: string;
  scopeId: string;
  scope: Scope;
  baseState: ProjectState;
  draftState: ProjectState;
  ops: ComposeOp[];
  diffStats: { added: number; removed: number; modified: number };
  warnings: string[];
  musicalSummary?: string;
};

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

const newId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
};

const trackByIndex = (state: ProjectState, trackIndex: number): TrackState | null =>
  state.tracks.find((t) => t.trackIndex === trackIndex) ?? null;

export class DraftSession {
  readonly scopeId: string;
  readonly scope: Scope;
  readonly baseState: ProjectState;
  draftState: ProjectState;
  readonly opLog: ComposeOp[] = [];
  readonly warnings: string[] = [];

  constructor(liveState: ProjectState, scope: Scope, scopeId?: string) {
    this.scopeId = scopeId ?? newId();
    this.scope = normalizeScope(scope);
    this.baseState = cloneState(liveState);
    this.draftState = cloneState(liveState);
  }

  getMeasureMap(): MeasureMap {
    const timeSignatures: TimeSigEvent[] = this.draftState.timeSignatures.length
      ? this.draftState.timeSignatures
      : [{ tick: 0, numerator: 4, denominator: 4 }];
    return new MeasureMap(this.draftState.ppq, timeSignatures, this.draftState.maxTick);
  }

  getTrack(): TrackState {
    const t = trackByIndex(this.draftState, this.scope.trackIndex);
    if (!t) throw new Error(`track not found: ${this.scope.trackIndex}`);
    return t;
  }

  apply(op: ComposeOp): { applied: boolean; warnings: string[] } {
    if (op.scopeId !== this.scopeId) return { applied: false, warnings: ["invalid scopeId"] };
    if (this.opLog.length >= MAX_OPS_PER_PROPOSAL) return { applied: false, warnings: ["opLog cap reached"] };

    const res = applyOps(this.draftState, [op], this.scope);
    this.draftState = res.nextState;
    this.warnings.push(...res.warnings);

    if (res.appliedOps.length === 0) {
      return {
        applied: false,
        warnings: [...res.warnings, ...res.rejectedOps.map((r) => r.reason)]
      };
    }

    this.opLog.push(op);
    return { applied: true, warnings: res.warnings };
  }

  finalize(musicalSummary?: string): Proposal {
    const baseTrack = trackByIndex(this.baseState, this.scope.trackIndex);
    const draftTrack = trackByIndex(this.draftState, this.scope.trackIndex);
    if (!baseTrack || !draftTrack) throw new Error("missing track during finalize");

    const diff = diffNotes(baseTrack, draftTrack, this.scope);
    return {
      proposalId: newId(),
      scopeId: this.scopeId,
      scope: this.scope,
      baseState: this.baseState,
      draftState: this.draftState,
      ops: [...this.opLog],
      diffStats: diff.counts,
      warnings: [...this.warnings],
      musicalSummary
    };
  }
}

