import { afterEach, describe, expect, it, vi } from "vitest";

import { Camera } from "../lib/view/camera";
import { PianoRollController } from "../lib/view/interaction";

const fakeElement = (): HTMLElement => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  setPointerCapture: vi.fn(),
  getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 800, height: 120 }))
} as unknown as HTMLElement);

const makeController = () => {
  let playbackTick: number | null = 0;
  let frame: FrameRequestCallback | null = null;
  const startPlayback = vi.fn(async (tick: number) => {
    playbackTick = tick;
  });
  const stopPlayback = vi.fn(() => {
    playbackTick = null;
  });
  const onPlayheadChange = vi.fn();

  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn((cb: FrameRequestCallback) => {
    frame = cb;
    return 1;
  }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  const controller = new PianoRollController({
    rollElement: fakeElement(),
    rulerElement: fakeElement(),
    camera: new Camera(),
    getLimits: () => ({ maxTick: 1920, pitchMin: 0, pitchMax: 127 }),
    getNotes: () => [],
    getMeasureMap: () => null,
    getTempoMap: () => null,
    getLoopRange: () => null,
    startPlayback,
    stopPlayback,
    getPlaybackTick: () => playbackTick,
    requestRender: vi.fn(),
    onCursor: vi.fn(),
    onSelectionChange: vi.fn(),
    onPlayheadChange,
    onPlayingChange: vi.fn()
  });

  return {
    controller,
    startPlayback,
    stopPlayback,
    onPlayheadChange,
    setPlaybackTick: (tick: number) => {
      playbackTick = tick;
    },
    runFrame: () => {
      if (!frame) throw new Error("no animation frame scheduled");
      frame(0);
    }
  };
};

describe("PianoRollController playback clock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the playhead from the playback clock after audio starts", async () => {
    const h = makeController();
    h.controller.setPlayheadTick(480);
    h.onPlayheadChange.mockClear();

    await h.controller.play();

    expect(h.startPlayback).toHaveBeenCalledWith(480);
    expect(h.onPlayheadChange).toHaveBeenLastCalledWith(480);

    h.setPlaybackTick(720);
    h.runFrame();

    expect(h.onPlayheadChange).toHaveBeenLastCalledWith(720);
  });

  it("restarts playback from any seek direction while already playing", async () => {
    const h = makeController();
    await h.controller.play();
    h.startPlayback.mockClear();
    h.stopPlayback.mockClear();

    h.controller.setPlayheadTick(960);
    await Promise.resolve();

    expect(h.stopPlayback).toHaveBeenCalledTimes(1);
    expect(h.startPlayback).toHaveBeenLastCalledWith(960);

    h.controller.setPlayheadTick(240);
    await Promise.resolve();

    expect(h.stopPlayback).toHaveBeenCalledTimes(2);
    expect(h.startPlayback).toHaveBeenLastCalledWith(240);
  });
});
