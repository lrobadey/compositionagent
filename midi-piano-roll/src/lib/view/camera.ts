export type CameraLimits = {
  maxTick: number;
  pitchMin: number;
  pitchMax: number;
};

export class Camera {
  pixelsPerTick = 0.08;
  noteHeightPx = 14;
  scrollTick = 0;
  topPitch = 84;

  viewportWidthPx = 800;
  viewportHeightPx = 600;

  setViewport(widthPx: number, heightPx: number): void {
    this.viewportWidthPx = Math.max(1, widthPx);
    this.viewportHeightPx = Math.max(1, heightPx);
  }

  tickToX(tick: number): number {
    return (tick - this.scrollTick) * this.pixelsPerTick;
  }

  xToTick(x: number): number {
    return x / this.pixelsPerTick + this.scrollTick;
  }

  pitchToY(pitch: number): number {
    return (this.topPitch - pitch) * this.noteHeightPx;
  }

  yToPitch(y: number): number {
    return this.topPitch - y / this.noteHeightPx;
  }

  visibleTickRange(): { min: number; max: number } {
    const min = this.scrollTick;
    const max = this.xToTick(this.viewportWidthPx);
    return { min, max };
  }

  visiblePitchRange(): { min: number; max: number } {
    const max = this.topPitch;
    const min = this.yToPitch(this.viewportHeightPx);
    return { min, max };
  }

  pan(deltaXpx: number, deltaYpx: number): void {
    this.scrollTick -= deltaXpx / this.pixelsPerTick;
    this.topPitch += deltaYpx / this.noteHeightPx;
  }

  zoomX(factor: number, anchorXpx: number): void {
    const beforeTick = this.xToTick(anchorXpx);
    this.pixelsPerTick = clamp(this.pixelsPerTick * factor, 0.01, 2.0);
    this.scrollTick = beforeTick - anchorXpx / this.pixelsPerTick;
  }

  zoomY(factor: number, anchorYpx: number): void {
    const beforePitch = this.yToPitch(anchorYpx);
    this.noteHeightPx = clamp(this.noteHeightPx * factor, 6, 40);
    this.topPitch = beforePitch + anchorYpx / this.noteHeightPx;
  }

  clampTo(limits: CameraLimits): void {
    this.scrollTick = Math.max(0, this.scrollTick);
    this.scrollTick = Math.min(this.scrollTick, Math.max(0, limits.maxTick));

    const visiblePitchSpan = this.viewportHeightPx / this.noteHeightPx;
    const topMax = limits.pitchMax;
    const topMin = limits.pitchMin + visiblePitchSpan;
    this.topPitch = clamp(this.topPitch, topMin, topMax);
  }
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

