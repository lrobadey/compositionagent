import type { MeasureMap } from "../midi/measureMap";
import type { TempoMap } from "../midi/tempoMap";
import type { Camera, CameraLimits } from "./camera";
import type { NoteLike } from "./render";

export type CursorInfo = {
  tick: number;
  pitch: number;
  noteId: string | null;
};

export type PianoRollControllerOptions = {
  rollElement: HTMLElement;
  rulerElement: HTMLElement;
  camera: Camera;
  getLimits: () => CameraLimits;
  getNotes: () => NoteLike[];
  getMeasureMap: () => MeasureMap | null;
  getTempoMap: () => TempoMap | null;
  getLoopRange?: () => { startTick: number; endTick: number } | null;

  requestRender: () => void;
  onCursor: (info: CursorInfo) => void;
  onSelectionChange: (selectedIds: ReadonlySet<string>) => void;
  onPlayheadChange: (tick: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  getScopeSelectEnabled?: () => boolean;
  onScopeSelect?: (range: { tickStart: number; tickEnd: number; pitchMin: number; pitchMax: number }) => void;
};

export class PianoRollController {
  readonly selection = new Set<string>();
  hoverId: string | null = null;
  playheadTick = 0;
  isPlaying = false;
  marquee: { x: number; y: number; w: number; h: number } | null = null;
  scopeMarquee: { x: number; y: number; w: number; h: number } | null = null;

  private readonly opts: PianoRollControllerOptions;
  private pointerId: number | null = null;
  private dragMode: "none" | "pan" | "marquee" | "ruler" = "none";
  private dragStart = { x: 0, y: 0 };
  private dragLast = { x: 0, y: 0 };
  private dragStartScrollTick = 0;
  private dragStartTopPitch = 0;
  private marqueeStartTick = 0;
  private marqueeStartPitch = 0;
  private scopeStartTick = 0;
  private scopeStartPitch = 0;
  private spaceDownAt: number | null = null;
  private spaceUsedForDrag = false;
  private raf: number | null = null;
  private playSeconds = 0;
  private lastFrameMs = 0;

  constructor(opts: PianoRollControllerOptions) {
    this.opts = opts;

    this.onWheel = this.onWheel.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onRulerPointerDown = this.onRulerPointerDown.bind(this);
    this.onRulerPointerMove = this.onRulerPointerMove.bind(this);
    this.onRulerPointerUp = this.onRulerPointerUp.bind(this);

    opts.rollElement.addEventListener("wheel", this.onWheel, { passive: false });
    opts.rollElement.addEventListener("pointerdown", this.onPointerDown);
    opts.rollElement.addEventListener("pointermove", this.onPointerMove);
    opts.rollElement.addEventListener("pointerup", this.onPointerUp);
    opts.rollElement.addEventListener("pointercancel", this.onPointerUp);

    opts.rulerElement.addEventListener("pointerdown", this.onRulerPointerDown);
    opts.rulerElement.addEventListener("pointermove", this.onRulerPointerMove);
    opts.rulerElement.addEventListener("pointerup", this.onRulerPointerUp);
    opts.rulerElement.addEventListener("pointercancel", this.onRulerPointerUp);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  destroy(): void {
    this.stop();
    const { rollElement, rulerElement } = this.opts;
    rollElement.removeEventListener("wheel", this.onWheel);
    rollElement.removeEventListener("pointerdown", this.onPointerDown);
    rollElement.removeEventListener("pointermove", this.onPointerMove);
    rollElement.removeEventListener("pointerup", this.onPointerUp);
    rollElement.removeEventListener("pointercancel", this.onPointerUp);

    rulerElement.removeEventListener("pointerdown", this.onRulerPointerDown);
    rulerElement.removeEventListener("pointermove", this.onRulerPointerMove);
    rulerElement.removeEventListener("pointerup", this.onRulerPointerUp);
    rulerElement.removeEventListener("pointercancel", this.onRulerPointerUp);

    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  setPlayheadTick(tick: number): void {
    this.playheadTick = Math.max(0, tick);
    this.opts.onPlayheadChange(this.playheadTick);
    this.opts.requestRender();
  }

  clearSelection(): void {
    this.selection.clear();
    this.opts.onSelectionChange(this.selection);
    this.opts.requestRender();
  }

  togglePlay(): void {
    if (this.isPlaying) this.stop();
    else this.play();
  }

  play(): void {
    const tempoMap = this.opts.getTempoMap();
    if (!tempoMap) return;
    const { maxTick } = this.opts.getLimits();
    if (maxTick <= 0) return;

    this.isPlaying = true;
    this.playSeconds = tempoMap.ticksToSeconds(this.playheadTick);
    this.lastFrameMs = performance.now();
    this.opts.onPlayingChange(true);
    this.loop();
  }

  stop(): void {
    this.isPlaying = false;
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.opts.onPlayingChange(false);
    this.opts.requestRender();
  }

  private loop(): void {
    if (!this.isPlaying) return;
    const tempoMap = this.opts.getTempoMap();
    if (!tempoMap) {
      this.stop();
      return;
    }
    const now = performance.now();
    const dt = (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;

    this.playSeconds += dt;
    const nextTick = tempoMap.secondsToTicks(this.playSeconds);
    const { maxTick } = this.opts.getLimits();
    const loop = this.opts.getLoopRange?.() ?? null;
    if (loop && nextTick >= loop.endTick) {
      this.playSeconds = tempoMap.ticksToSeconds(loop.startTick);
      this.playheadTick = loop.startTick;
    } else {
      this.playheadTick = Math.max(0, Math.min(maxTick, nextTick));
    }
    this.opts.onPlayheadChange(this.playheadTick);
    this.opts.requestRender();

    if (!loop && this.playheadTick >= maxTick) {
      this.stop();
      return;
    }

    this.raf = requestAnimationFrame(() => this.loop());
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const { camera } = this.opts;

    const rect = this.opts.rollElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.ctrlKey || e.metaKey) {
      const factor = Math.pow(1.0015, -e.deltaY);
      camera.zoomX(factor, x);
    } else if (e.altKey) {
      const factor = Math.pow(1.0015, -e.deltaY);
      camera.zoomY(factor, y);
    } else if (e.shiftKey) {
      camera.scrollTick += e.deltaY / camera.pixelsPerTick;
    } else {
      camera.topPitch -= e.deltaY / camera.noteHeightPx;
    }

    camera.clampTo(this.opts.getLimits());
    this.opts.requestRender();
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.pointerId != null) return;
    const isLeft = e.button === 0;
    const isMiddle = e.button === 1;
    if (!isLeft && !isMiddle) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;

    const rect = this.opts.rollElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.dragStart = { x, y };
    this.dragLast = { x, y };
    this.dragStartScrollTick = this.opts.camera.scrollTick;
    this.dragStartTopPitch = this.opts.camera.topPitch;
    this.marquee = null;

    const panMode = isMiddle || (isLeft && this.spaceDownAt != null);
    if (panMode) {
      this.dragMode = "pan";
      this.spaceUsedForDrag = true;
      return;
    }

    const scopeMode = this.opts.getScopeSelectEnabled?.() ?? false;
    if (scopeMode) {
      this.dragMode = "marquee";
      this.scopeMarquee = null;
      this.scopeStartTick = this.opts.camera.xToTick(x);
      this.scopeStartPitch = this.opts.camera.yToPitch(y);
      return;
    }

    const notes = this.opts.getNotes();
    const hit = hitTestNote(notes, this.opts.camera, x, y);
    if (hit) {
      if (e.shiftKey) {
        if (this.selection.has(hit.id)) this.selection.delete(hit.id);
        else this.selection.add(hit.id);
      } else {
        this.selection.clear();
        this.selection.add(hit.id);
      }
      this.opts.onSelectionChange(this.selection);
      this.opts.requestRender();
      return;
    }

    this.dragMode = "marquee";
    this.marqueeStartTick = this.opts.camera.xToTick(x);
    this.marqueeStartPitch = this.opts.camera.yToPitch(y);
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = this.opts.rollElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    this.dragLast = { x, y };

    const tick = this.opts.camera.xToTick(x);
    const pitch = this.opts.camera.yToPitch(y);
    const notes = this.opts.getNotes();
    const hit = hitTestNote(notes, this.opts.camera, x, y);
    this.hoverId = hit?.id ?? null;
    this.opts.onCursor({ tick, pitch, noteId: this.hoverId });

    if (this.pointerId == null || e.pointerId !== this.pointerId) {
      this.opts.requestRender();
      return;
    }

    const dx = x - this.dragStart.x;
    const dy = y - this.dragStart.y;

    if (this.dragMode === "pan") {
      this.opts.camera.scrollTick = this.dragStartScrollTick - dx / this.opts.camera.pixelsPerTick;
      this.opts.camera.topPitch = this.dragStartTopPitch + dy / this.opts.camera.noteHeightPx;
      this.opts.camera.clampTo(this.opts.getLimits());
      this.opts.requestRender();
      return;
    }

    if (this.dragMode === "marquee") {
      const x0 = this.dragStart.x;
      const y0 = this.dragStart.y;
      const x1 = x;
      const y1 = y;
      const mx = Math.min(x0, x1);
      const my = Math.min(y0, y1);
      const mw = Math.abs(x1 - x0);
      const mh = Math.abs(y1 - y0);
      if (this.opts.getScopeSelectEnabled?.()) this.scopeMarquee = { x: mx, y: my, w: mw, h: mh };
      else this.marquee = { x: mx, y: my, w: mw, h: mh };
      this.opts.requestRender();
      return;
    }

    this.opts.requestRender();
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.pointerId == null || e.pointerId !== this.pointerId) return;
    this.pointerId = null;

    if (this.dragMode === "marquee" && (this.marquee || this.scopeMarquee)) {
      const endTick = this.opts.camera.xToTick(this.dragLast.x);
      const endPitch = this.opts.camera.yToPitch(this.dragLast.y);

      const startTick = Math.min(this.opts.getScopeSelectEnabled?.() ? this.scopeStartTick : this.marqueeStartTick, endTick);
      const stopTick = Math.max(this.opts.getScopeSelectEnabled?.() ? this.scopeStartTick : this.marqueeStartTick, endTick);

      const pitchA = this.opts.getScopeSelectEnabled?.() ? this.scopeStartPitch : this.marqueeStartPitch;
      const pitchB = endPitch;
      const pitchMin = Math.floor(Math.min(pitchA, pitchB));
      const pitchMax = Math.ceil(Math.max(pitchA, pitchB));

      if (this.opts.getScopeSelectEnabled?.()) {
        this.opts.onScopeSelect?.({
          tickStart: Math.max(0, Math.floor(startTick)),
          tickEnd: Math.max(0, Math.ceil(stopTick)),
          pitchMin,
          pitchMax
        });
      } else {
        const notes = this.opts.getNotes();
        const inRect = notes.filter(
          (n) => n.startTick < stopTick && n.endTick > startTick && n.pitch >= pitchMin && n.pitch <= pitchMax
        );

        const next = e.shiftKey ? new Set(this.selection) : new Set<string>();
        for (const n of inRect) next.add(n.id);
        this.selection.clear();
        for (const id of next) this.selection.add(id);
        this.opts.onSelectionChange(this.selection);
      }
    }

    this.dragMode = "none";
    this.marquee = null;
    this.scopeMarquee = null;
    this.opts.requestRender();
  }

  private onRulerPointerDown(e: PointerEvent): void {
    this.dragMode = "ruler";
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.pointerId = e.pointerId;

    const rect = this.opts.rulerElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    this.setPlayheadTick(this.opts.camera.xToTick(x));
  }

  private onRulerPointerMove(e: PointerEvent): void {
    if (this.dragMode !== "ruler" || this.pointerId == null || e.pointerId !== this.pointerId) return;
    const rect = this.opts.rulerElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    this.setPlayheadTick(this.opts.camera.xToTick(x));
  }

  private onRulerPointerUp(e: PointerEvent): void {
    if (this.dragMode !== "ruler" || this.pointerId == null || e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.dragMode = "none";
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === " " || e.code === "Space") {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") return;
      e.preventDefault();
      if (this.spaceDownAt == null) {
        this.spaceDownAt = performance.now();
        this.spaceUsedForDrag = false;
      }
      return;
    }

    if (e.key === "Home") {
      this.setPlayheadTick(0);
      return;
    }
    if (e.key === "End") {
      const { maxTick } = this.opts.getLimits();
      this.setPlayheadTick(maxTick);
      return;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.key === " " || e.code === "Space") {
      const downAt = this.spaceDownAt;
      this.spaceDownAt = null;
      if (downAt != null && !this.spaceUsedForDrag) {
        this.togglePlay();
      }
      return;
    }
  }
}

const hitTestNote = (notes: NoteLike[], camera: Camera, x: number, y: number): NoteLike | null => {
  const tick = camera.xToTick(x);
  const pitch = Math.round(camera.yToPitch(y));
  const { min, max } = camera.visibleTickRange();
  const pad = (camera.viewportWidthPx / camera.pixelsPerTick) * 0.1;
  const minTick = min - pad;
  const maxTick = max + pad;

  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i]!;
    if (n.startTick > maxTick || n.endTick < minTick) continue;
    if (n.pitch !== pitch) continue;
    if (tick >= n.startTick && tick <= n.endTick) return n;
  }
  return null;
};
