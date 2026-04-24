import "./styles/app.css";

import { MeasureMap } from "./lib/midi/measureMap";
import { parseMidi } from "./lib/midi/parse";
import { TempoMap } from "./lib/midi/tempoMap";
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
import { parseThinkingText, toolActionText } from "./ui/agentTrace";
import { createLayout } from "./ui/layout";
import { getState, updateState } from "./app/store";
import type { AgentTimelineEvent } from "./app/store";
import { AudioEngine } from "./lib/audio/engine";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app");

const layout = createLayout();
app.append(layout.root);

const theme = readTheme();
const camera = new Camera();
const audio = new AudioEngine();

const rulerCtx = mustCtx(layout.stage.rulerCanvas);
const gridCtx = mustCtx(layout.stage.gridCanvas);
const notesCtx = mustCtx(layout.stage.notesCanvas);
const overlayCtx = mustCtx(layout.stage.overlayCanvas);
const keyboardCtx = mustCtx(layout.stage.keyboardCanvas);

let notesById: Map<string, Note> = new Map();
let agentAbort: AbortController | null = null;
let lastPlayheadTick = 0;
const undoStack: import("./lib/compose/ops").ComposeOp[][] = [];

const defaultPitchRange = (): { min: number; max: number } => ({ min: 48, max: 84 });
const computePitchRange = (notes: Note[]): { min: number; max: number } => {
  if (notes.length === 0) return defaultPitchRange();
  const min = notes.reduce((m, n) => Math.min(m, n.pitch), 127);
  const max = notes.reduce((m, n) => Math.max(m, n.pitch), 0);
  return { min, max };
};

const getActiveState = (): ProjectState | null => {
  const state = getState();
  if (state.agent.running && state.agent.streamingDraftState) return state.agent.streamingDraftState;
  return state.project.liveState;
};

const getActiveTrack = (): TrackState | null => {
  const state = getActiveState();
  if (!state) return null;
  const idx = getState().project.selectedTrackIndex;
  return state.tracks.find((x) => x.trackIndex === idx) ?? state.tracks[0] ?? null;
};

const getDisplayNotes = (): NoteLike[] => getActiveTrack()?.notes ?? [];

const recomputeMaps = (): void => {
  updateState((s) => {
    const active = getActiveState();
    if (!active) return { ...s, project: { ...s.project, measureMap: null, tempoMap: null } };
    const tempoMap = new TempoMap(active.ppq, active.tempos, active.maxTick);
    const measureMap = new MeasureMap(active.ppq, active.timeSignatures, Math.max(active.maxTick, 1));
    return { ...s, project: { ...s.project, tempoMap, measureMap } };
  });
};

const getTempoMapForTransport = (): TempoMap | null => getState().project.tempoMap;

const controller = new PianoRollController({
  rollElement: layout.stage.rollWrap,
  rulerElement: layout.stage.rulerWrap,
  camera,
  getLimits: () => {
    const track = getActiveTrack();
    const maxTick = getActiveState()?.maxTick ?? 0;
    const range = track ? computePitchRange(track.notes) : defaultPitchRange();
    return {
      maxTick,
      pitchMin: Math.max(0, range.min - 12),
      pitchMax: Math.min(127, range.max + 12)
    };
  },
  getNotes: () => getDisplayNotes(),
  getMeasureMap: () => getState().project.measureMap,
  getTempoMap: () => getTempoMapForTransport(),
  getLoopRange: () => null,
  requestRender: () => renderAll(),
  onCursor: (info) => {
    const tick = Math.max(0, info.tick);
    const pitch = Math.max(0, Math.min(127, Math.round(info.pitch)));
    const pitchName = pitchToName(pitch);
    const mm = getState().project.measureMap;
    const mbt = mm ? mm.tickToBarBeatTick(tick) : null;
    const mbtText = mbt ? `${mbt.bar}:${mbt.beat}:${mbt.tick}` : `tick ${Math.round(tick)}`;
    layout.stage.hudReadout.textContent = `Cursor ${mbtText} - ${pitchName}${info.noteId ? " - note" : ""}`;
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
    layout.controls.playBtn.textContent = isPlaying ? "Stop" : "Play";
    if (isPlaying) startAudioFromTransport();
    else audio.stop();
  },
  getScopeSelectEnabled: () => false,
  onScopeSelect: () => undefined
});

