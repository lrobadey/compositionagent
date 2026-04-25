import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioEngine } from "../lib/audio/engine";
import { MeasureMap } from "../lib/midi/measureMap";
import { TempoMap } from "../lib/midi/tempoMap";
import type { ProjectState } from "../lib/compose/state";

class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = "";
  connect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeAudioContext {
  currentTime = 10;
  state = "running";
  destination = new FakeNode();

  createGain(): FakeNode {
    return new FakeNode();
  }

  createOscillator(): FakeNode {
    return new FakeNode();
  }

  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }

  async resume(): Promise<void> {}
}

const project = (maxTick: number): ProjectState => ({
  ppq: 480,
  tempos: [{ tick: 0, bpm: 120 }],
  timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
  tracks: [{ trackIndex: 0, name: "Track 1", channel: 0, notes: [] }],
  maxTick
});

describe("AudioEngine transport clock", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the scheduled audio tick from AudioContext.currentTime", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(() => ctx));
    vi.stubGlobal("window", {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const engine = new AudioEngine();
    const tempoMap = new TempoMap(480, [{ tick: 0, bpm: 120 }], 1920);
    const measureMap = new MeasureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }], 1920);

    await engine.start({
      state: project(1920),
      tempoMap,
      measureMap,
      fromTick: 480,
      playAllTracks: false,
      selectedTrackIndex: 0,
      metronomeEnabled: false,
      volume: 0.6,
      tone: "triangle"
    });

    expect(engine.getCurrentTick()).toBe(480);

    ctx.currentTime = 10.3;
    expect(engine.getCurrentTick()).toBeCloseTo(720);

    ctx.currentTime = 10.55;
    expect(engine.getCurrentTick()).toBeCloseTo(960);
  });

  it("preserves tempo-map timing across tempo changes", async () => {
    const ctx = new FakeAudioContext();
    vi.stubGlobal("AudioContext", vi.fn(() => ctx));
    vi.stubGlobal("window", {
      setInterval: vi.fn(() => 1),
      clearInterval: vi.fn()
    });

    const engine = new AudioEngine();
    const tempoMap = new TempoMap(480, [{ tick: 0, bpm: 120 }, { tick: 480, bpm: 60 }], 1920);
    const measureMap = new MeasureMap(480, [{ tick: 0, numerator: 4, denominator: 4 }], 1920);

    await engine.start({
      state: project(1920),
      tempoMap,
      measureMap,
      fromTick: 0,
      playAllTracks: false,
      selectedTrackIndex: 0,
      metronomeEnabled: false,
      volume: 0.6,
      tone: "triangle"
    });

    ctx.currentTime = 10.55;
    expect(engine.getCurrentTick()).toBeCloseTo(480);

    ctx.currentTime = 11.05;
    expect(engine.getCurrentTick()).toBeCloseTo(720);
  });
});
