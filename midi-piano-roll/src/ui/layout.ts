import { TOOL_ACTIVITY_LABEL } from "./agentTrace";

type LayoutElements = {
  root: HTMLDivElement;
  controls: {
    fileInput: HTMLInputElement;
    fileName: HTMLSpanElement;
    newBtn: HTMLButtonElement;
    exportBtn: HTMLButtonElement;
    playBtn: HTMLButtonElement;
    trackSelect: HTMLSelectElement;
    barStartInput: HTMLInputElement;
    barsInput: HTMLInputElement;
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
  };
  agent: {
    promptArea: HTMLTextAreaElement;
    runBtn: HTMLButtonElement;
    stopBtn: HTMLButtonElement;
    undoBtn: HTMLButtonElement;
    status: HTMLDivElement;
    thinkingPanel: HTMLDivElement;
    actionTimeline: HTMLDivElement;
  };
};

export const createLayout = (): LayoutElements => {
  const root = el("div", { className: "app-shell" });
  const workspace = el("div", { className: "workspace" });

  const rollPane = el("main", { className: "roll-pane" });
  const controls = el("div", { className: "control-strip" });
  const fileInput = el("input", { type: "file", className: "file-input", title: "Load MIDI" }) as HTMLInputElement;
  fileInput.accept = ".mid,.midi";
  const fileLabel = el("label", { className: "btn file-label" }) as HTMLLabelElement;
  fileLabel.append("Load MIDI", fileInput);
  const fileName = el("span", { className: "file-name", textContent: "Blank" }) as HTMLSpanElement;
  const newBtn = button("New");
  const exportBtn = button("Export");
  const playBtn = button("Play");
  const trackSelect = select([], "Track");
  const barStartInput = el("input", { type: "number", value: "1", min: "1", className: "input compact", title: "Start bar" }) as HTMLInputElement;
  const barsInput = el("input", { type: "number", value: "8", min: "1", className: "input compact", title: "Bars" }) as HTMLInputElement;

  controls.append(
    fileLabel,
    fileName,
    newBtn,
    exportBtn,
    playBtn,
    trackSelect,
    labelWrap("Start", barStartInput),
    labelWrap("Bars", barsInput)
  );

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
  const hudReadout = el("div", { className: "hud-readout", textContent: "Blank piano roll ready" });
  hudBar.append(hudReadout);
  stage.append(stageFrame, hudBar);
  rollPane.append(controls, stage);

  const agent = el("aside", { className: "agent-rail" });
  const promptBox = el("section", { className: "prompt-box" });
  const promptTitle = el("div", { className: "rail-title", textContent: "Prompt" });
  const promptArea = el("textarea", { className: "textarea composer-prompt", placeholder: "Tell the agent what to write or change..." }) as HTMLTextAreaElement;
  const runBtn = button("Compose");
  const stopBtn = button("Stop");
  const undoBtn = button("Undo");
  runBtn.classList.add("primary");
  const actionRow = el("div", { className: "action-row" });
  actionRow.append(runBtn, stopBtn, undoBtn);
  const status = el("div", { className: "status-box", textContent: "Ready." });
  promptBox.append(promptTitle, promptArea, actionRow, status);

  const traceBox = el("section", { className: "trace-box" });
  const traceTitle = el("div", { className: "rail-title", textContent: "Composer cockpit" });
  const thinkingPanel = el("div", { className: "thinking-panel" });
  const actionTitle = el("div", { className: "rail-subtitle", textContent: TOOL_ACTIVITY_LABEL });
  const actionTimeline = el("div", { className: "timeline action-timeline" });
  traceBox.append(traceTitle, thinkingPanel, actionTitle, actionTimeline);
  agent.append(promptBox, traceBox);

  workspace.append(rollPane, agent);
  root.append(workspace);

  return {
    root,
    controls: { fileInput, fileName, newBtn, exportBtn, playBtn, trackSelect, barStartInput, barsInput },
    stage: { corner, rulerWrap, keyboardWrap, rollWrap, rulerCanvas, gridCanvas, notesCanvas, overlayCanvas, keyboardCanvas, hudBar, hudReadout },
    agent: { promptArea, runBtn, stopBtn, undoBtn, status, thinkingPanel, actionTimeline }
  };
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  return node;
};

const button = (label: string): HTMLButtonElement => el("button", { className: "btn", textContent: label }) as HTMLButtonElement;

const select = (opts: [string, string][], label: string): HTMLSelectElement => {
  const s = el("select", { className: "select", title: label }) as HTMLSelectElement;
  for (const [value, text] of opts) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    s.append(o);
  }
  return s;
};

const labelWrap = (label: string, child: HTMLElement): HTMLLabelElement => {
  const wrap = el("label", { className: "compact-field" }) as HTMLLabelElement;
  wrap.append(el("span", { textContent: label }), child);
  return wrap;
};

const canvas = (kind: string): HTMLCanvasElement => el("canvas", { className: `canvas ${kind}` }) as HTMLCanvasElement;
