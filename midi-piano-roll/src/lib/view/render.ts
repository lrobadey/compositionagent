export type NoteLike = {
  id: string;
  pitch: number;
  startTick: number;
  durationTicks: number;
  endTick: number;
  velocity?: number;
  trackIndex?: number;
};
import type { MeasureMap } from "../midi/measureMap";
import type { Camera } from "./camera";

export type RenderTheme = {
  bg: string;
  keyWhite: string;
  keyBlack: string;
  gridMajor: string;
  gridBeat: string;
  gridSub: string;
  note: string;
  noteSoft: string;
  select: string;
  selectSoft: string;
  playhead: string;
  text: string;
  muted: string;
};

export type Marquee = { x: number; y: number; w: number; h: number } | null;

export const renderRollGrid = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  measureMap: MeasureMap,
  theme: RenderTheme,
  subdivision = 4
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const pitchRange = camera.visiblePitchRange();
  const pitchTop = Math.ceil(pitchRange.max);
  const pitchBottom = Math.floor(pitchRange.min);

  for (let p = pitchTop; p >= pitchBottom; p--) {
    const y = camera.pitchToY(p);
    ctx.fillStyle = isBlackKey(p) ? theme.keyBlack : theme.keyWhite;
    ctx.fillRect(0, y, w, camera.noteHeightPx);
  }

  const { min, max } = camera.visibleTickRange();
  const lines = measureMap.gridLines(min, max, subdivision);

  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of lines.subs) {
    const x = Math.round(camera.tickToX(t)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.strokeStyle = theme.gridSub;
  ctx.stroke();

  ctx.beginPath();
  for (const t of lines.beats) {
    const x = Math.round(camera.tickToX(t)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.strokeStyle = theme.gridBeat;
  ctx.stroke();

  ctx.beginPath();
  for (const t of lines.bars) {
    const x = Math.round(camera.tickToX(t)) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  ctx.strokeStyle = theme.gridMajor;
  ctx.stroke();

  ctx.beginPath();
  for (let p = pitchTop; p >= pitchBottom; p--) {
    const y = Math.round(camera.pitchToY(p)) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.stroke();
};

export const renderNotes = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  notes: NoteLike[],
  selected: ReadonlySet<string>,
  hoverId: string | null,
  theme: RenderTheme,
  diff?: {
    addedIds?: ReadonlySet<string>;
    modifiedIds?: ReadonlySet<string>;
    removedNotes?: NoteLike[];
  },
  colorMode: "default" | "velocity" | "track" = "default"
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (diff?.removedNotes?.length) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(255, 90, 90, 0.7)";
    ctx.lineWidth = 1;
    for (const n of diff.removedNotes) {
      const x = camera.tickToX(n.startTick);
      const y = camera.pitchToY(n.pitch);
      const ww = Math.max(1, n.durationTicks * camera.pixelsPerTick);
      const hh = Math.max(1, camera.noteHeightPx - 1);
      if (x > camera.viewportWidthPx || x + ww < 0) continue;
      if (y > camera.viewportHeightPx || y + hh < 0) continue;
      ctx.strokeRect(x + 0.5, y + 1.5, ww - 1, hh - 2);
    }
    ctx.restore();
  }

  const { min, max } = camera.visibleTickRange();
  const pad = (camera.viewportWidthPx / camera.pixelsPerTick) * 0.1;
  const i0 = lowerBoundNoteStart(notes, min - pad);

  for (let i = i0; i < notes.length; i++) {
    const n = notes[i]!;
    if (n.startTick > max + pad) break;
    if (n.durationTicks <= 0) continue;

    const x = camera.tickToX(n.startTick);
    const y = camera.pitchToY(n.pitch);
    const ww = Math.max(1, n.durationTicks * camera.pixelsPerTick);
    const hh = Math.max(1, camera.noteHeightPx - 1);
    if (x > camera.viewportWidthPx || x + ww < 0) continue;
    if (y > camera.viewportHeightPx || y + hh < 0) continue;

    const isSelected = selected.has(n.id);
    const isHover = hoverId === n.id;
    const isAdded = diff?.addedIds?.has(n.id) ?? false;
    const isModified = diff?.modifiedIds?.has(n.id) ?? false;

    const baseColor =
      colorMode === "velocity" && typeof n.velocity === "number"
        ? `hsl(28, 90%, ${Math.max(35, Math.min(75, 35 + n.velocity * 40))}%)`
        : colorMode === "track" && typeof n.trackIndex === "number"
          ? `hsl(${(n.trackIndex * 55) % 360}, 80%, 60%)`
          : theme.note;

    const base = isSelected
      ? theme.select
      : isAdded
        ? "rgba(80, 220, 140, 0.95)"
        : isModified
          ? "rgba(180, 120, 255, 0.95)"
          : baseColor;
    const soft = isSelected
      ? theme.selectSoft
      : isAdded
        ? "rgba(80, 220, 140, 0.22)"
        : isModified
          ? "rgba(180, 120, 255, 0.18)"
          : theme.noteSoft;

    ctx.fillStyle = soft;
    ctx.fillRect(x, y + 1, ww, hh - 1);

    ctx.strokeStyle = base;
    ctx.lineWidth = isHover ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 1.5, ww - 1, hh - 2);
  }
};

export const renderOverlay = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  playheadTick: number,
  marquee: Marquee,
  scopeMarquee: Marquee,
  theme: RenderTheme
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const x = camera.tickToX(playheadTick);
  ctx.strokeStyle = theme.playhead;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, 0);
  ctx.lineTo(x + 0.5, h);
  ctx.stroke();

  if (marquee) {
    ctx.strokeStyle = theme.select;
    ctx.fillStyle = theme.selectSoft;
    ctx.lineWidth = 1;
    ctx.fillRect(marquee.x, marquee.y, marquee.w, marquee.h);
    ctx.strokeRect(marquee.x + 0.5, marquee.y + 0.5, marquee.w - 1, marquee.h - 1);
  }

  if (scopeMarquee) {
    ctx.strokeStyle = "rgba(46, 242, 255, 0.9)";
    ctx.fillStyle = "rgba(46, 242, 255, 0.12)";
    ctx.lineWidth = 1;
    ctx.fillRect(scopeMarquee.x, scopeMarquee.y, scopeMarquee.w, scopeMarquee.h);
    ctx.strokeRect(scopeMarquee.x + 0.5, scopeMarquee.y + 0.5, scopeMarquee.w - 1, scopeMarquee.h - 1);
  }
};

