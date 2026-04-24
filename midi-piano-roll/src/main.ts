import "./styles/app.css";

import { MeasureMap } from "./lib/midi/measureMap";
import { parseMidi } from "./lib/midi/parse";
import { TempoMap } from "./lib/midi/tempoMap";
import type { MidiProject } from "./lib/midi/types";
import { applyOps } from "./lib/compose/apply";
import { fromParsedMidiProject, toMidiFile } from "./lib/compose/convert";
import type { ProjectState, TrackState, Note } from "./lib/compose/state";
import { diffNotes } from "./lib/compose/diff";
import { globalScopeForTrack, type Scope } from "./lib/agent/scope";
import { runComposerAgent, type AgentStreamEvent } from "./lib/agent/orchestrator";
import { Camera } from "./lib/view/camera";
import { PianoRollController } from "./lib/view/interaction";
import {
  pitchToName,
  renderKeyboard,
  renderNotes,
  renderOverlay,
  renderRollGrid,
  renderRuler,
  type RenderTheme,
  type NoteLike
} from "./lib/view/render";
import { createLayout } from "./ui/layout";
import { getState, updateState } from "./app/store";
import type { AgentTimelineEvent } from "./app/store";
import { AudioEngine } from "./lib/audio/engine";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const layout = createLayout();
app.append(layout.root);
layout.header.overlayToggle.classList.add("active");
layout.transport.tempoOverrideToggle.checked = getState().transport.tempoOverrideEnabled;
layout.transport.tempoOverrideInput.value = String(getState().transport.tempoOverrideBpm);
layout.transport.volumeInput.value = String(getState().transport.volume);
layout.transport.toneSelect.value = getState().transport.tone;
layout.transport.startModeSelect.value = getState().transport.startMode;
layout.transport.loopModeSelect.value = getState().transport.loopMode;
layout.header.gridSelect.value = String(getState().ui.gridSubdivision);
layout.header.colorSelect.value = getState().ui.noteColorMode;
layout.transport.loopToggle.classList.toggle("active", getState().transport.loopEnabled);
layout.transport.metronomeToggle.classList.toggle("active", getState().transport.metronomeEnabled);

const theme = readTheme();
const camera = new Camera();
const audio = new AudioEngine();

const rulerCtx = mustCtx(layout.stage.rulerCanvas);
const gridCtx = mustCtx(layout.stage.gridCanvas);
const notesCtx = mustCtx(layout.stage.notesCanvas);
const overlayCtx = mustCtx(layout.stage.overlayCanvas);
const keyboardCtx = mustCtx(layout.stage.keyboardCanvas);

let parsedProject: MidiProject | null = null;
let notesById: Map<string, Note> = new Map();
let agentAbort: AbortController | null = null;
let lastPlayheadTick = 0;
const undoStack: import("./lib/compose/ops").ComposeOp[][] = [];

const MUTATING_TOOL_NAMES = new Set([
  "place_note",
  "edit_note",
  "add_notes",
  "delete_notes",
  "move_notes",
  "resize_notes",
  "set_velocity",
  "clear_range",
  "quantize",
  "humanize",
  "add_chord_progression",
  "arpeggiate",
  "add_drums_pattern"
]);

const defaultPitchRange = (): { min: number; max: number } => ({ min: 48, max: 84 });
const computePitchRange = (notes: Note[]): { min: number; max: number } => {
  if (notes.length === 0) return defaultPitchRange();
  const min = notes.reduce((m, n) => Math.min(m, n.pitch), 127);
  const max = notes.reduce((m, n) => Math.max(m, n.pitch), 0);
  return { min, max };
};

const getActiveState = (): ProjectState | null => {
  const state = getState();
  if (state.ui.scrubMode && state.agent.stepSnapshots[state.agent.stepIndex]) {
    return state.project.proposal?.draftState ?? state.project.liveState;
  }
  if (state.agent.running && state.agent.streamingDraftState) return state.agent.streamingDraftState;
  if (state.project.proposal && state.ui.previewMode === "base") return state.project.proposal.baseState;
  if (state.project.proposal && state.ui.previewMode === "draft") return state.project.proposal.draftState;
  return state.project.liveState;
};

const getActiveTrack = (): TrackState | null => {
  const state = getActiveState();
  if (!state) return null;
  const idx = getState().project.selectedTrackIndex;
  return state.tracks.find((x) => x.trackIndex === idx) ?? null;
};

const getDisplayNotes = (): NoteLike[] => {
  const state = getState();
  if (state.ui.scrubMode) {
    const snap = state.agent.stepSnapshots[state.agent.stepIndex];
    if (snap) return snap.notes;
  }
  const track = getActiveTrack();
  return track ? track.notes : [];
};

const recomputeMaps = (): void => {
  updateState((s) => {
    const active = getActiveState();
    if (!active) return { ...s, project: { ...s.project, measureMap: null, tempoMap: null } };
    const tempoMap = new TempoMap(active.ppq, active.tempos, active.maxTick);
    const measureMap = new MeasureMap(active.ppq, active.timeSignatures, Math.max(active.maxTick, 1));
    return { ...s, project: { ...s.project, tempoMap, measureMap } };
  });
};

const getTempoMapForTransport = (): TempoMap | null => {
  const s = getState();
  const base = s.project.tempoMap;
  if (!base || !s.project.liveState) return base;
  if (!s.transport.tempoOverrideEnabled) return base;
  const override = Math.max(20, Math.min(300, s.transport.tempoOverrideBpm));
  return new TempoMap(s.project.liveState.ppq, [{ tick: 0, bpm: override }], s.project.liveState.maxTick);
};