layout.controls.playBtn.addEventListener("click", () => controller.togglePlay());

layout.controls.newBtn.addEventListener("click", () => {
  controller.stop();
  initProject(createBlankProject());
  layout.agent.status.textContent = "Blank piano roll ready.";
  layout.controls.fileName.textContent = "Blank";
});

layout.controls.exportBtn.addEventListener("click", () => {
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

layout.controls.fileInput.addEventListener("change", async () => {
  const file = layout.controls.fileInput.files?.[0];
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    initProject(fromParsedMidiProject(parseMidi(buf)));
    layout.agent.status.textContent = `Loaded ${file.name}.`;
    layout.controls.fileName.textContent = file.name;
  } catch (err) {
    updateState((s) => ({ ...s, project: { ...s.project, liveState: null, proposal: null, tempoMap: null, measureMap: null } }));
    controller.stop();
    renderAll();
    console.error(err);
    alert("Failed to parse MIDI file.");
  }
});

layout.controls.trackSelect.addEventListener("change", () => {
  setTrackIndex(Number(layout.controls.trackSelect.value));
});

layout.agent.runBtn.addEventListener("click", () => runAgent());
layout.agent.stopBtn.addEventListener("click", () => {
  if (!agentAbort) return;
  layout.agent.stopBtn.disabled = true;
  layout.agent.status.textContent = "Cancelling...";
  agentAbort.abort();
});
layout.agent.undoBtn.addEventListener("click", () => undoLast());

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
    agent: { ...s.agent, running: false, streamingDraftState: null, stepSnapshots: [], stepIndex: 0, timeline: [] },
    ui: { ...s.ui, scrubMode: false, previewMode: "draft", scopeRect: null, scopeSelectMode: false }
  }));
  recomputeMaps();
  const first = state.tracks.find((t) => t.notes.length > 0) ?? state.tracks[0] ?? null;
  if (first) setTrackIndex(first.trackIndex);
  renderTrackOptions();
  renderTimeline();
  refreshAgentButtons();
};