export const renderRuler = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  measureMap: MeasureMap,
  theme: RenderTheme
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0, 0, w, h);

  const { min, max } = camera.visibleTickRange();
  const lines = measureMap.gridLines(min, max, 4);

  const drawTicks = (ticks: number[], color: string, height: number) => {
    ctx.beginPath();
    for (const t of ticks) {
      const x = Math.round(camera.tickToX(t)) + 0.5;
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - height);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  drawTicks(lines.subs, theme.gridSub, 6);
  drawTicks(lines.beats, theme.gridBeat, 10);
  drawTicks(lines.bars, theme.gridMajor, 14);

  ctx.fillStyle = theme.muted;
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.textBaseline = "top";
  for (const t of lines.bars) {
    const x = camera.tickToX(t);
    if (x < -40 || x > w + 40) continue;
    const { bar } = measureMap.tickToBarBeatTick(t);
    ctx.fillText(String(bar), x + 4, 4);
  }
};

export const renderKeyboard = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  theme: RenderTheme
): void => {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fillRect(0, 0, w, h);

  const pitchRange = camera.visiblePitchRange();
  const pitchTop = Math.ceil(pitchRange.max);
  const pitchBottom = Math.floor(pitchRange.min);

  ctx.font = "11px ui-sans-serif, system-ui";
  ctx.textBaseline = "middle";

  for (let p = pitchTop; p >= pitchBottom; p--) {
    const y = camera.pitchToY(p);
    const isBlack = isBlackKey(p);
    ctx.fillStyle = isBlack ? "rgba(0,0,0,0.35)" : "rgba(255,255,255,0.03)";
    ctx.fillRect(0, y, w, camera.noteHeightPx);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(w, Math.round(y) + 0.5);
    ctx.stroke();

    if (p % 12 === 0) {
      ctx.fillStyle = theme.text;
      ctx.fillText(pitchToName(p), 8, y + camera.noteHeightPx / 2);
    }
  }
};

export const pitchToName = (pitch: number): string => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
  const p = Math.max(0, Math.min(127, Math.round(pitch)));
  const octave = Math.floor(p / 12) - 1;
  return `${names[p % 12]}${octave}`;
};

export const isBlackKey = (pitch: number): boolean => {
  const pc = ((pitch % 12) + 12) % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
};

const lowerBoundNoteStart = (notes: NoteLike[], tick: number): number => {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((notes[mid]?.startTick ?? 0) < tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};