const getLoopRange = (): { startTick: number; endTick: number } | null => {
  const s = getState();
  if (!s.transport.loopEnabled) return null;
  const scope = s.ui.scopeRect;
  if (s.transport.loopMode === "scope" && scope) return { startTick: scope.tickStart, endTick: scope.tickEnd };
  const track = getActiveTrack();
  if (!track || track.notes.length === 0) return null;
  const min = Math.min(...track.notes.map((n) => n.startTick));
  const max = Math.max(...track.notes.map((n) => n.endTick));
  return { startTick: min, endTick: max };
};

const controller = new PianoRollController({
  rollElement: layout.stage.rollWrap,
  rulerElement: layout.stage.rulerWrap,
  camera,
  getLimits: () => {
    const track = getActiveTrack();
    const maxTick = getActiveState()?.maxTick ?? 0;
    const range = track ? computePitchRange(track.notes) : defaultPitchRange();
    const pitchMinRaw = range.min;
    const pitchMaxRaw = range.max;
    const pitchMin = Math.max(0, pitchMinRaw - 12);
    const pitchMax = Math.min(127, pitchMaxRaw + 12);
    return { maxTick, pitchMin, pitchMax };
  },
  getNotes: () => getDisplayNotes(),
  getMeasureMap: () => getState().project.measureMap,
  getTempoMap: () => getTempoMapForTransport(),
  getLoopRange: () => getLoopRange(),
  requestRender: () => renderAll(),
  onCursor: (info) => {
    const tick = Math.max(0, info.tick);
    const pitch = Math.max(0, Math.min(127, Math.round(info.pitch)));
    const pitchName = pitchToName(pitch);
    const mm = getState().project.measureMap;
    const mbt = mm ? mm.tickToBarBeatTick(tick) : null;
    const mbtText = mbt ? `${mbt.bar}:${mbt.beat}:${mbt.tick}` : `tick ${Math.round(tick)}`;
    layout.stage.hudReadout.textContent = `Cursor ${mbtText} • ${pitchName}${info.noteId ? " • note" : ""}`;
  },
  onSelectionChange: (sel) => updateInspector(sel),
  onPlayheadChange: (tick) => {
    updateState((s) => ({ ...s, transport: { ...s.transport, playheadTick: tick } }));
    if (getState().transport.isPlaying && tick + 1 < lastPlayheadTick) {
      audio.stop();
      startAudioFromTransport();
    }
    lastPlayheadTick = tick;
    renderHud();
  },
  onPlayingChange: (isPlaying) => {
    updateState((s) => ({ ...s, transport: { ...s.transport, isPlaying } }));
    layout.transport.playBtn.textContent = isPlaying ? "Stop" : "Play";
    if (isPlaying) startAudioFromTransport();
    else audio.stop();
  },
  getScopeSelectEnabled: () => getState().ui.scopeSelectMode,
  onScopeSelect: (range) => {
    updateState((s) => ({
      ...s,
      ui: { ...s.ui, scopeRect: range, scopeSelectMode: false }
    }));
    layout.agent.scopeModeToggle.classList.remove("active");
    layout.agent.scopeModeToggle.textContent = "Draw scope";
    renderAll();
  }
});

layout.transport.playBtn.addEventListener("click", () => controller.togglePlay());
layout.transport.loopToggle.addEventListener("click", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, loopEnabled: !s.transport.loopEnabled } }));
  layout.transport.loopToggle.classList.toggle("active", getState().transport.loopEnabled);
});
layout.transport.metronomeToggle.addEventListener("click", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, metronomeEnabled: !s.transport.metronomeEnabled } }));
  layout.transport.metronomeToggle.classList.toggle("active", getState().transport.metronomeEnabled);
});
layout.transport.tempoOverrideToggle.addEventListener("change", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, tempoOverrideEnabled: layout.transport.tempoOverrideToggle.checked } }));
});
layout.transport.tempoOverrideInput.addEventListener("input", () => {
  const bpm = Number(layout.transport.tempoOverrideInput.value || "120");
  updateState((s) => ({ ...s, transport: { ...s.transport, tempoOverrideBpm: bpm } }));
});
layout.transport.volumeInput.addEventListener("input", () => {
  const v = Number(layout.transport.volumeInput.value || "0.6");
  updateState((s) => ({ ...s, transport: { ...s.transport, volume: v } }));
  audio.setVolume(v);
});
layout.transport.toneSelect.addEventListener("change", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, tone: layout.transport.toneSelect.value as any } }));
});
layout.transport.startModeSelect.addEventListener("change", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, startMode: layout.transport.startModeSelect.value as any } }));
});
layout.transport.loopModeSelect.addEventListener("change", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, loopMode: layout.transport.loopModeSelect.value as any } }));
});

layout.header.overlayToggle.addEventListener("click", () => {
  updateState((s) => ({ ...s, ui: { ...s.ui, showOverlays: !s.ui.showOverlays } }));
  layout.header.overlayToggle.classList.toggle("active", getState().ui.showOverlays);
  renderAll();
});
layout.header.gridSelect.addEventListener("change", () => {
  updateState((s) => ({ ...s, ui: { ...s.ui, gridSubdivision: Number(layout.header.gridSelect.value) as any } }));
  renderAll();
});
layout.header.colorSelect.addEventListener("change", () => {
  updateState((s) => ({ ...s, ui: { ...s.ui, noteColorMode: layout.header.colorSelect.value as any } }));
  renderAll();
});
layout.header.helpBtn.addEventListener("click", () => layout.modal.shortcuts.classList.remove("hidden"));
layout.modal.shortcutsClose.addEventListener("click", () => layout.modal.shortcuts.classList.add("hidden"));
layout.modal.shortcuts.addEventListener("click", () => layout.modal.shortcuts.classList.add("hidden"));
layout.modal.shortcuts.querySelector(".modal-card")?.addEventListener("click", (e) => e.stopPropagation());