const setTrackIndex = (trackIndex: number): void => {
  updateState((s) => ({ ...s, project: { ...s.project, selectedTrackIndex: trackIndex } }));
  const track = getActiveTrack();
  if (!track) return;
  notesById = new Map(track.notes.map((n) => [n.id, n]));
  controller.stop();
  controller.clearSelection();
  controller.setPlayheadTick(0);
  renderTrackOptions();

  const rollRect = layout.stage.rollWrap.getBoundingClientRect();
  const maxTick = getActiveState()?.maxTick ?? 1;
  camera.pixelsPerTick = clamp((rollRect.width * 0.9) / Math.max(1, maxTick), 0.01, 0.35);
  camera.noteHeightPx = 14;
  camera.scrollTick = 0;
  const range = computePitchRange(track.notes);
  camera.topPitch = Math.min(127, range.max + 10);
  camera.clampTo({
    maxTick,
    pitchMin: Math.max(0, range.min - 12),
    pitchMax: Math.min(127, range.max + 12)
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
    clearWithLabel(gridCtx, layout.stage.rollWrap, "Blank piano roll ready");
    notesCtx.clearRect(0, 0, layout.stage.notesCanvas.width, layout.stage.notesCanvas.height);
    overlayCtx.clearRect(0, 0, layout.stage.overlayCanvas.width, layout.stage.overlayCanvas.height);
    clearWithLabel(rulerCtx, layout.stage.rulerWrap, "");
    clearWithLabel(keyboardCtx, layout.stage.keyboardWrap, "");
    layout.controls.playBtn.disabled = true;
    return;
  }

  renderRollGrid(gridCtx, camera, mm, theme, getState().ui.gridSubdivision);
  layout.controls.playBtn.disabled = track.notes.length === 0;
  renderNotes(notesCtx, camera, getDisplayNotes(), controller.selection, controller.hoverId, theme, undefined, getState().ui.noteColorMode);
  renderOverlay(overlayCtx, camera, controller.playheadTick, controller.marquee, null, theme);
  renderRuler(rulerCtx, camera, mm, theme);
  renderKeyboard(keyboardCtx, camera, theme);
  renderHud();
};

const renderHud = (): void => {
  const s = getState();
  const mm = s.project.measureMap;
  const tick = s.transport.playheadTick;
  const mbt = mm ? mm.tickToBarBeatTick(tick) : null;
  if (mbt) {
    const track = getActiveTrack();
    layout.stage.hudReadout.textContent = `${track?.name ?? "Track"} - Bar ${mbt.bar}:${mbt.beat}:${mbt.tick} - Zoom ${camera.pixelsPerTick.toFixed(
      3
    )}`;
  }
};

const updateInspector = (sel: ReadonlySet<string>): void => {
  const selected = [...sel];
  const first = selected[0] ? notesById.get(selected[0]) ?? null : null;
  const mm = getState().project.measureMap;
  const firstText = first ? `${pitchToName(first.pitch)} - start ${formatTick(mm, first.startTick)} - dur ${first.durationTicks} ticks` : "-";
  layout.stage.hudReadout.textContent = `Selection ${selected.length} - ${firstText}`;
};

const formatTick = (mm: MeasureMap | null, tick: number): string => {
  if (!mm) return `${Math.round(tick)} ticks`;
  const mbt = mm.tickToBarBeatTick(tick);
  return `${mbt.bar}:${mbt.beat}:${mbt.tick}`;
};

const renderTrackOptions = (): void => {
  const select = layout.controls.trackSelect;
  const live = getState().project.liveState;
  select.innerHTML = "";
  if (!live) {
    select.disabled = true;
    return;
  }
  for (const t of live.tracks) {
    const option = document.createElement("option");
    option.value = String(t.trackIndex);
    option.textContent = `${t.name} (${t.notes.length})`;
    select.append(option);
  }
  select.value = String(getState().project.selectedTrackIndex);
  select.disabled = live.tracks.length <= 1;
};

const refreshAgentButtons = (): void => {
  const s = getState();
  const hasLive = Boolean(s.project.liveState);
  const running = s.agent.running;
  layout.agent.runBtn.disabled = running || !hasLive;
  layout.agent.stopBtn.disabled = !running;
  layout.agent.undoBtn.disabled = running || undoStack.length === 0;
  layout.agent.promptArea.disabled = running;
  layout.controls.exportBtn.disabled = running || !hasLive;
  layout.controls.newBtn.disabled = running;
  layout.controls.fileInput.disabled = running;
  layout.controls.trackSelect.disabled = running || !hasLive || (s.project.liveState?.tracks.length ?? 0) <= 1;
  layout.controls.barStartInput.disabled = running || !hasLive;
  layout.controls.barsInput.disabled = running || !hasLive;
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

const startAudioFromTransport = async (): Promise<void> => {
  const s = getState();
  const live = getActiveState();
  const mm = s.project.measureMap;
  const tm = getTempoMapForTransport();
  if (!live || !mm || !tm) return;

  await audio.start({
    state: live,
    tempoMap: tm,
    measureMap: mm,
    fromTick: s.transport.playheadTick,
    playAllTracks: false,
    selectedTrackIndex: s.project.selectedTrackIndex,
    metronomeEnabled: false,
    volume: s.transport.volume,
    tone: s.transport.tone
  });
};

const runAgent = async (): Promise<void> => {
  const state = getState();
  const liveState = state.project.liveState;
  const measureMap = state.project.measureMap;
  if (!liveState || !measureMap) return;

  const trackIndex = state.project.selectedTrackIndex;
  const startBar = Number(layout.controls.barStartInput.value || "1");
  const bars = Number(layout.controls.barsInput.value || "8");
  const tickStart = barToTick(measureMap, startBar);
  const tickEnd = barToTick(measureMap, startBar + Math.max(1, bars));
  const scope: Scope = { trackIndex, tickStart, tickEnd };

  agentAbort = new AbortController();
  updateState((s) => ({
    ...s,
    agent: { ...s.agent, running: true, streamingDraftState: liveState, timeline: [], stepSnapshots: [], stepIndex: 0 },
    project: { ...s.project, proposal: null },
    ui: { ...s.ui, scrubMode: false, previewMode: "draft" }
  }));
  layout.agent.status.textContent = "Running agent...";
  renderTimeline();
  refreshAgentButtons();

  try {
    const proposal = await runComposerAgent({
      userPrompt: layout.agent.promptArea.value || "Make a small, tasteful musical improvement inside the target bars.",
      scope,
      liveState,
      stream: true,
      signal: agentAbort.signal,
      stepMode: false,
      onStreamEvent: (e) => onStreamEvent(e),
      onDraftUpdate: ({ draftState }) => {
        updateState((s) => ({ ...s, agent: { ...s.agent, streamingDraftState: draftState } }));
        notesById = new Map((draftState.tracks.find((x) => x.trackIndex === scope.trackIndex)?.notes ?? []).map((n) => [n.id, n]));
        recomputeMaps();
        renderAll();
      }
    });

    if ((proposal.musicalSummary ?? "") === "Cancelled by user.") {
      updateState((s) => ({ ...s, agent: { ...s.agent, running: false, streamingDraftState: null } }));
      layout.agent.status.textContent = "Cancelled.";
      appendTimeline({ type: "status", message: "Cancelled.", at: Date.now() });
      return;
    }

    const baseTrack = proposal.baseState.tracks.find((x) => x.trackIndex === scope.trackIndex)!;
    const draftTrack = proposal.draftState.tracks.find((x) => x.trackIndex === scope.trackIndex)!;
    const diff = diffNotes(baseTrack, draftTrack, scope);
    const result = applyOps(liveState, proposal.ops, scope);

    if (result.appliedOps.length > 0 && result.rejectedOps.length === 0) {
      undoStack.push(result.inverseOps);
      updateState((s) => ({
        ...s,
        project: { ...s.project, liveState: result.nextState, proposal: null },
        agent: { ...s.agent, running: false, streamingDraftState: null }
      }));
      const summary = `Composed: +${diff.counts.added} -${diff.counts.removed} ~${diff.counts.modified}${
        proposal.warnings.length ? ` - warnings: ${proposal.warnings.length}` : ""
      }${proposal.musicalSummary ? `\n${proposal.musicalSummary}` : ""}`;
      layout.agent.status.textContent = summary;
      appendTimeline({ type: "status", message: "Committed to live MIDI. Use Undo to reverse.", at: Date.now() });
    } else {
      const reason = result.rejectedOps.length ? result.rejectedOps.map((r) => r.reason).join("; ") : "agent produced no safe note edits";
      updateState((s) => ({
        ...s,
        project: { ...s.project, proposal: null },
        agent: { ...s.agent, running: false, streamingDraftState: null }
      }));
      layout.agent.status.textContent = `No composition committed: ${reason}${proposal.musicalSummary ? `\n${proposal.musicalSummary}` : ""}`;
      appendTimeline({ type: "error", message: `No live change: ${reason}`, at: Date.now() });
    }

    notesById = new Map((getActiveTrack()?.notes ?? draftTrack.notes).map((n) => [n.id, n]));
    controller.clearSelection();
    renderTrackOptions();
    recomputeMaps();
    renderAll();
  } catch (e) {
    updateState((s) => ({ ...s, agent: { ...s.agent, running: false, streamingDraftState: null } }));
    layout.agent.status.textContent = `Failed to run agent: ${String(e)}`;
    appendTimeline({ type: "error", message: String(e), at: Date.now() });
  } finally {
    agentAbort = null;
    updateState((s) => ({ ...s, agent: { ...s.agent, running: false, streamingDraftState: null } }));
    notesById = new Map((getActiveTrack()?.notes ?? []).map((n) => [n.id, n]));
    refreshAgentButtons();
    renderTimeline();
    renderAll();
  }
};

const onStreamEvent = (e: AgentStreamEvent): void => {
  const ev: AgentTimelineEvent | null = (() => {
    const at = Date.now();
    if (e.type === "status") return { type: "status", message: e.message, at };
    if (e.type === "error") return { type: "error", message: e.message, at };
    if (e.type === "thinking") return { type: "thinking", text: e.text, at };
    if (e.type === "tool_call_started") return { type: "tool_call_started", name: e.tool.name, argsPreview: "", at };
    if (e.type === "tool_call_done") return { type: "tool_call_done", name: e.tool.name, argsPreview: e.tool.argsJsonText.slice(-800), at };
    if (e.type === "tool_applied") return { type: "tool_applied", name: e.tool.name, ok: e.ok, warnings: e.warnings, outputText: e.outputText, at };
    return null;
  })();
  if (ev) appendTimeline(ev);
};

const appendTimeline = (event: AgentTimelineEvent): void => {
  updateState((s) => ({ ...s, agent: { ...s.agent, timeline: [...s.agent.timeline, event] } }));
  renderTimeline();
};

const renderTimeline = (): void => {
  const events = getState().agent.timeline.slice(-120);
  renderThinkingPanel(events);

  const list = layout.agent.actionTimeline;
  list.innerHTML = "";
  for (const e of events) {
    if (e.type === "thinking") continue;
    if ("name" in e && e.name === "composer_thought") continue;

    const item = document.createElement("div");
    item.className = `timeline-item ${e.type}`;
    if (e.type === "status" || e.type === "error") {
      item.textContent = `${e.type === "error" ? "Error" : "Status"}: ${e.message}`;
    } else if (e.type === "tool_applied") {
      const warningText = e.warnings?.length ? `${e.warnings.length} warning${e.warnings.length === 1 ? "" : "s"}` : "";
      item.classList.add(e.ok ? "ok" : "failed");
      item.textContent = toolActionText(e.name, e.ok ? "applied" : "failed", warningText);
    } else {
      item.textContent = toolActionText(e.name, e.type === "tool_call_started" ? "started" : "prepared");
    }
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
};

const renderThinkingPanel = (events: AgentTimelineEvent[]): void => {
  const panel = layout.agent.thinkingPanel;
  panel.innerHTML = "";

  const latestSummary = [...events].reverse().find((e) => e.type === "thinking");
  const latestThought = [...events]
    .reverse()
    .find((e) => e.type === "tool_applied" && e.name === "composer_thought" && e.outputText);

  if (!latestSummary && !latestThought) {
    const empty = document.createElement("div");
    empty.className = "thinking-empty";
    empty.textContent = "Thinking summaries will appear here while the composer works.";
    panel.append(empty);
    return;
  }

  if (latestSummary?.type === "thinking") {
    panel.append(thinkingBlock("OpenAI summary", latestSummary.text));
  }

  if (latestThought?.type === "tool_applied" && latestThought.outputText) {
    panel.append(thinkingBlock("Composer thought", latestThought.outputText));
  }
};

const thinkingBlock = (label: string, text: string): HTMLDivElement => {
  const parsed = parseThinkingText(text);
  const block = document.createElement("div");
  block.className = "thinking-block";
  const source = document.createElement("div");
  source.className = "thinking-source";
  source.textContent = label;
  block.append(source);

  if (parsed.headline) {
    const headline = document.createElement("div");
    headline.className = "thinking-headline";
    headline.textContent = parsed.headline;
    block.append(headline);
  }

  const body = document.createElement("div");
  body.className = parsed.headline ? "thinking-body" : "thinking-copy";
  body.textContent = clipThinkingText(parsed.body);
  block.append(body);
  return block;
};

const clipThinkingText = (text: string): string => (text.length > 700 ? `${text.slice(0, 700)}...` : text);

const undoLast = (): void => {
  const liveState = getState().project.liveState;
  if (!liveState) return;
  const inv = undoStack.pop();
  if (!inv || inv.length === 0) {
    refreshAgentButtons();
    return;
  }
  const trackIndex = inv[0]?.trackIndex ?? getState().project.selectedTrackIndex;
  const result = applyOps(liveState, inv, globalScopeForTrack(trackIndex));
  updateState((s) => ({ ...s, project: { ...s.project, liveState: result.nextState, proposal: null } }));
  recomputeMaps();
  notesById = new Map((getActiveTrack()?.notes ?? []).map((n) => [n.id, n]));
  layout.agent.status.textContent = `Undone. Undo stack: ${undoStack.length}`;
  appendTimeline({ type: "status", message: "Undid last committed agent run.", at: Date.now() });
  renderTrackOptions();
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
initProject(createBlankProject());
renderAll();
refreshAgentButtons();
