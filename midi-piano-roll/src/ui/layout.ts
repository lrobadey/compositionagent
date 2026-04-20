type LayoutElements = {
  root: HTMLDivElement;
  header: {
    fileInput: HTMLInputElement;
    newBtn: HTMLButtonElement;
    exportBtn: HTMLButtonElement;
    gridSelect: HTMLSelectElement;
    colorSelect: HTMLSelectElement;
    overlayToggle: HTMLButtonElement;
    agentStatus: HTMLDivElement;
    helpBtn: HTMLButtonElement;
  };
  project: {
    trackSearch: HTMLInputElement;
    trackList: HTMLDivElement;
    playAllTracksToggle: HTMLButtonElement;
    tempoSummary: HTMLDivElement;
    timeSigSummary: HTMLDivElement;
    scopePresetBar: HTMLButtonElement;
    scopePresetSelection: HTMLButtonElement;
    scopePresetVisible: HTMLButtonElement;
  };
  stage: {
    corner: HTMLDivElement;
    rulerWrap: HTMLDivElement;
    keyboardWrap: HTMLDivElement;
    rollWrap: HTMLDivElement;
    rulerCanvas: HTMLCanvasElement;
    gridCanvas: HTMLCanvasElement;
    notesCanvas: HTMLCanvasElement;
    overlayCanvas: HTMLCanvasElement;
    keyboardCanvas: HTMLCanvasElement;
    hudBar: HTMLDivElement;
    hudReadout: HTMLDivElement;
    diffCard: HTMLDivElement;
  };
  agent: {
    presetSelect: HTMLSelectElement;
    promptArea: HTMLTextAreaElement;
    stepModeInput: HTMLInputElement;
    scopeModeToggle: HTMLButtonElement;
    barStartInput: HTMLInputElement;
    barsInput: HTMLInputElement;
    pitchMinInput: HTMLInputElement;
    pitchMaxInput: HTMLInputElement;
    runBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    applyBtn: HTMLButtonElement;
    rejectBtn: HTMLButtonElement;
    undoBtn: HTMLButtonElement;
    status: HTMLDivElement;
    timeline: HTMLDivElement;
    scrubRange: HTMLInputElement;
    scrubLabel: HTMLDivElement;
    scrubBaseBtn: HTMLButtonElement;
    scrubLatestBtn: HTMLButtonElement;
    scrubReplayBtn: HTMLButtonElement;
    auditionBtn: HTMLButtonElement;
  };
  transport: {
    playBtn: HTMLButtonElement;
    loopToggle: HTMLButtonElement;
    metronomeToggle: HTMLButtonElement;
    bpmReadout: HTMLDivElement;
    tempoOverrideToggle: HTMLInputElement;
    tempoOverrideInput: HTMLInputElement;
    volumeInput: HTMLInputElement;
    toneSelect: HTMLSelectElement;
    startModeSelect: HTMLSelectElement;
    loopModeSelect: HTMLSelectElement;
  };
  modal: {
    shortcuts: HTMLDivElement;
    shortcutsClose: HTMLButtonElement;
  };
};