layout.header.newBtn.addEventListener("click", () => {
  parsedProject = null;
  controller.stop();
  initProject(createBlankProject());
  layout.agent.status.textContent = "Blank project ready. Enter a prompt and click Compose.";
});

layout.header.exportBtn.addEventListener("click", () => {
  const liveState = getState().project.liveState;
  if (!liveState) return;
  const bytes = toMidiFile(liveState);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "export.mid";
  a.click();
  URL.revokeObjectURL(url);
});

layout.header.fileInput.addEventListener("change", async () => {
  const file = layout.header.fileInput.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    parsedProject = parseMidi(buf);
  } catch (err) {
    parsedProject = null;
    updateState((s) => ({ ...s, project: { ...s.project, liveState: null, proposal: null, tempoMap: null, measureMap: null } }));
    controller.stop();
    renderAll();
    console.error(err);
    alert("Failed to parse MIDI file.");
    return;
  }
  initProject(fromParsedMidiProject(parsedProject));
});

layout.project.playAllTracksToggle.addEventListener("click", () => {
  updateState((s) => ({ ...s, transport: { ...s.transport, playAllTracks: !s.transport.playAllTracks } }));
  layout.project.playAllTracksToggle.textContent = getState().transport.playAllTracks ? "Play: All" : "Play: Track";
});

layout.project.scopePresetBar.addEventListener("click", () => {
  const mm = getState().project.measureMap;
  if (!mm) return;
  const tickStart = barToTick(mm, 1);
  const tickEnd = barToTick(mm, 9);
  updateState((s) => ({ ...s, ui: { ...s.ui, scopeRect: { tickStart, tickEnd, pitchMin: 0, pitchMax: 127 } } }));
  renderAll();
});
layout.project.scopePresetSelection.addEventListener("click", () => {
  const track = getActiveTrack();
  if (!track || controller.selection.size === 0) return;
  const notes = track.notes.filter((n) => controller.selection.has(n.id));
  if (!notes.length) return;
  const tickStart = Math.min(...notes.map((n) => n.startTick));
  const tickEnd = Math.max(...notes.map((n) => n.endTick));
  const pitchMin = Math.min(...notes.map((n) => n.pitch));
  const pitchMax = Math.max(...notes.map((n) => n.pitch));
  updateState((s) => ({ ...s, ui: { ...s.ui, scopeRect: { tickStart, tickEnd, pitchMin, pitchMax } } }));
  renderAll();
});
layout.project.scopePresetVisible.addEventListener("click", () => {
  const range = camera.visibleTickRange();
  const pitchRange = camera.visiblePitchRange();
  updateState((s) => ({
    ...s,
    ui: {
      ...s.ui,
      scopeRect: {
        tickStart: Math.max(0, Math.floor(range.min)),
        tickEnd: Math.max(0, Math.ceil(range.max)),
        pitchMin: Math.max(0, Math.floor(pitchRange.min)),
        pitchMax: Math.min(127, Math.ceil(pitchRange.max))
      }
    }
  }));
  renderAll();
});

layout.agent.scopeModeToggle.addEventListener("click", () => {
  updateState((s) => ({ ...s, ui: { ...s.ui, scopeSelectMode: !s.ui.scopeSelectMode } }));
  layout.agent.scopeModeToggle.classList.toggle("active", getState().ui.scopeSelectMode);
  layout.agent.scopeModeToggle.textContent = getState().ui.scopeSelectMode ? "Draw scope: On" : "Draw scope";
});

layout.agent.scrubRange.addEventListener("input", () => {
  const idx = Number(layout.agent.scrubRange.value);
  updateState((s) => ({ ...s, ui: { ...s.ui, scrubMode: true }, agent: { ...s.agent, stepIndex: idx } }));
  updateScrubber();
  renderAll();
});
layout.agent.scrubBaseBtn.addEventListener("click", () => {
  updateState((s) => ({ ...s, ui: { ...s.ui, scrubMode: true }, agent: { ...s.agent, stepIndex: 0 } }));
  layout.agent.scrubRange.value = "0";
  renderAll();
});
layout.agent.scrubLatestBtn.addEventListener("click", () => {
  const last = Math.max(0, getState().agent.stepSnapshots.length - 1);
  updateState((s) => ({ ...s, ui: { ...s.ui, scrubMode: true }, agent: { ...s.agent, stepIndex: last } }));
  layout.agent.scrubRange.value = String(last);
  renderAll();
});
layout.agent.scrubReplayBtn.addEventListener("click", () => replaySteps());
layout.agent.auditionBtn.addEventListener("click", () => auditionStep());

layout.agent.runBtn.addEventListener("click", () => runAgent());
layout.agent.stopBtn.addEventListener("click", () => {
  if (!agentAbort) return;
  layout.agent.stopBtn.disabled = true;
  layout.agent.status.textContent = "Cancelling…";
  agentAbort.abort();
});
layout.agent.applyBtn.addEventListener("click", () => applyProposal());
layout.agent.rejectBtn.addEventListener("click", () => rejectProposal());
layout.agent.undoBtn.addEventListener("click", () => undoLast());

