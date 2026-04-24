import { describe, expect, it } from "vitest";

import type { ProjectState } from "../lib/compose/state";
import { DraftSession } from "../lib/agent/draft";
import { buildToolDefinitions, createToolRunner } from "../lib/agent/tools";

const mkState = (): ProjectState => ({
  ppq: 480,
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
  maxTick: 0
});

const mkSixEightState = (): ProjectState => ({
  ...mkState(),
  timeSignatures: [{ tick: 0, numerator: 6, denominator: 8 }],
  maxTick: 480 * 6
});

describe("agent tools", () => {
  it("exposes only the minimal musical composer tools", () => {
    expect(buildToolDefinitions().map((t) => t.name)).toEqual([
      "place_note",
      "review_notes",
      "edit_note",
      "delete_notes",
      "finalize_composition_run"
    ]);
  });

  it("rejects wrong scopeId", () => {
    const session = new DraftSession(mkState(), { trackIndex: 0, tickStart: 0, tickEnd: 1920 });
    const run = createToolRunner(session);
    const out = run("place_note", { scopeId: "wrong", notes: [{ id: null, pitchName: "C4", bar: 1, beat: 1, duration: "quarter", velocity: 0.5 }] });
    expect((out as any).ok).toBe(false);
  });

  it("places notes using musical names and durations", () => {
    const session = new DraftSession(mkState(), { trackIndex: 0, tickStart: 0, tickEnd: 1920 });
    const run = createToolRunner(session);
    const out = run("place_note", {
      scopeId: session.scopeId,
      notes: [
        { id: "n1", pitchName: "C4", bar: 1, beat: 1, duration: "quarter", velocity: 0.5 },
        { id: "n2", pitchName: "E4", bar: 1, beat: 2, duration: "half", velocity: 0.6 }
      ]
    });
    expect((out as any).ok).toBe(true);
    expect(session.getTrack().notes).toMatchObject([
      { id: "n1", pitch: 60, startTick: 0, durationTicks: 480 },
      { id: "n2", pitch: 64, startTick: 480, durationTicks: 960 }
    ]);
  });

  it("places notes on displayed beats in compound meters", () => {
    const session = new DraftSession(mkSixEightState(), { trackIndex: 0, tickStart: 0, tickEnd: 1440 });
    const run = createToolRunner(session);
    const out = run("place_note", {
      scopeId: session.scopeId,
      notes: [{ id: "n1", pitchName: "C4", bar: 1, beat: 2, duration: "eighth", velocity: 0.5 }]
    });

    expect((out as any).ok).toBe(true);
    expect(session.getTrack().notes[0]).toMatchObject({ id: "n1", pitch: 60, startTick: 240, durationTicks: 240 });
  });

  it("reviews, edits, and deletes notes musically", () => {
    const session = new DraftSession(mkState(), { trackIndex: 0, tickStart: 0, tickEnd: 3840 });
    const run = createToolRunner(session);
    run("place_note", {
      scopeId: session.scopeId,
      notes: [{ id: "n1", pitchName: "C4", bar: 1, beat: 1, duration: "quarter", velocity: 0.5 }]
    });

    const reviewed = run("review_notes", { scopeId: session.scopeId, barStart: 1, barEnd: 1, limit: 10 });
    expect((reviewed as any).notes[0]).toMatchObject({ id: "n1", pitchName: "C4" });
    expect((reviewed as any).workspace).toMatchObject({
      timeSignature: "4/4",
      bars: 2,
      reviewedRange: { bars: 1 }
    });

    const edited = run("edit_note", {
      scopeId: session.scopeId,
      noteId: "n1",
      pitchName: "D4",
      bar: 1,
      beat: 2,
      duration: "half",
      velocity: 0.75
    });
    expect((edited as any).ok).toBe(true);
    expect(session.getTrack().notes[0]).toMatchObject({ pitch: 62, startTick: 480, durationTicks: 960, velocity: 0.75 });

    const deleted = run("delete_notes", { scopeId: session.scopeId, noteIds: [], barStart: 1, barEnd: 1, pitchMin: null, pitchMax: null });
    expect((deleted as any).ok).toBe(true);
    expect(session.getTrack().notes).toHaveLength(0);
  });

  it("reviews the actual meter and selected scope range", () => {
    const session = new DraftSession(mkSixEightState(), { trackIndex: 0, tickStart: 240, tickEnd: 1440 });
    const run = createToolRunner(session);
    const reviewed = run("review_notes", { scopeId: session.scopeId, barStart: null, barEnd: null, limit: 10 });

    expect((reviewed as any).workspace).toMatchObject({
      timeSignature: "6/8",
      bars: 1,
      scope: {
        tickStart: 240,
        tickEnd: 1440,
        start: { bar: 1, beat: 2, tick: 0 },
        end: { bar: 2, beat: 1, tick: 0 }
      },
      reviewedRange: {
        tickStart: 240,
        tickEnd: 1440,
        bars: 1
      }
    });
  });

  it("honors partial bar and beat edits", () => {
    const session = new DraftSession(mkState(), { trackIndex: 0, tickStart: 0, tickEnd: 7680 });
    const run = createToolRunner(session);
    run("place_note", {
      scopeId: session.scopeId,
      notes: [{ id: "n1", pitchName: "C4", bar: 1, beat: 2, duration: "quarter", velocity: 0.5 }]
    });

    const movedBar = run("edit_note", {
      scopeId: session.scopeId,
      noteId: "n1",
      pitchName: null,
      bar: 3,
      beat: null,
      duration: null,
      velocity: null
    });
    expect((movedBar as any).ok).toBe(true);
    expect(session.getTrack().notes[0]).toMatchObject({ startTick: 4320 });

    const movedBeat = run("edit_note", {
      scopeId: session.scopeId,
      noteId: "n1",
      pitchName: null,
      bar: null,
      beat: 4,
      duration: null,
      velocity: null
    });
    expect((movedBeat as any).ok).toBe(true);
    expect(session.getTrack().notes[0]).toMatchObject({ startTick: 5280 });
  });
});