export const createLayout = (): LayoutElements => {
  const root = el("div", { className: "app-shell" });

  const header = el("div", { className: "header-bar" });
  const headerLeft = el("div", { className: "header-group" });
  const headerCenter = el("div", { className: "header-group center" });
  const headerRight = el("div", { className: "header-group" });

  const fileInput = el("input", { type: "file", className: "file-input" }) as HTMLInputElement;
  fileInput.accept = ".mid,.midi";
  const newBtn = button("New Blank");
  const exportBtn = button("Export MIDI");
  const gridSelect = select([
    ["4", "Grid 1/4"],
    ["8", "Grid 1/8"],
    ["16", "Grid 1/16"]
  ]);
  const colorSelect = select([
    ["default", "Color: default"],
    ["velocity", "Color: velocity"],
    ["track", "Color: track"]
  ]);
  const overlayToggle = button("Overlays");
  const agentStatus = el("div", { className: "status-pill", textContent: "Agent: Ready" });
  const helpBtn = button("Shortcuts");

  headerLeft.append(fileInput, newBtn, exportBtn);
  headerCenter.append(gridSelect, colorSelect, overlayToggle);
  headerRight.append(agentStatus, helpBtn);
  header.append(headerLeft, headerCenter, headerRight);

  const body = el("div", { className: "body-grid" });

  const projectBay = el("div", { className: "panel project-bay" });
  const projectTitle = el("div", { className: "panel-title", textContent: "Project Bay" });
  const trackSearch = el("input", { className: "input", placeholder: "Search tracks…" }) as HTMLInputElement;
  const trackList = el("div", { className: "track-list" });
  const playAllTracksToggle = button("Play: Track");
  const tempoSummary = el("div", { className: "meta-row", textContent: "Tempo: —" });
  const timeSigSummary = el("div", { className: "meta-row", textContent: "Time: —" });
  const scopeTitle = el("div", { className: "section-title", textContent: "Scope Presets" });
  const scopePresetBar = button("Bars 1–4");
  const scopePresetSelection = button("Selection");
  const scopePresetVisible = button("Visible");
  const presetRow = el("div", { className: "row" });
  presetRow.append(scopePresetBar, scopePresetSelection, scopePresetVisible);
  projectBay.append(projectTitle, trackSearch, trackList, playAllTracksToggle, tempoSummary, timeSigSummary, scopeTitle, presetRow);

  const stage = el("div", { className: "stage" });
  const stageFrame = el("div", { className: "stage-frame" });
  const corner = el("div", { className: "corner" });
  const rulerWrap = el("div", { className: "ruler-wrap" });
  const keyboardWrap = el("div", { className: "keyboard-wrap" });
  const rollWrap = el("div", { className: "roll-wrap" });

  const rulerCanvas = canvas("ruler");
  const gridCanvas = canvas("grid");
  const notesCanvas = canvas("notes");
  const overlayCanvas = canvas("overlay");
  const keyboardCanvas = canvas("keyboard");
  rulerWrap.append(rulerCanvas);
  keyboardWrap.append(keyboardCanvas);
  rollWrap.append(gridCanvas, notesCanvas, overlayCanvas);

  stageFrame.append(corner, rulerWrap, keyboardWrap, rollWrap);

  const hudBar = el("div", { className: "hud-bar" });
  const hudReadout = el("div", { className: "hud-readout", textContent: "Ready" });
  const diffCard = el("div", { className: "diff-card hidden" });
  hudBar.append(hudReadout);

  stage.append(stageFrame, hudBar, diffCard);

  const agent = el("div", { className: "panel agent-console" });
  const agentTitle = el("div", { className: "panel-title", textContent: "Agent Console" });
  const presetSelect = select([
    ["none", "Preset: none"],
    ["counter_melody", "Preset: counter-melody"],
    ["tighten_rhythm", "Preset: tighten rhythm"],
    ["tension_resolve", "Preset: tension → resolve"]
  ]);
  const promptArea = el("textarea", { className: "textarea", placeholder: "Describe what you want to compose/change…" }) as HTMLTextAreaElement;
  const stepModeInput = el("input", { type: "checkbox" }) as HTMLInputElement;
  const stepModeLabel = el("label", { className: "checkbox" });
  stepModeLabel.append(stepModeInput, document.createTextNode(" Step mode"));
  const scopeModeToggle = button("Scope Select");

  const barStartInput = el("input", { type: "number", value: "1", min: "1", className: "input" }) as HTMLInputElement;
  const barsInput = el("input", { type: "number", value: "4", min: "1", className: "input" }) as HTMLInputElement;
  const pitchMinInput = el("input", { type: "number", placeholder: "Pitch min", className: "input" }) as HTMLInputElement;
  const pitchMaxInput = el("input", { type: "number", placeholder: "Pitch max", className: "input" }) as HTMLInputElement;

  const runBtn = button("Run (Propose)");
  const stopBtn = button("Stop");
  const applyBtn = button("Apply");
  const rejectBtn = button("Reject");
  const undoBtn = button("Undo");
  const status = el("div", { className: "status-box", textContent: "Load a MIDI file or click New Blank to begin." });
  const timeline = el("div", { className: "timeline" });

  const scrubRange = el("input", { type: "range", min: "0", max: "0", value: "0", className: "range" }) as HTMLInputElement;
  const scrubLabel = el("div", { className: "meta-row", textContent: "Step 0/0" });
  const scrubBaseBtn = button("View Base");
  const scrubLatestBtn = button("View Latest");
  const scrubReplayBtn = button("Replay Steps");
  const auditionBtn = button("Audition Step");
  const scrubRow = el("div", { className: "row" });
  scrubRow.append(scrubBaseBtn, scrubLatestBtn, scrubReplayBtn, auditionBtn);

  agent.append(
    agentTitle,
    presetSelect,
    promptArea,
    stepModeLabel,
    scopeModeToggle,
    gridRow("Start bar", barStartInput, "Bars", barsInput),
    gridRow("Pitch min", pitchMinInput, "Pitch max", pitchMaxInput),
    row(runBtn, stopBtn, applyBtn, rejectBtn, undoBtn),
    status,
    el("div", { className: "section-title", textContent: "Tool-call timeline" }),
    timeline,
    el("div", { className: "section-title", textContent: "Step scrubber" }),
    scrubLabel,
    scrubRange,
    scrubRow
  );

  const transport = el("div", { className: "transport-dock" });
  const playBtn = button("Play");
  const loopToggle = button("Loop");
  const metronomeToggle = button("Metronome");
  const bpmReadout = el("div", { className: "meta-row", textContent: "BPM: —" });
  const tempoOverrideToggle = el("input", { type: "checkbox" }) as HTMLInputElement;
  const tempoOverrideLabel = el("label", { className: "checkbox" });
  tempoOverrideLabel.append(tempoOverrideToggle, document.createTextNode(" Tempo override"));
  const tempoOverrideInput = el("input", { type: "number", value: "120", min: "20", max: "300", className: "input" }) as HTMLInputElement;
  const volumeInput = el("input", { type: "range", min: "0", max: "1", step: "0.01", value: "0.6", className: "range" }) as HTMLInputElement;
  const toneSelect = select([
    ["triangle", "Tone: Triangle"],
    ["sawtooth", "Tone: Saw"]
  ]);
  const startModeSelect = select([
    ["playhead", "Start: Playhead"],
    ["bar", "Start: Bar"],
    ["scope", "Start: Scope"]
  ]);
  const loopModeSelect = select([
    ["scope", "Loop: Scope"],
    ["selection", "Loop: Selection"]
  ]);

  transport.append(
    playBtn,
    loopToggle,
    metronomeToggle,
    bpmReadout,
    tempoOverrideLabel,
    tempoOverrideInput,
    toneSelect,
    startModeSelect,
    loopModeSelect,
    el("div", { className: "meta-row", textContent: "Volume" }),
    volumeInput
  );

  body.append(projectBay, stage, agent);

  const shortcuts = el("div", { className: "modal hidden" });
  const modalCard = el("div", { className: "modal-card" });
  const shortcutsClose = button("Close");
  modalCard.append(
    el("div", { className: "panel-title", textContent: "Shortcuts" }),
    el("div", {
      className: "modal-body",
      textContent:
        "Wheel: vertical scroll • Shift+wheel: horizontal • Ctrl/Cmd+wheel: zoom X • Alt+wheel: zoom Y\nSpace: play/stop • Home/End: jump playhead • Drag in scope mode: set scope"
    }),
    shortcutsClose
  );
  shortcuts.append(modalCard);

  root.append(header, body, transport, shortcuts);

  return {
    root,
    header: { fileInput, newBtn, exportBtn, gridSelect: gridSelect as HTMLSelectElement, colorSelect: colorSelect as HTMLSelectElement, overlayToggle, agentStatus, helpBtn },
    project: { trackSearch, trackList, playAllTracksToggle, tempoSummary, timeSigSummary, scopePresetBar, scopePresetSelection, scopePresetVisible },
    stage: { corner, rulerWrap, keyboardWrap, rollWrap, rulerCanvas, gridCanvas, notesCanvas, overlayCanvas, keyboardCanvas, hudBar, hudReadout, diffCard },
    agent: {
      presetSelect: presetSelect as HTMLSelectElement,
      promptArea,
      stepModeInput,
      scopeModeToggle,
      barStartInput,
      barsInput,
      pitchMinInput,
      pitchMaxInput,
      runBtn,
      stopBtn,
      applyBtn,
      rejectBtn,
      undoBtn,
      status,
      timeline,
      scrubRange,
      scrubLabel,
      scrubBaseBtn,
      scrubLatestBtn,
      scrubReplayBtn,
      auditionBtn
    },
    transport: {
      playBtn,
      loopToggle,
      metronomeToggle,
      bpmReadout,
      tempoOverrideToggle,
      tempoOverrideInput,
      volumeInput,
      toneSelect: toneSelect as HTMLSelectElement,
      startModeSelect: startModeSelect as HTMLSelectElement,
      loopModeSelect: loopModeSelect as HTMLSelectElement
    },
    modal: { shortcuts, shortcutsClose }
  };
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  return node;
};

const button = (label: string): HTMLButtonElement => el("button", { className: "btn", textContent: label }) as HTMLButtonElement;

const select = (opts: [string, string][]): HTMLSelectElement => {
  const s = el("select", { className: "select" }) as HTMLSelectElement;
  for (const [value, label] of opts) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    s.append(o);
  }
  return s;
};

const row = (...children: HTMLElement[]): HTMLDivElement => {
  const r = el("div", { className: "row" }) as HTMLDivElement;
  r.append(...children);
  return r;
};

const gridRow = (labelA: string, inputA: HTMLElement, labelB: string, inputB: HTMLElement): HTMLDivElement => {
  const g = el("div", { className: "grid-row" }) as HTMLDivElement;
  g.append(
    el("div", { className: "label", textContent: labelA }),
    inputA,
    el("div", { className: "label", textContent: labelB }),
    inputB
  );
  return g;
};

const canvas = (kind: string): HTMLCanvasElement => el("canvas", { className: `canvas ${kind}` }) as HTMLCanvasElement;