layout.project.trackSearch.addEventListener("input", () => renderTrackList());

const ro = new ResizeObserver(() => {
  resizeCanvases();
  renderAll();
});
ro.observe(layout.stage.rollWrap);
ro.observe(layout.stage.rulerWrap);
ro.observe(layout.stage.keyboardWrap);

const createBlankProject = (): ProjectState => {
  const ppq = 480;
  const bars = 8;
  return {
    ppq,
    tempos: [{ tick: 0, bpm: 120 }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    tracks: [
      {
        trackIndex: 0,
        name: "Track 1",
        channel: 0,
        notes: []
      }
    ],
    maxTick: ppq * 4 * bars
  };
};

const initProject = (state: ProjectState): void => {
  updateState((s) => ({
    ...s,
    project: { ...s.project, liveState: state, proposal: null },
    agent: { ...s.agent, stepSnapshots: [], stepIndex: 0, timeline: [] }
  }));
  recomputeMaps();
  const first = state.tracks.find((t) => t.notes.length > 0) ?? state.tracks[0] ?? null;
  if (first) setTrackIndex(first.trackIndex);
  renderTrackList();
  refreshAgentButtons();
  updateScrubber();
  layout.project.playAllTracksToggle.textContent = getState().transport.playAllTracks ? "Play: All" : "Play: Track";
};

const setTrackIndex = (trackIndex: number): void => {
  updateState((s) => ({ ...s, project: { ...s.project, selectedTrackIndex: trackIndex } }));
  const track = getActiveTrack();
  if (!track) return;
  notesById = new Map(track.notes.map((n) => [n.id, n]));
  controller.stop();
  controller.clearSelection();
  controller.setPlayheadTick(0);
  renderTrackList();

  const rollRect = layout.stage.rollWrap.getBoundingClientRect();
  const maxTick = getActiveState()?.maxTick ?? 1;
  camera.pixelsPerTick = clamp((rollRect.width * 0.9) / Math.max(1, maxTick), 0.01, 0.35);
  camera.noteHeightPx = 14;
  camera.scrollTick = 0;
  const range = computePitchRange(track.notes);
  const pitchMax = range.max;
  const pitchMin = range.min;
  camera.topPitch = Math.min(127, pitchMax + 10);
  camera.clampTo({
    maxTick,
    pitchMin: Math.max(0, pitchMin - 12),
    pitchMax: Math.min(127, pitchMax + 12)
  });

  recomputeMaps();
  renderAll();
};

const resizeCanvases = (): void => {
  const rollRect = layout.stage.rollWrap.getBoundingClientRect();
  const rulerRect = layout.stage.rulerWrap.getBoundingClientRect();
  const keyboardRect = layout.stage.keyboardWrap.getBoundingClientRect();

  resizeCanvas(layout.stage.gridCanvas, rollRect.width, rollRect.height);
  resizeCanvas(layout.stage.notesCanvas, rollRect.width, rollRect.height);
  resizeCanvas(layout.stage.overlayCanvas, rollRect.width, rollRect.height);
  resizeCanvas(layout.stage.rulerCanvas, rulerRect.width, rulerRect.height);
  resizeCanvas(layout.stage.keyboardCanvas, keyboardRect.width, keyboardRect.height);

  camera.setViewport(rollRect.width, rollRect.height);
  camera.clampTo({
    maxTick: getActiveState()?.maxTick ?? 0,
    pitchMin: 0,
    pitchMax: 127
  });
};

const renderAll = (): void => {
  const state = getActiveState();
  const track = getActiveTrack();
  const mm = getState().project.measureMap;
  if (!state || !track || !mm) {
    clearWithLabel(gridCtx, layout.stage.rollWrap, "Load a .mid/.midi file or start a blank project");
    notesCtx.clearRect(0, 0, layout.stage.notesCanvas.width, layout.stage.notesCanvas.height);
    overlayCtx.clearRect(0, 0, layout.stage.overlayCanvas.width, layout.stage.overlayCanvas.height);
    clearWithLabel(rulerCtx, layout.stage.rulerWrap, "");
    clearWithLabel(keyboardCtx, layout.stage.keyboardWrap, "");
    layout.transport.playBtn.disabled = true;
    return;
  }

  renderRollGrid(gridCtx, camera, mm, theme, getState().ui.gridSubdivision);
  layout.transport.playBtn.disabled = track.notes.length === 0;
  layout.project.tempoSummary.textContent = `Tempo: ${state.tempos[0]?.bpm ?? 120} BPM`;
  const ts = state.timeSignatures[0];
  layout.project.timeSigSummary.textContent = ts ? `Time: ${ts.numerator}/${ts.denominator}` : "Time: —";

  const p = getState().project.proposal;
  if (p && getState().ui.previewMode === "draft") {
    const baseTrack = p.baseState.tracks.find((t) => t.trackIndex === p.scope.trackIndex) ?? null;
    const draftTrack = p.draftState.tracks.find((t) => t.trackIndex === p.scope.trackIndex) ?? null;
    const removedNotes: NoteLike[] = [];
    if (baseTrack && draftTrack) {
      for (const id of p.diff.removedIds) {
        const n = baseTrack.notes.find((x) => x.id === id);
        if (n) removedNotes.push(n);
      }
    }
    renderNotes(notesCtx, camera, getDisplayNotes(), controller.selection, controller.hoverId, theme, {
      addedIds: p.diff.addedIds,
      modifiedIds: p.diff.modifiedIds,
      removedNotes
    }, getState().ui.noteColorMode);
  } else {
    renderNotes(notesCtx, camera, getDisplayNotes(), controller.selection, controller.hoverId, theme, undefined, getState().ui.noteColorMode);
  }
  const showOverlays = getState().ui.showOverlays;
  const scopeRect = getState().ui.scopeRect;
  const scopeMarquee = showOverlays
    ? controller.scopeMarquee
      ? controller.scopeMarquee
      : scopeRect
        ? {
            x: Math.min(camera.tickToX(scopeRect.tickStart), camera.tickToX(scopeRect.tickEnd)),
            y: Math.min(camera.pitchToY(scopeRect.pitchMax), camera.pitchToY(scopeRect.pitchMin)),
            w: Math.abs(camera.tickToX(scopeRect.tickEnd) - camera.tickToX(scopeRect.tickStart)),
            h: Math.abs(camera.pitchToY(scopeRect.pitchMin) - camera.pitchToY(scopeRect.pitchMax))
          }
        : null
    : null;
  renderOverlay(overlayCtx, camera, controller.playheadTick, showOverlays ? controller.marquee : null, scopeMarquee, theme);
  renderRuler(rulerCtx, camera, mm, theme);
  renderKeyboard(keyboardCtx, camera, theme);

  renderHud();
  renderDiffCard();
};

const renderHud = (): void => {
  const s = getState();
  const mm = s.project.measureMap;
  const tm = getTempoMapForTransport();
  const tick = s.transport.playheadTick;
  const mbt = mm ? mm.tickToBarBeatTick(tick) : null;
  const bpm = tm ? bpmAtTick(tm, tick) : null;
  layout.transport.bpmReadout.textContent = bpm ? `BPM: ${bpm.toFixed(1)}` : "BPM: —";
  if (mbt) {
    layout.stage.hudReadout.textContent = `Bar ${mbt.bar}:${mbt.beat}:${mbt.tick} • Zoom ${camera.pixelsPerTick.toFixed(
      3
    )} px/tick`;
  }
};

const renderDiffCard = (): void => {
  const p = getState().project.proposal;
  if (!p) {
    layout.stage.diffCard.classList.add("hidden");
    return;
  }
  layout.stage.diffCard.classList.remove("hidden");
  layout.stage.diffCard.innerHTML = "";
  const mode = getState().ui.previewMode;
  const header = document.createElement("div");
  header.className = "diff-title";
  header.textContent = `Proposal: +${p.diff.counts.added} −${p.diff.counts.removed} ~${p.diff.counts.modified}`;
  const summary = document.createElement("div");
  summary.className = "diff-summary";
  summary.textContent = `${p.warnings.length ? `${p.warnings.length} warnings • ` : ""}${p.musicalSummary ?? ""}`;
  const toggle = document.createElement("div");
  toggle.className = "row";
  const baseBtn = document.createElement("button");
  baseBtn.className = `btn ${mode === "base" ? "active" : ""}`;
  baseBtn.textContent = "View Base";
  const draftBtn = document.createElement("button");
  draftBtn.className = `btn ${mode === "draft" ? "active" : ""}`;
  draftBtn.textContent = "View Draft";
  baseBtn.addEventListener("click", () => {
    updateState((s) => ({ ...s, ui: { ...s.ui, previewMode: "base" } }));
    recomputeMaps();
    renderAll();
  });
  draftBtn.addEventListener("click", () => {
    updateState((s) => ({ ...s, ui: { ...s.ui, previewMode: "draft" } }));
    recomputeMaps();
    renderAll();
  });
  toggle.append(baseBtn, draftBtn);
  layout.stage.diffCard.append(header, summary, toggle);
};

const updateInspector = (sel: ReadonlySet<string>): void => {
  const selected = [...sel];
  const count = selected.length;
  const first = selected[0] ? notesById.get(selected[0]) ?? null : null;
  const mm = getState().project.measureMap;
  const firstText = first
    ? `${pitchToName(first.pitch)} • start ${formatTick(mm, first.startTick)} • dur ${first.durationTicks} ticks`
    : "—";
  layout.stage.hudReadout.textContent = `Selection ${count} • ${firstText}`;
};

const formatTick = (mm: MeasureMap | null, tick: number): string => {
  if (!mm) return `${Math.round(tick)} ticks`;
  const mbt = mm.tickToBarBeatTick(tick);
  return `${mbt.bar}:${mbt.beat}:${mbt.tick}`;
};

const renderTrackList = (): void => {
  const state = getState();
  const list = layout.project.trackList;
  list.innerHTML = "";
  const live = state.project.liveState;
  if (!live) return;
  const query = layout.project.trackSearch.value.trim().toLowerCase();
  for (const t of live.tracks) {
    if (query && !t.name.toLowerCase().includes(query)) continue;
    const row = document.createElement("div");
    row.className = `track-row ${state.project.selectedTrackIndex === t.trackIndex ? "active" : ""}`;
    row.textContent = `${t.name} • ${t.notes.length} notes`;
    row.addEventListener("click", () => setTrackIndex(t.trackIndex));
    list.append(row);
  }
};

const refreshAgentButtons = (): void => {
  const s = getState();
  const hasLive = Boolean(s.project.liveState);
  const hasProposal = Boolean(s.project.proposal);
  const running = s.agent.running;
  layout.agent.runBtn.disabled = running || !hasLive || hasProposal;
  layout.agent.stopBtn.disabled = !running;
  layout.agent.applyBtn.disabled = running || !hasProposal;
  layout.agent.rejectBtn.disabled = running || !hasProposal;
  layout.agent.applyBtn.parentElement?.classList.toggle("hidden", !hasProposal);
  layout.agent.undoBtn.disabled = running || undoStack.length === 0;
  layout.header.exportBtn.disabled = running || !hasLive;
  layout.agent.stepModeInput.disabled = running || !hasLive || hasProposal;
  layout.agent.presetSelect.disabled = running;
  layout.agent.promptArea.disabled = running;
  layout.header.agentStatus.textContent = running ? "Agent: Streaming" : "Agent: Ready";
};

const barToTick = (mm: MeasureMap, bar: number): number => {
  const target = Math.max(1, Math.round(bar)) - 1;
  const found = mm.measureStarts.find((m) => m.measureIndex === target);
  if (found) return found.tick;
  const starts = mm.measureStarts;
  if (starts.length >= 2) {
    const last = starts[starts.length - 1]!;
    const prev = starts[starts.length - 2]!;
    const delta = last.tick - prev.tick;
    return last.tick + Math.max(0, target - last.measureIndex) * delta;
  }
  return target * mm.ppq * 4;
};

const bpmAtTick = (tm: TempoMap, tick: number): number => {
  const t = Math.max(0, tick);
  for (let i = tm.segments.length - 1; i >= 0; i--) {
    const seg = tm.segments[i]!;
    if (t >= seg.startTick) return seg.bpm;
  }
  return tm.segments[0]?.bpm ?? 120;
};

const startAudioFromTransport = async (): Promise<void> => {
  const s = getState();
  const live = getActiveState();
  const mm = s.project.measureMap;
  const tm = getTempoMapForTransport();
  if (!live || !mm || !tm) return;

  let fromTick = s.transport.playheadTick;
  if (s.transport.startMode === "bar") {
    fromTick = barToTick(mm, mm.tickToBarBeatTick(fromTick).bar);
    controller.setPlayheadTick(fromTick);
  } else if (s.transport.startMode === "scope" && s.ui.scopeRect) {
    fromTick = s.ui.scopeRect.tickStart;
    controller.setPlayheadTick(fromTick);
  }

  await audio.start({
    state: live,
    tempoMap: tm,
    measureMap: mm,
    fromTick,
    playAllTracks: s.transport.playAllTracks,
    selectedTrackIndex: s.project.selectedTrackIndex,
    metronomeEnabled: s.transport.metronomeEnabled,
    volume: s.transport.volume,
    tone: s.transport.tone
  });
};

const runAgent = async (): Promise<void> => {
  const state = getState();
  const liveState = state.project.liveState;
  const measureMap = state.project.measureMap;
  if (!liveState || !measureMap) return;
  const t = state.project.selectedTrackIndex;
  const startBar = Number(layout.agent.barStartInput.value || "1");
  const bars = Number(layout.agent.barsInput.value || "8");
  const tickStart = barToTick(measureMap, startBar);
  const tickEnd = barToTick(measureMap, startBar + Math.max(1, bars));

  const pitchMin = layout.agent.pitchMinInput.value ? Number(layout.agent.pitchMinInput.value) : undefined;
  const pitchMax = layout.agent.pitchMaxInput.value ? Number(layout.agent.pitchMaxInput.value) : undefined;
  const scope: Scope = state.ui.scopeRect
    ? {
        trackIndex: t,
        tickStart: state.ui.scopeRect.tickStart,
        tickEnd: state.ui.scopeRect.tickEnd,
        pitchMin: state.ui.scopeRect.pitchMin,
        pitchMax: state.ui.scopeRect.pitchMax
      }
    : { trackIndex: t, tickStart, tickEnd, pitchMin, pitchMax };

  agentAbort = new AbortController();
  const baseTrack = liveState.tracks.find((x) => x.trackIndex === scope.trackIndex);
  const baseNotes = baseTrack ? baseTrack.notes.map((n) => ({ ...n })) : [];
  updateState((s) => ({
    ...s,
    agent: {
      ...s.agent,
      running: true,
      streamingDraftState: liveState,
      timeline: [],
      stepSnapshots: [{ stepIndex: 0, toolName: "base", notes: baseNotes, at: Date.now() }],
      stepIndex: 0
    },
    project: { ...s.project, proposal: null },
    ui: { ...s.ui, scrubMode: false }
  }));
  updateScrubber();
  layout.agent.status.textContent = "Running agent (streaming)…";
  refreshAgentButtons();
  try {
    const p = await runComposerAgent({
      userPrompt: layout.agent.promptArea.value || "Make a small, tasteful musical improvement inside the scope.",
      stylePreset: (layout.agent.presetSelect.value === "none" ? undefined : (layout.agent.presetSelect.value as any)) ?? undefined,
      scope,
      liveState,
      stream: true,
      signal: agentAbort.signal,
      stepMode: layout.agent.stepModeInput.checked,
      stepMaxNotesPerAdd: 3,
      stepMaxSteps: 64,
      maxToolCalls: layout.agent.stepModeInput.checked ? 160 : undefined,
      onStreamEvent: (e) => onStreamEvent(e),
      onDraftUpdate: ({ draftState, lastTool }) => {
        if (!lastTool) return;
        const shouldSnapshot = MUTATING_TOOL_NAMES.has(lastTool.name);
        updateState((s) => {
          const track = draftState.tracks.find((x) => x.trackIndex === scope.trackIndex);
          const notes = track ? track.notes.map((n) => ({ ...n })) : [];
          const nextStepIndex = shouldSnapshot ? s.agent.stepSnapshots.length : s.agent.stepIndex;
          return {
            ...s,
            agent: {
              ...s.agent,
              streamingDraftState: draftState,
              stepSnapshots: shouldSnapshot
                ? [...s.agent.stepSnapshots, { stepIndex: nextStepIndex, toolName: lastTool.name, notes, at: Date.now() }]
                : s.agent.stepSnapshots,
              stepIndex: nextStepIndex
            }
          };
        });
        if (shouldSnapshot) updateScrubber();
        notesById = new Map((draftState.tracks.find((x) => x.trackIndex === scope.trackIndex)?.notes ?? []).map((n) => [n.id, n]));
        recomputeMaps();
        renderAll();
      }
    });

    if ((p.musicalSummary ?? "") === "Cancelled by user.") {
      updateState((s) => ({ ...s, agent: { ...s.agent, running: false } }));
      layout.agent.status.textContent = "Cancelled.";
      refreshAgentButtons();
      return;
    }

    const baseTrack = p.baseState.tracks.find((x) => x.trackIndex === scope.trackIndex)!;
    const draftTrack = p.draftState.tracks.find((x) => x.trackIndex === scope.trackIndex)!;
    const diff = diffNotes(baseTrack, draftTrack, scope);
    const res = applyOps(liveState, p.ops, scope);
    if (res.appliedOps.length > 0 && res.rejectedOps.length === 0) {
      undoStack.push(res.inverseOps);
      updateState((s) => ({
        ...s,
        project: { ...s.project, liveState: res.nextState, proposal: null },
        agent: { ...s.agent, running: false, streamingDraftState: null },
        ui: { ...s.ui, scrubMode: false, previewMode: "draft" }
      }));
      layout.agent.status.textContent = `Composed: +${diff.counts.added} −${diff.counts.removed} ~${diff.counts.modified}${
        p.warnings.length ? ` • warnings: ${p.warnings.length}` : ""
      }${p.musicalSummary ? `\n${p.musicalSummary}` : ""}`;
    } else {
      updateState((s) => ({
        ...s,
        project: { ...s.project, proposal: { scope, baseState: p.baseState, draftState: p.draftState, ops: p.ops, diff, warnings: p.warnings, musicalSummary: p.musicalSummary } },
        agent: { ...s.agent, running: false, streamingDraftState: null }
      }));
      layout.agent.status.textContent = `No composition committed${
        res.rejectedOps.length ? `: ${res.rejectedOps.map((r) => r.reason).join("; ")}` : ""
      }${p.musicalSummary ? `\n${p.musicalSummary}` : ""}`;
    }
    notesById = new Map(draftTrack.notes.map((n) => [n.id, n]));
    controller.clearSelection();
    recomputeMaps();
    renderAll();
  } catch (e) {
    layout.agent.status.textContent = `Failed to run agent: ${String(e)}`;
  } finally {
    updateState((s) => ({ ...s, agent: { ...s.agent, running: false, streamingDraftState: null } }));
    refreshAgentButtons();
    renderTimeline();
    updateScrubber();
  }
};

const onStreamEvent = (e: AgentStreamEvent): void => {
  const ev: AgentTimelineEvent | null = (() => {
    const at = Date.now();
    if (e.type === "status") return { type: "status", message: e.message, at };
    if (e.type === "error") return { type: "error", message: e.message, at };
    if (e.type === "tool_call_started") return { type: "tool_call_started", name: e.tool.name, argsPreview: "", at };
    if (e.type === "tool_call_delta") return { type: "tool_call_delta", name: e.tool.name, argsPreview: e.tool.argsJsonText.slice(-800), at };
    if (e.type === "tool_call_done") return { type: "tool_call_done", name: e.tool.name, argsPreview: e.tool.argsJsonText.slice(-800), at };
    if (e.type === "tool_applied") return { type: "tool_applied", name: e.tool.name, ok: e.ok, warnings: e.warnings, outputText: e.outputText, at };
    return null;
  })();
  if (!ev) return;
  updateState((s) => ({ ...s, agent: { ...s.agent, timeline: [...s.agent.timeline, ev] } }));
  renderTimeline();
};

const renderTimeline = (): void => {
  const list = layout.agent.timeline;
  list.innerHTML = "";
  for (const e of getState().agent.timeline.slice(-200)) {
    const item = document.createElement("div");
    item.className = `timeline-item ${e.type}`;
    if (e.type === "status" || e.type === "error") {
      item.textContent = `${e.type === "error" ? "Error" : "Status"}: ${e.message}`;
    } else if (e.type === "tool_applied") {
      item.textContent = `${e.ok ? "OK" : "FAIL"} ${e.name}${e.outputText ? ` • ${e.outputText}` : ""}`;
    } else {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `${e.type.replace("tool_call_", "tool ")} • ${e.name}`;
      const pre = document.createElement("pre");
      pre.textContent = e.argsPreview || "";
      details.append(summary, pre);
      item.append(details);
    }
    list.append(item);
  }
};

const updateScrubber = (): void => {
  const count = getState().agent.stepSnapshots.length;
  layout.agent.scrubRange.max = String(Math.max(0, count - 1));
  layout.agent.scrubRange.value = String(getState().agent.stepIndex);
  layout.agent.scrubLabel.textContent = `Step ${getState().agent.stepIndex}/${Math.max(0, count - 1)}`;
  layout.agent.scrubRange.disabled = count === 0;
  layout.agent.scrubReplayBtn.disabled = count <= 1;
  layout.agent.auditionBtn.disabled = count === 0;
};

const replaySteps = (): void => {
  const count = getState().agent.stepSnapshots.length;
  if (count === 0) return;
  let i = 0;
  const timer = window.setInterval(() => {
    if (i >= count) {
      window.clearInterval(timer);
      return;
    }
    updateState((s) => ({ ...s, ui: { ...s.ui, scrubMode: true }, agent: { ...s.agent, stepIndex: i } }));
    layout.agent.scrubRange.value = String(i);
    updateScrubber();
    renderAll();
    i += 1;
  }, 120);
};

const auditionStep = async (): Promise<void> => {
  const s = getState();
  const live = s.project.liveState;
  const mm = s.project.measureMap;
  const tm = getTempoMapForTransport();
  if (!live || !mm || !tm) return;
  const snap = s.agent.stepSnapshots[s.agent.stepIndex];
  if (!snap) return;
  await audio.start({
    state: { ...live, tracks: live.tracks.map((t) => (t.trackIndex === s.project.selectedTrackIndex ? { ...t, notes: snap.notes as any } : t)) },
    tempoMap: tm,
    measureMap: mm,
    fromTick: s.transport.playheadTick,
    playAllTracks: false,
    selectedTrackIndex: s.project.selectedTrackIndex,
    metronomeEnabled: s.transport.metronomeEnabled,
    volume: s.transport.volume,
    tone: s.transport.tone
  });
  setTimeout(() => audio.stop(), 1500);
};

const applyProposal = (): void => {
  const s = getState();
  const liveState = s.project.liveState;
  const proposal = s.project.proposal;
  if (!liveState || !proposal) return;
  const res = applyOps(liveState, proposal.ops, proposal.scope);
  if (res.appliedOps.length === 0) {
    layout.agent.status.textContent = `Apply failed: ${res.rejectedOps.map((r) => r.reason).join("; ")}`;
    return;
  }
  updateState((st) => ({
    ...st,
    project: { ...st.project, liveState: res.nextState, proposal: null },
    ui: { ...st.ui, scrubMode: false, previewMode: "draft" }
  }));
  undoStack.push(res.inverseOps);
  recomputeMaps();
  notesById = new Map((getActiveTrack()?.notes ?? []).map((n) => [n.id, n]));
  layout.agent.status.textContent = `Applied. Undo stack: ${undoStack.length}`;
  refreshAgentButtons();
  updateScrubber();
  renderAll();
};

const rejectProposal = (): void => {
  updateState((s) => ({
    ...s,
    project: { ...s.project, proposal: null },
    ui: { ...s.ui, previewMode: "draft", scrubMode: false }
  }));
  recomputeMaps();
  notesById = new Map((getActiveTrack()?.notes ?? []).map((n) => [n.id, n]));
  layout.agent.status.textContent = "Rejected proposal.";
  refreshAgentButtons();
  updateScrubber();
  renderAll();
};

const undoLast = (): void => {
  const liveState = getState().project.liveState;
  if (!liveState) return;
  const inv = undoStack.pop();
  if (!inv || inv.length === 0) {
    refreshAgentButtons();
    return;
  }
  const trackIndex = inv[0]?.trackIndex ?? getState().project.selectedTrackIndex;
  const res = applyOps(liveState, inv, globalScopeForTrack(trackIndex));
  updateState((s) => ({ ...s, project: { ...s.project, liveState: res.nextState } }));
  recomputeMaps();
  notesById = new Map((getActiveTrack()?.notes ?? []).map((n) => [n.id, n]));
  layout.agent.status.textContent = `Undone. Undo stack: ${undoStack.length}`;
  refreshAgentButtons();
  renderAll();
};

function mustCtx(canvasEl: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) throw new Error("2D canvas unsupported");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function resizeCanvas(canvasEl: HTMLCanvasElement, width: number, height: number): void {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (canvasEl.width !== w) canvasEl.width = w;
  if (canvasEl.height !== h) canvasEl.height = h;
}

function clearWithLabel(ctx: CanvasRenderingContext2D, host: HTMLElement, label: string): void {
  const rect = host.getBoundingClientRect();
  resizeCanvas(ctx.canvas, rect.width, rect.height);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!label) return;
  ctx.fillStyle = theme.muted;
  ctx.font = "14px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 16, ctx.canvas.height / 2);
}

function readTheme(): RenderTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--canvas", "#0b0d12"),
    keyWhite: v("--key-white", "rgba(255,255,255,0.035)"),
    keyBlack: v("--key-black", "rgba(0,0,0,0.26)"),
    gridMajor: v("--grid-major", "rgba(255,255,255,0.12)"),
    gridBeat: v("--grid-beat", "rgba(255,255,255,0.08)"),
    gridSub: v("--grid-sub", "rgba(255,255,255,0.035)"),
    note: v("--note", "#ff7a18"),
    noteSoft: v("--note-soft", "rgba(255,122,24,0.25)"),
    select: v("--select", "#7c4dff"),
    selectSoft: v("--select-soft", "rgba(124,77,255,0.25)"),
    playhead: v("--playhead", "#2ef2ff"),
    text: v("--text", "#e8eefc"),
    muted: v("--muted", "#8fa0c2")
  };
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

resizeCanvases();
renderAll();
refreshAgentButtons();
