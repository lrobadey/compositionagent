import type { MeasureMap } from "../midi/measureMap";
import { pitchToName } from "../view/render";
import type { ComposeOp } from "../compose/ops";
import type { Note } from "../compose/state";
import { MAX_NOTES_ADDED_PER_PROPOSAL, MAX_NOTES_TOUCHED_PER_OP } from "../compose/limits";
import type { Scope } from "./scope";
import { normalizeScope, scopeContains } from "./scope";
import type { DraftSession, Proposal } from "./draft";

export type ToolResult = { ok: boolean; error?: string; warnings?: string[] } & Record<string, unknown>;

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const opId = (): string => `op_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
const newNoteId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `note_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`;
};

const clampPitch = (p: number): number => Math.max(0, Math.min(127, Math.round(p)));
const clampVelocity = (v: number): number => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

const toBeatTicks = (ppq: number): number => ppq; // v1: quarter note beat

const tickToBarString = (measureMap: MeasureMap, tick: number): string => {
  const mbt = measureMap.tickToBarBeatTick(tick);
  return `${mbt.bar}:${mbt.beat}:${mbt.tick}`;
};

const nullableNumber = (): Record<string, unknown> => ({ anyOf: [{ type: "number" }, { type: "null" }] });
const nullableString = (): Record<string, unknown> => ({ anyOf: [{ type: "string" }, { type: "null" }] });

export const buildToolDefinitions = (): ToolDefinition[] => [
  {
    name: "composer_thought",
    description:
      "Share a brief composing thought for this step (one concise sentence; may include note names like C#4 and composition language). Does not modify notes.",
    parameters: {
      type: "object",
      properties: { scopeId: { type: "string" }, text: { type: "string" } },
      required: ["scopeId", "text"],
      additionalProperties: false
    }
  },
  {
    name: "get_scope_summary",
    description: "Summarize the current editable scope (time/pitch range, note count, density hints).",
    parameters: {
      type: "object",
      properties: { scopeId: { type: "string" } },
      required: ["scopeId"],
      additionalProperties: false
    }
  },
  {
    name: "list_notes",
    description: "List a small slice of notes for local reasoning (time window + optional pitch filters).",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        tickStart: { type: "number" },
        tickEnd: { type: "number" },
        pitchMin: nullableNumber(),
        pitchMax: nullableNumber(),
        limit: { type: "number" }
      },
      // Strict schemas require the model to supply every key; treat optional fields as nullable.
      required: ["scopeId", "tickStart", "tickEnd", "pitchMin", "pitchMax", "limit"],
      additionalProperties: false
    }
  },
  {
    name: "find_notes",
    description: "Find notes by simple filters (pitch/time/velocity). Returns ids only by default.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        pitch: nullableNumber(),
        pitchMin: nullableNumber(),
        pitchMax: nullableNumber(),
        tickStart: nullableNumber(),
        tickEnd: nullableNumber(),
        velocityMin: nullableNumber(),
        velocityMax: nullableNumber(),
        limit: { type: "number" }
      },
      required: ["scopeId", "pitch", "pitchMin", "pitchMax", "tickStart", "tickEnd", "velocityMin", "velocityMax", "limit"],
      additionalProperties: false
    }
  },
  {
    name: "add_notes",
    description: "Add notes in the current scope (batch). Each note includes pitch, startTick, durationTicks, velocity.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        notes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: nullableString(),
              pitch: { type: "number" },
              startTick: { type: "number" },
              durationTicks: { type: "number" },
              velocity: { type: "number" }
            },
            required: ["id", "pitch", "startTick", "durationTicks", "velocity"],
            additionalProperties: false
          }
        }
      },
      required: ["scopeId", "notes"],
      additionalProperties: false
    }
  },
  {
    name: "delete_notes",
    description: "Delete notes by id.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        noteIds: { type: "array", items: { type: "string" } }
      },
      required: ["scopeId", "noteIds"],
      additionalProperties: false
    }
  },
  {
    name: "move_notes",
    description: "Move notes by (deltaTicks, deltaPitch).",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        noteIds: { type: "array", items: { type: "string" } },
        deltaTicks: { type: "number" },
        deltaPitch: { type: "number" }
      },
      required: ["scopeId", "noteIds", "deltaTicks", "deltaPitch"],
      additionalProperties: false
    }
  },
  {
    name: "resize_notes",
    description: "Resize notes by setting durationTicks or endTick.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        noteIds: { type: "array", items: { type: "string" } },
        durationTicks: nullableNumber(),
        endTick: nullableNumber()
      },
      required: ["scopeId", "noteIds", "durationTicks", "endTick"],
      additionalProperties: false
    }
  },
  {
    name: "set_velocity",
    description: "Set velocity for a set of notes (0..1).",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        noteIds: { type: "array", items: { type: "string" } },
        velocity: { type: "number" }
      },
      required: ["scopeId", "noteIds", "velocity"],
      additionalProperties: false
    }
  },
  {
    name: "clear_range",
    description: "Clear notes that overlap a tick range (and optional pitch range).",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        tickStart: { type: "number" },
        tickEnd: { type: "number" },
        pitchMin: nullableNumber(),
        pitchMax: nullableNumber()
      },
      required: ["scopeId", "tickStart", "tickEnd", "pitchMin", "pitchMax"],
      additionalProperties: false
    }
  },
  {
    name: "quantize",
    description: "Quantize notes (selected/range/all) to a grid.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        target: { type: "string", enum: ["selected", "range", "all"] },
        grid: {
          type: "object",
          properties: { divisionPerBeat: { type: "number", enum: [4, 8, 16] } },
          required: ["divisionPerBeat"],
          additionalProperties: false
        },
        mode: { type: "string", enum: ["start", "start_end"] },
        tickStart: nullableNumber(),
        tickEnd: nullableNumber(),
        noteIds: { type: "array", items: { type: "string" } }
      },
      required: ["scopeId", "target", "grid", "mode", "tickStart", "tickEnd", "noteIds"],
      additionalProperties: false
    }
  },
  {
    name: "humanize",
    description: "Humanize notes (selected/range/all) by random timing/velocity with a deterministic seed.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        target: { type: "string", enum: ["selected", "range", "all"] },
        timingStddevTicks: { type: "number" },
        velocityStddev: { type: "number" },
        seed: { type: "number" },
        tickStart: nullableNumber(),
        tickEnd: nullableNumber(),
        noteIds: { type: "array", items: { type: "string" } }
      },
      required: ["scopeId", "target", "timingStddevTicks", "velocityStddev", "seed", "tickStart", "tickEnd", "noteIds"],
      additionalProperties: false
    }
  },
  {
    name: "add_chord_progression",
    description: "Macro: add a simple chord progression as block chords inside the scope.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        key: { type: "string" },
        scale: { type: "string", enum: ["major", "minor"] },
        progression: { type: "array", items: { type: "string" } },
        rhythm: { type: "string", enum: ["whole", "half", "quarter"] },
        voicing: { type: "string", enum: ["triad", "seventh"] },
        tickStart: { type: "number" },
        bars: { type: "number" }
      },
      required: ["scopeId", "key", "scale", "progression", "rhythm", "voicing", "tickStart", "bars"],
      additionalProperties: false
    }
  },
  {
    name: "arpeggiate",
    description: "Macro: add an arpeggio pattern for a chord inside the scope.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        pattern: { type: "string", enum: ["up", "down", "updown", "random"] },
        rate: { type: "string", enum: ["8th", "16th"] },
        tickStart: { type: "number" },
        bars: { type: "number" },
        chord: {
          type: "object",
          properties: {
            root: { type: "string" },
            quality: { type: "string", enum: ["maj", "min", "dim", "aug"] },
            octave: nullableNumber()
          },
          required: ["root", "quality", "octave"],
          additionalProperties: false
        }
      },
      required: ["scopeId", "pattern", "rate", "tickStart", "bars", "chord"],
      additionalProperties: false
    }
  },
  {
    name: "drum_pattern_basic",
    description: "Macro: add a basic drum pattern (kick/snare/hats) using GM drum pitches.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        style: { type: "string", enum: ["four_on_floor", "hiphop_basic"] },
        bars: { type: "number" },
        density: { type: "string", enum: ["low", "medium", "high"] },
        tickStart: { type: "number" }
      },
      required: ["scopeId", "style", "bars", "density", "tickStart"],
      additionalProperties: false
    }
  },
  {
    name: "finalize_proposal",
    description: "Finalize and return the proposal ops and summary. Must be called exactly once at the end.",
    parameters: {
      type: "object",
      properties: {
        scopeId: { type: "string" },
        musicalSummary: nullableString()
      },
      required: ["scopeId", "musicalSummary"],
      additionalProperties: false
    }
  }
];

export const createToolRunner = (session: DraftSession): ((name: string, args: any) => ToolResult) => {
  const scope = session.scope;

  const ensureScope = (scopeId: string): string | null => {
    if (scopeId !== session.scopeId) return "invalid scopeId";
    return null;
  };

  const getScopedNotes = (): Note[] => session.getTrack().notes.filter((n) => scopeContains(scope, n));

  const find = (filters: any): string[] => {
    const notes = getScopedNotes();
    const limit = Math.max(1, Math.min(5000, Math.floor(filters.limit ?? 200)));
    const out: string[] = [];
    for (const n of notes) {
      if (filters.pitch != null && n.pitch !== Math.round(filters.pitch)) continue;
      if (filters.pitchMin != null && n.pitch < Math.floor(filters.pitchMin)) continue;
      if (filters.pitchMax != null && n.pitch > Math.ceil(filters.pitchMax)) continue;
      if (filters.tickStart != null && n.startTick < Math.floor(filters.tickStart)) continue;
      if (filters.tickEnd != null && n.endTick > Math.ceil(filters.tickEnd)) continue;
      if (filters.velocityMin != null && n.velocity < filters.velocityMin) continue;
      if (filters.velocityMax != null && n.velocity > filters.velocityMax) continue;
      out.push(n.id);
      if (out.length >= limit) break;
    }
    return out;
  };

  const addNotes = (scopeId: string, notesIn: any[]): ToolResult => {
    const err = ensureScope(scopeId);
    if (err) return { ok: false, error: err };
    if (notesIn.length > MAX_NOTES_ADDED_PER_PROPOSAL) return { ok: false, error: "too many notes in one call" };

    const notes: Note[] = notesIn.map((n) => {
      const pitch = clampPitch(n.pitch);
      const startTick = Math.max(0, Math.round(n.startTick));
      const durationTicks = Math.max(0, Math.round(n.durationTicks));
      const id = typeof n.id === "string" && n.id.trim().length ? n.id.trim() : newNoteId();
      return {
        id,
        pitch,
        startTick,
        durationTicks,
        endTick: startTick + durationTicks,
        velocity: clampVelocity(n.velocity),
        channel: session.getTrack().channel,
        trackIndex: scope.trackIndex
      };
    });

    const op: ComposeOp = {
      kind: "add_notes",
      opId: opId(),
      scopeId,
      trackIndex: scope.trackIndex,
      notes
    };
    const res = session.apply(op);
    return { ok: res.applied, warnings: res.warnings };
  };

  const applySimple = (op: ComposeOp): ToolResult => {
    if (op.scopeId !== session.scopeId) return { ok: false, error: "invalid scopeId" };
    const res = session.apply(op);
    return { ok: res.applied, warnings: res.warnings };
  };

  const macroChordProgression = (args: any): ToolResult => {
    const err = ensureScope(args.scopeId);
    if (err) return { ok: false, error: err };

    const beatTicks = toBeatTicks(session.draftState.ppq);
    const measureMap = session.getMeasureMap();
    const rhythmMult = args.rhythm === "half" ? 2 : args.rhythm === "quarter" ? 1 : 4;
    const chordDur = beatTicks * rhythmMult;

    const startTick = Math.max(scope.tickStart, Math.round(args.tickStart));
    const maxBars = Math.max(1, Math.min(64, Math.round(args.bars)));
    const tickEnd = Math.min(scope.tickEnd, startTick + maxBars * beatTicks * 4);

    const pitchesForChord = (rootMidi: number, quality: string, voicing: string): number[] => {
      const triad =
        quality === "min"
          ? [0, 3, 7]
          : quality === "dim"
            ? [0, 3, 6]
            : quality === "aug"
              ? [0, 4, 8]
              : [0, 4, 7];
      const seventh = voicing === "seventh" ? (quality === "min" ? 10 : 11) : null;
      const out = triad.map((i) => rootMidi + i);
      if (seventh != null) out.push(rootMidi + seventh);
      return out;
    };

    const parseRoot = (key: string): number => {
      const m = key.trim().toUpperCase();
      const map: Record<string, number> = { C: 60, "C#": 61, DB: 61, D: 62, "D#": 63, EB: 63, E: 64, F: 65, "F#": 66, GB: 66, G: 67, "G#": 68, AB: 68, A: 69, "A#": 70, BB: 70, B: 71 };
      return map[m] ?? 60;
    };

    const rootBase = parseRoot(args.key);
    const qualitySeq = args.scale === "minor" ? ["min", "dim", "maj", "min", "min", "maj", "maj"] : ["maj", "min", "min", "maj", "maj", "min", "dim"];
    const degrees = (args.progression as string[]).map((p) => romanToDegree(p));

    const notes: any[] = [];
    let t = startTick;
    let step = 0;
    while (t + chordDur <= tickEnd && step < 128) {
      const degree = degrees[step % degrees.length] ?? 1;
      const scaleOffsets = args.scale === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
      const rootMidi = rootBase + (scaleOffsets[(degree - 1) % 7] ?? 0);
      const quality = qualitySeq[(degree - 1) % 7] ?? "maj";
      const chordPitches = pitchesForChord(rootMidi, quality, args.voicing);
      for (const p of chordPitches) {
        notes.push({ pitch: p, startTick: t, durationTicks: chordDur, velocity: 0.6 });
      }
      t += chordDur;
      step += 1;
    }

    const label = `${tickToBarString(measureMap, startTick)}–${tickToBarString(measureMap, tickEnd)}`;
    const res = addNotes(args.scopeId, notes);
    return { ...res, summary: `Added chord progression (${label}).` };
  };

  const macroArpeggiate = (args: any): ToolResult => {
    const err = ensureScope(args.scopeId);
    if (err) return { ok: false, error: err };

    const beatTicks = toBeatTicks(session.draftState.ppq);
    const stepTicks = args.rate === "16th" ? Math.round(beatTicks / 4) : Math.round(beatTicks / 2);

    const startTick = Math.max(scope.tickStart, Math.round(args.tickStart));
    const bars = Math.max(1, Math.min(64, Math.round(args.bars)));
    const tickEnd = Math.min(scope.tickEnd, startTick + bars * beatTicks * 4);

    const rootMidi = parsePitch(args.chord.root, args.chord.octave ?? 4);
    const chordPitches = chordToPitches(rootMidi, args.chord.quality);
    const seq = buildArpSeq(chordPitches, args.pattern, Math.floor((tickEnd - startTick) / stepTicks));

    const notes: any[] = [];
    for (let i = 0; i < seq.length; i++) {
      const t = startTick + i * stepTicks;
      if (t + stepTicks > tickEnd) break;
      notes.push({ pitch: seq[i]!, startTick: t, durationTicks: stepTicks, velocity: 0.55 });
    }
    const res = addNotes(args.scopeId, notes);
    return { ...res, summary: `Added arpeggio (${args.pattern}, ${args.rate}).` };
  };

  const macroDrums = (args: any): ToolResult => {
    const err = ensureScope(args.scopeId);
    if (err) return { ok: false, error: err };

    const beatTicks = toBeatTicks(session.draftState.ppq);
    const startTick = Math.max(scope.tickStart, Math.round(args.tickStart));
    const bars = Math.max(1, Math.min(128, Math.round(args.bars)));
    const tickEnd = Math.min(scope.tickEnd, startTick + bars * beatTicks * 4);

    const kick = 36;
    const snare = 38;
    const hat = 42;

    const notes: any[] = [];
    const hatStep = args.density === "high" ? Math.round(beatTicks / 2) : Math.round(beatTicks);
    for (let t = startTick; t < tickEnd; t += beatTicks) {
      if (args.style === "four_on_floor") notes.push({ pitch: kick, startTick: t, durationTicks: Math.round(beatTicks / 4), velocity: 0.9 });
      if (args.style === "hiphop_basic") {
        if (((t - startTick) / beatTicks) % 4 === 0) notes.push({ pitch: kick, startTick: t, durationTicks: Math.round(beatTicks / 4), velocity: 0.85 });
        if (((t - startTick) / beatTicks) % 4 === 2) notes.push({ pitch: kick, startTick: t, durationTicks: Math.round(beatTicks / 4), velocity: 0.7 });
      }
      const beatIndex = Math.round((t - startTick) / beatTicks) % 4;
      if (beatIndex === 1 || beatIndex === 3) notes.push({ pitch: snare, startTick: t, durationTicks: Math.round(beatTicks / 4), velocity: 0.8 });
    }
    for (let t = startTick; t < tickEnd; t += hatStep) {
      notes.push({ pitch: hat, startTick: t, durationTicks: Math.round(beatTicks / 6), velocity: args.density === "low" ? 0.35 : 0.5 });
    }

    const res = addNotes(args.scopeId, notes);
    return { ...res, summary: `Added drum pattern (${args.style}, ${args.density}).` };
  };

  return (name: string, args: any): ToolResult => {
    switch (name) {
      case "composer_thought": {
        const err = ensureScope(args.scopeId);
        if (err) return { ok: false, error: err };
        const text = typeof args.text === "string" ? args.text.trim() : "";
        if (!text) return { ok: false, error: "missing thought text" };
        return { ok: true, text };
      }
      case "get_scope_summary": {
        const err = ensureScope(args.scopeId);
        if (err) return { ok: false, error: err };
        const measureMap = session.getMeasureMap();
        const notes = getScopedNotes();
        const pitchMin = notes.reduce((m, n) => Math.min(m, n.pitch), 127);
        const pitchMax = notes.reduce((m, n) => Math.max(m, n.pitch), 0);
        const spanTicks = Math.max(1, scope.tickEnd - scope.tickStart);
        const density = notes.length / spanTicks;
        return {
          ok: true,
          scope: { ...normalizeScope(scope) },
          time: `${tickToBarString(measureMap, scope.tickStart)}–${tickToBarString(measureMap, scope.tickEnd)}`,
          notes: { count: notes.length, densityPerTick: Number(density.toFixed(6)) },
          pitch: { min: pitchMin, max: pitchMax, minName: pitchToName(pitchMin), maxName: pitchToName(pitchMax) }
        };
      }
      case "list_notes": {
        const err = ensureScope(args.scopeId);
        if (err) return { ok: false, error: err };
        const limit = Math.max(1, Math.min(200, Math.floor(args.limit)));
        const a = Math.max(scope.tickStart, Math.floor(args.tickStart));
        const b = Math.min(scope.tickEnd, Math.ceil(args.tickEnd));
        const pMin = args.pitchMin == null ? scope.pitchMin : Math.max(scope.pitchMin ?? 0, Math.floor(args.pitchMin));
        const pMax = args.pitchMax == null ? scope.pitchMax : Math.min(scope.pitchMax ?? 127, Math.ceil(args.pitchMax));
        const out: Array<Pick<Note, "id" | "pitch" | "startTick" | "durationTicks" | "velocity">> = [];
        for (const n of session.getTrack().notes) {
          if (n.startTick < a || n.endTick > b) continue;
          if (pMin != null && n.pitch < pMin) continue;
          if (pMax != null && n.pitch > pMax) continue;
          if (!scopeContains(scope, n)) continue;
          out.push({ id: n.id, pitch: n.pitch, startTick: n.startTick, durationTicks: n.durationTicks, velocity: n.velocity });
          if (out.length >= limit) break;
        }
        return { ok: true, notes: out };
      }
      case "find_notes": {
        const err = ensureScope(args.scopeId);
        if (err) return { ok: false, error: err };
        const ids = find(args);
        return { ok: true, noteIds: ids };
      }
      case "add_notes":
        return addNotes(args.scopeId, args.notes ?? []);
      case "delete_notes":
        if ((args.noteIds?.length ?? 0) > MAX_NOTES_TOUCHED_PER_OP) return { ok: false, error: "too many noteIds" };
        return applySimple({
          kind: "delete_notes",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          noteIds: args.noteIds ?? []
        });
      case "move_notes":
        if ((args.noteIds?.length ?? 0) > MAX_NOTES_TOUCHED_PER_OP) return { ok: false, error: "too many noteIds" };
        return applySimple({
          kind: "move_notes",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          noteIds: args.noteIds ?? [],
          deltaTicks: args.deltaTicks ?? 0,
          deltaPitch: args.deltaPitch ?? 0
        });
      case "resize_notes":
        if ((args.noteIds?.length ?? 0) > MAX_NOTES_TOUCHED_PER_OP) return { ok: false, error: "too many noteIds" };
        return applySimple({
          kind: "resize_notes",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          noteIds: args.noteIds ?? [],
          durationTicks: args.durationTicks,
          endTick: args.endTick
        });
      case "set_velocity":
        if ((args.noteIds?.length ?? 0) > MAX_NOTES_TOUCHED_PER_OP) return { ok: false, error: "too many noteIds" };
        return applySimple({
          kind: "set_velocity",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          noteIds: args.noteIds ?? [],
          velocity: args.velocity
        });
      case "clear_range":
        return applySimple({
          kind: "clear_range",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          tickStart: args.tickStart,
          tickEnd: args.tickEnd,
          pitchMin: args.pitchMin,
          pitchMax: args.pitchMax
        });
      case "quantize":
        return applySimple({
          kind: "quantize",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          target: args.target,
          grid: args.grid,
          mode: args.mode,
          tickStart: args.tickStart,
          tickEnd: args.tickEnd,
          noteIds: args.noteIds
        });
      case "humanize":
        return applySimple({
          kind: "humanize",
          opId: opId(),
          scopeId: args.scopeId,
          trackIndex: scope.trackIndex,
          target: args.target,
          timingStddevTicks: args.timingStddevTicks,
          velocityStddev: args.velocityStddev,
          seed: args.seed,
          tickStart: args.tickStart,
          tickEnd: args.tickEnd,
          noteIds: args.noteIds
        });
      case "add_chord_progression":
        return macroChordProgression(args);
      case "arpeggiate":
        return macroArpeggiate(args);
      case "drum_pattern_basic":
        return macroDrums(args);
      case "finalize_proposal": {
        const err = ensureScope(args.scopeId);
        if (err) return { ok: false, error: err };
        const proposal = session.finalize(args.musicalSummary);
        return {
          ok: true,
          proposalId: proposal.proposalId,
          diffStats: proposal.diffStats,
          warnings: proposal.warnings,
          musical_summary: proposal.musicalSummary ?? ""
        };
      }
      default:
        return { ok: false, error: `unknown tool: ${name}` };
    }
  };
};

const romanToDegree = (roman: string): number => {
  const r = roman.trim().toUpperCase();
  const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };
  const cleaned = r.replace(/[^IV]/g, "");
  return map[cleaned] ?? 1;
};

const parsePitch = (root: string, octave: number): number => {
  const s = root.trim().toUpperCase();
  const map: Record<string, number> = { C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11 };
  const pc = map[s] ?? 0;
  return 12 * (octave + 1) + pc;
};

const chordToPitches = (rootMidi: number, quality: "maj" | "min" | "dim" | "aug"): number[] => {
  const triad =
    quality === "min" ? [0, 3, 7] : quality === "dim" ? [0, 3, 6] : quality === "aug" ? [0, 4, 8] : [0, 4, 7];
  return triad.map((i) => clampPitch(rootMidi + i));
};

const buildArpSeq = (pitches: number[], pattern: string, length: number): number[] => {
  const seq: number[] = [];
  const up = [...pitches].sort((a, b) => a - b);
  const down = [...up].reverse();
  const base =
    pattern === "down" ? down : pattern === "updown" ? [...up, ...down.slice(1, -1)] : up;
  for (let i = 0; i < length; i++) {
    if (pattern === "random") seq.push(up[Math.floor(Math.random() * up.length)]!);
    else seq.push(base[i % base.length]!);
  }
  return seq;
};
