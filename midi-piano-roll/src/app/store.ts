import type { MeasureMap } from "../lib/midi/measureMap";
import type { TempoMap } from "../lib/midi/tempoMap";
import type { ProjectState } from "../lib/compose/state";
import type { Scope } from "../lib/agent/scope";
import type { NoteLike } from "../lib/view/render";

export type AgentTimelineEvent =
  | { type: "status"; message: string; at: number }
  | { type: "error"; message: string; at: number }
  | { type: "thinking"; text: string; at: number }
  | { type: "tool_call_started"; name: string; argsPreview: string; at: number }
  | { type: "tool_call_delta"; name: string; argsPreview: string; at: number }
  | { type: "tool_call_done"; name: string; argsPreview: string; at: number }
  | { type: "tool_applied"; name: string; ok: boolean; warnings?: string[]; outputText?: string; at: number };

export type AgentStepSnapshot = {
  stepIndex: number;
  toolName: string;
  notes: NoteLike[];
  at: number;
};

export type AppState = {
  project: {
    liveState: ProjectState | null;
    proposal:
      | {
          scope: Scope;
          baseState: ProjectState;
          draftState: ProjectState;
          ops: import("../lib/compose/ops").ComposeOp[];
          diff: import("../lib/compose/diff").DiffResult;
          warnings: string[];
          musicalSummary?: string;
        }
      | null;
    selectedTrackIndex: number;
    measureMap: MeasureMap | null;
    tempoMap: TempoMap | null;
  };
  ui: {
    showOverlays: boolean;
    gridSubdivision: 4 | 8 | 16;
    noteColorMode: "default" | "velocity" | "track";
    scopeSelectMode: boolean;
    scopeRect: { tickStart: number; tickEnd: number; pitchMin: number; pitchMax: number } | null;
    scrubMode: boolean;
    previewMode: "draft" | "base";
  };
  transport: {
    isPlaying: boolean;
    playheadTick: number;
    tempoOverrideEnabled: boolean;
    tempoOverrideBpm: number;
    metronomeEnabled: boolean;
    volume: number;
    tone: "triangle" | "sawtooth";
    playAllTracks: boolean;
    loopEnabled: boolean;
    startMode: "playhead" | "bar" | "scope";
    loopMode: "scope" | "selection";
  };
  agent: {
    running: boolean;
    streamingDraftState: ProjectState | null;
    timeline: AgentTimelineEvent[];
    stepSnapshots: AgentStepSnapshot[];
    stepIndex: number;
    activeTool?: { name: string; argsPreview: string };
  };
};

export type StoreListener = (state: AppState) => void;

const initialState: AppState = {
  project: {
    liveState: null,
    proposal: null,
    selectedTrackIndex: 0,
    measureMap: null,
    tempoMap: null
  },
  ui: {
    showOverlays: true,
    gridSubdivision: 4,
    noteColorMode: "default",
    scopeSelectMode: false,
    scopeRect: null,
    scrubMode: false,
    previewMode: "draft"
  },
  transport: {
    isPlaying: false,
    playheadTick: 0,
    tempoOverrideEnabled: false,
    tempoOverrideBpm: 120,
    metronomeEnabled: false,
    volume: 0.6,
    tone: "triangle",
    playAllTracks: false,
    loopEnabled: false,
    startMode: "playhead",
    loopMode: "scope"
  },
  agent: {
    running: false,
    streamingDraftState: null,
    timeline: [],
    stepSnapshots: [],
    stepIndex: 0
  }
};

let state: AppState = initialState;
const listeners = new Set<StoreListener>();

export const getState = (): AppState => state;

export const setState = (next: AppState | ((prev: AppState) => AppState)): void => {
  state = typeof next === "function" ? next(state) : next;
  for (const l of listeners) l(state);
};

export const updateState = (updater: (prev: AppState) => AppState): void => setState(updater);

export const subscribe = (listener: StoreListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const resetState = (): void => {
  state = initialState;
  for (const l of listeners) l(state);
};
