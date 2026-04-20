import type { MeasureMap } from "../midi/measureMap";
import type { TempoMap } from "../midi/tempoMap";
import type { ProjectState, TrackState } from "../compose/state";
import { scheduleNotesInWindow } from "./schedule";
import { metronomeTicksInWindow } from "./metronome";

export type AudioStartOptions = {
  state: ProjectState;
  tempoMap: TempoMap;
  measureMap: MeasureMap;
  fromTick: number;
  playAllTracks: boolean;
  selectedTrackIndex: number;
  metronomeEnabled: boolean;
  volume: number;
  tone: "triangle" | "sawtooth";
};

type Session = {
  state: ProjectState;
  tempoMap: TempoMap;
  measureMap: MeasureMap;
  startTick: number;
  startTime: number;
  playAllTracks: boolean;
  metronomeEnabled: boolean;
  volume: number;
  tone: "triangle" | "sawtooth";
  noteCursor: number;
  notes: { all: TrackState["notes"]; maxTick: number };
  lastMetronomeTick: number;
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private running = false;
  private timer: number | null = null;
  private session: Session | null = null;

  private lookaheadMs = 25;
  private horizonSec = 0.8;

  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    return this.ctx;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(opts: AudioStartOptions): Promise<void> {
    const ctx = await this.ensureContext();
    this.stop();
    const notes = this.collectNotes(opts.state, opts.playAllTracks, opts.selectedTrackIndex);
    const startTime = ctx.currentTime + 0.05;
    this.session = {
      state: opts.state,
      tempoMap: opts.tempoMap,
      measureMap: opts.measureMap,
      startTick: Math.max(0, opts.fromTick),
      startTime,
      playAllTracks: opts.playAllTracks,
      metronomeEnabled: opts.metronomeEnabled,
      volume: opts.volume,
      tone: opts.tone,
      noteCursor: 0,
      notes: { all: notes, maxTick: opts.state.maxTick },
      lastMetronomeTick: Math.max(0, opts.fromTick)
    };
    this.setVolume(opts.volume);
    this.running = true;
    this.timer = window.setInterval(() => this.schedule(), this.lookaheadMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.session = null;
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  private collectNotes(state: ProjectState, playAllTracks: boolean, selectedTrackIndex: number): TrackState["notes"] {
    if (playAllTracks) {
      const all: TrackState["notes"] = [];
      for (const t of state.tracks) all.push(...t.notes);
      all.sort((a, b) => (a.startTick - b.startTick) || (a.pitch - b.pitch));
      return all;
    }
    const t = state.tracks.find((x) => x.trackIndex === selectedTrackIndex) ?? state.tracks[0];
    return t ? [...t.notes] : [];
  }

  private schedule(): void {
    if (!this.running || !this.session || !this.ctx) return;
    const s = this.session;
    const now = this.ctx.currentTime;
    const elapsed = Math.max(0, now - s.startTime);
    const startSeconds = s.tempoMap.ticksToSeconds(s.startTick);
    const currentTick = s.tempoMap.secondsToTicks(startSeconds + elapsed);
    const horizonTick = s.tempoMap.secondsToTicks(startSeconds + elapsed + this.horizonSec);

    const notes = s.notes.all;
    while (s.noteCursor < notes.length && notes[s.noteCursor]!.startTick < horizonTick) {
      const n = notes[s.noteCursor]!;
      s.noteCursor += 1;
      if (n.endTick <= s.startTick) continue;
      if (n.startTick < s.startTick) continue;
      const scheduled = scheduleNotesInWindow([n], {
        fromTick: s.startTick,
        toTick: horizonTick,
        startTick: s.startTick,
        startTime: s.startTime,
        tempoMap: s.tempoMap
      });
      if (scheduled[0]) this.playNote(scheduled[0], s.tone, s.volume);
    }

    if (s.metronomeEnabled) {
      const ticks = metronomeTicksInWindow(s.measureMap, s.lastMetronomeTick, horizonTick);
      for (const t of ticks) {
        if (t.tick < s.lastMetronomeTick) continue;
        const sec = s.tempoMap.ticksToSeconds(t.tick) - startSeconds + s.startTime;
        this.playClick(sec, t.isBar);
        s.lastMetronomeTick = t.tick + 1;
      }
    }
  }

  private playNote(note: { startSeconds: number; durationSeconds: number; pitch: number; velocity: number }, tone: "triangle" | "sawtooth", volume: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = tone;
    const freq = 440 * Math.pow(2, (note.pitch - 69) / 12);
    osc.frequency.setValueAtTime(freq, note.startSeconds);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1200 + note.velocity * 2000, note.startSeconds);

    const amp = Math.max(0.02, Math.min(1, note.velocity)) * 0.5 * volume;
    gain.gain.setValueAtTime(0.0001, note.startSeconds);
    gain.gain.linearRampToValueAtTime(amp, note.startSeconds + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, note.startSeconds + Math.max(0.05, note.durationSeconds));

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(note.startSeconds);
    osc.stop(note.startSeconds + Math.max(0.1, note.durationSeconds + 0.05));
  }

  private playClick(time: number, accent: boolean): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(accent ? 1400 : 1000, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(accent ? 0.25 : 0.15, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.06);
  }
}
