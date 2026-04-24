import type { ProjectState } from "../compose/state";
import { MAX_TOOL_CALLS_PER_RUN } from "../compose/limits";
import type { Scope } from "./scope";
import { DraftSession, type Proposal } from "./draft";
import { buildToolDefinitions, createToolRunner } from "./tools";
import { parseSse } from "../openai/sse";

type ResponseTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
};

type FunctionCallItem = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

type ResponsesApiResponse = {
  id: string;
  output?: any[];
  status?: string;
};

export type RunComposerParams = {
  userPrompt: string;
  stylePreset?: "counter_melody" | "tighten_rhythm" | "tension_resolve";
  scope: Scope;
  liveState: ProjectState;
  proxyUrl?: string;
  proxyOrigin?: string;
  fetchFn?: typeof fetch;
  scopeIdOverride?: string;
  stream?: boolean;
  signal?: AbortSignal;
  onStreamEvent?: (e: AgentStreamEvent) => void;
  onDraftUpdate?: (draft: { draftState: ProjectState; opCount: number; lastTool?: ToolSummary }) => void;
  stepMode?: boolean;
  stepMaxSteps?: number;
  stepMaxNotesPerAdd?: number;
  maxToolCalls?: number;
};

export type ToolSummary = { name: string; callId: string; argsJsonText: string; outputIndex: number };

export type AgentStreamEvent =
  | { type: "status"; message: string }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "tool_call_started"; tool: ToolSummary }
  | { type: "tool_call_delta"; tool: ToolSummary; delta: string }
  | { type: "tool_call_done"; tool: ToolSummary }
  | { type: "tool_applied"; tool: ToolSummary; ok: boolean; warnings?: string[]; outputText?: string };

const buildInstructions = (stepMode: boolean, stepMaxNotesPerAdd: number): string => {
  const base = [
    "You are an agentic MIDI composer working inside a piano-roll editor.",
    "You MUST ONLY act by calling the provided tools (function calls).",
    "Never output MIDI bytes or attempt to describe MIDI file encoding.",
    "The workspace is 4/4 time and the first composition canvas is 8 bars long.",
    "Think in musical terms first: bars, beats, note names, durations, phrases, harmony, rhythm, contour, and register.",
    "Form a short internal plan before placing notes.",
    "Use JSON only as the tool language; do not let raw JSON become the composition language.",
    "Stay strictly within the provided 8-bar scope unless the user's selected scope is smaller.",
    "Compose deliberately with place_note, usually placing 1-3 notes per tool call.",
    "Review your work with review_notes before finalizing.",
    "If review shows weak spots, use edit_note or delete_notes and then review again.",
    "Call finalize_composition_run exactly once when the composition run is complete.",
    "If a tool call fails due to scope or caps, adjust your plan and try a smaller change."
  ];

  if (!stepMode) return base.join("\n");

  const maxNotes = Math.max(1, Math.floor(stepMaxNotesPerAdd));
  const step = [
    "YOU ARE IN STEP MODE.",
    "Use one mutating tool call at a time, then review or continue.",
    `Each place_note call must include at most ${maxNotes} notes.`,
    "Stop when you're done OR when you reach the step cap; then call finalize_composition_run exactly once.",
    "Do not use macro tools; only the five provided composer tools are available."
  ];

  return [...base, "", ...step].join("\n");
};

const MUTATING_TOOLS = new Set([
  "place_note",
  "edit_note",
  "delete_notes",
  "add_notes",
  "move_notes",
  "resize_notes",
  "set_velocity",
  "clear_range",
  "quantize",
  "humanize",
  // macros
  "add_chord_progression",
  "arpeggiate",
  "add_drums_pattern"
]);

const presetHint = (preset: RunComposerParams["stylePreset"]): string => {
  if (preset === "counter_melody") return "Goal: add a simple counter-melody that complements the existing melody, mostly stepwise, avoid clashes.";
  if (preset === "tighten_rhythm") return "Goal: tighten rhythm: reduce overlaps, quantize lightly, remove obvious timing noise while keeping groove.";
  if (preset === "tension_resolve") return "Goal: add tension then resolve within the scope (leading tones, suspensions, resolving to chord tones).";
  return "";
};

export const runComposerAgent = async (params: RunComposerParams): Promise<Proposal> => {
  const fetchFn = params.fetchFn ?? fetch;
  const proxyUrl = params.proxyUrl ?? "/api/openai/responses";
  const proxyOrigin =
    params.proxyOrigin ??
    (typeof window === "undefined" ? (globalThis as any)?.process?.env?.AGENT_PROXY_ORIGIN : undefined) ??
    undefined;
  const stream = params.stream ?? true;
  const stepMode = params.stepMode ?? false;
  const stepMaxSteps = Math.max(1, Math.floor(params.stepMaxSteps ?? 64));
  const stepMaxNotesPerAdd = Math.max(1, Math.floor(params.stepMaxNotesPerAdd ?? 4));
  const maxToolCalls =
    params.maxToolCalls ?? (stepMode ? Math.max(160, stepMaxSteps * 2 + 10) : MAX_TOOL_CALLS_PER_RUN);

  const session = new DraftSession(params.liveState, params.scope, params.scopeIdOverride);
  const runTool = createToolRunner(session);

  const toolDefs = buildToolDefinitions();
  const tools: ResponseTool[] = toolDefs.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: true
  }));

  const measureMap = session.getMeasureMap();
  const scopeLabel = `Scope:\n- scopeId: ${session.scopeId}\n- trackIndex: ${session.scope.trackIndex}\n- tickStart: ${session.scope.tickStart}\n- tickEnd: ${session.scope.tickEnd}\n- pitchMin: ${session.scope.pitchMin ?? "none"}\n- pitchMax: ${session.scope.pitchMax ?? "none"}\n- start: ${measureMap.tickToBarBeatTick(session.scope.tickStart).bar}:${measureMap.tickToBarBeatTick(session.scope.tickStart).beat}\n- end: ${measureMap.tickToBarBeatTick(session.scope.tickEnd).bar}:${measureMap.tickToBarBeatTick(session.scope.tickEnd).beat}`;

  const initialInput = [
    params.userPrompt.trim(),
    presetHint(params.stylePreset),
    scopeLabel,
    "Start by calling review_notes(scopeId, barStart: null, barEnd: null, limit: 200)."
  ]
    .filter(Boolean)
    .join("\n\n");

  let toolCalls = 0;
  let stepsCompleted = 0;
  let lastResponse: ResponsesApiResponse | null = null;
  // We manage conversation state locally (store=false), appending model output items and tool outputs.
  // This avoids relying on previous_response_id, which may not work when responses aren't stored.
  const inputList: any[] = [{ role: "user", content: initialInput }];

  while (toolCalls < maxToolCalls) {
    if (stepMode && stepsCompleted >= stepMaxSteps) {
      return session.finalize(`Stopped after ${stepMaxSteps} steps (step mode cap).`);
    }
    const body: any = {
      model: "gpt-5.4",
      instructions: buildInstructions(stepMode, stepMaxNotesPerAdd),
      tool_choice: "auto",
      tools,
      parallel_tool_calls: false,
      store: false,
      reasoning: { effort: "medium" },
      input: inputList
    };
    if (stream) body.stream = true;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // In browsers the Origin header is set automatically and cannot be overridden; in Node we may need it for the local proxy allowlist.
    if (typeof window === "undefined" && proxyOrigin) headers.Origin = proxyOrigin;

    let resp: Response;
    try {
      resp = await fetchFn(proxyUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: params.signal
      });
    } catch (e) {
      const origin =
        typeof window !== "undefined" && window.location?.origin ? window.location.origin : "(no window origin)";
      throw new Error(
        [
          "Network error calling agent proxy.",
          `proxyUrl: ${proxyUrl}`,
          `origin: ${origin}`,
          "hint: This usually means the proxy is not running (or is on a different port).",
          "      Start it in another terminal: cd midi-piano-roll && export OPENAI_API_KEY=\"...\" && npm run agent:proxy",
          "      If you opened http://127.0.0.1:5173, ensure the proxy allows it or open http://localhost:5173.",
          `error: ${String(e)}`
        ].join("\n")
      );
    }
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return session.finalize(`Proxy error: ${resp.status} ${txt}`.slice(0, 300));
    }
    if (params.signal?.aborted) return session.finalize("Cancelled by user.");

    const contentType =
      typeof (resp as any)?.headers?.get === "function" ? ((resp as any).headers.get("content-type") ?? "") : "";
    const isSse = contentType.includes("text/event-stream");

    if (!stream || !isSse) {
      // Fallback to non-streaming JSON response handling.
      const data = (await resp.json()) as ResponsesApiResponse;
      lastResponse = data;

      const output = Array.isArray(data.output) ? data.output : [];
      const callItems: FunctionCallItem[] = output.filter((x) => x?.type === "function_call");
      inputList.push(...callItems);
      if (callItems.length === 0) break;

      for (const call of callItems) {
        toolCalls += 1;
        let args: any = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }
        const isMutating = MUTATING_TOOLS.has(call.name);

        let result: any;
        if (stepMode && isMutating && stepsCompleted >= stepMaxSteps) {
          return session.finalize(`Stopped after ${stepMaxSteps} steps (step mode cap).`);
        }

        if (
          stepMode &&
          (call.name === "place_note" || call.name === "add_notes") &&
          Array.isArray(args?.notes) &&
          args.notes.length > stepMaxNotesPerAdd
        ) {
          result = { ok: false, error: "step_mode_max_notes_exceeded", max: stepMaxNotesPerAdd };
        } else {
          result = runTool(call.name, args);
          if (stepMode && isMutating) {
            stepsCompleted += 1;
            if (stepsCompleted >= stepMaxSteps) {
              // Stop immediately after completing the step.
              const tool: ToolSummary = { name: call.name, callId: call.call_id, argsJsonText: call.arguments ?? "", outputIndex: 0 };
              params.onStreamEvent?.({
                type: "tool_applied",
                tool,
                ok: Boolean(result?.ok),
                warnings: Array.isArray(result?.warnings) ? result.warnings : undefined,
                outputText: call.name === "composer_thought" && typeof result?.text === "string" ? result.text : undefined
              });
              inputList.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(result)
              });
              params.onDraftUpdate?.({ draftState: session.draftState, opCount: session.opLog.length, lastTool: tool });
              return session.finalize(`Stopped after ${stepMaxSteps} steps (step mode cap).`);
            }
          }
        }

        const tool: ToolSummary = { name: call.name, callId: call.call_id, argsJsonText: call.arguments ?? "", outputIndex: 0 };
        params.onStreamEvent?.({
          type: "tool_applied",
          tool,
          ok: Boolean(result?.ok),
          warnings: Array.isArray(result?.warnings) ? result.warnings : undefined,
          outputText: call.name === "composer_thought" && typeof result?.text === "string" ? result.text : undefined
        });

        inputList.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });

        params.onDraftUpdate?.({ draftState: session.draftState, opCount: session.opLog.length, lastTool: tool });

        if (call.name === "finalize_composition_run" || call.name === "finalize_proposal") return session.finalize(args?.musicalSummary);
        if (toolCalls >= maxToolCalls) break;
      }
      continue;
    }

    if (!resp.body) return session.finalize("Streaming response missing body.");

    /** Keyed by output_index */
    const inProgress: Record<number, FunctionCallItem> = {};
    let sawAnyCall = false;

    const emitStatus = (message: string) => params.onStreamEvent?.({ type: "status", message });

    emitStatus("Streaming response started...");

    for await (const event of parseSse(resp.body)) {
      if (params.signal?.aborted) return session.finalize("Cancelled by user.");
      const t = event?.type;

      if (t === "error") {
        params.onStreamEvent?.({ type: "error", message: "Invalid SSE event JSON", raw: event });
        continue;
      }

      if (t === "response.output_item.added") {
        const outputIndex = Number(event?.output_index);
        const item = event?.item;
        if (!Number.isFinite(outputIndex) || !item || item.type !== "function_call") continue;
        inProgress[outputIndex] = {
          type: "function_call",
          id: item.id,
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments ?? ""
        };
        params.onStreamEvent?.({
          type: "tool_call_started",
          tool: { name: item.name, callId: item.call_id, argsJsonText: item.arguments ?? "", outputIndex }
        });
        continue;
      }

      if (t === "response.function_call_arguments.delta") {
        const outputIndex = Number(event?.output_index);
        const delta = typeof event?.delta === "string" ? event.delta : "";
        if (!Number.isFinite(outputIndex) || !delta) continue;
        const cur = inProgress[outputIndex];
        if (!cur) continue;
        cur.arguments = `${cur.arguments ?? ""}${delta}`;
        params.onStreamEvent?.({
          type: "tool_call_delta",
          delta,
          tool: { name: cur.name, callId: cur.call_id, argsJsonText: cur.arguments ?? "", outputIndex }
        });
        continue;
      }

      if (t === "response.function_call_arguments.done") {
        const outputIndex = Number(event?.output_index);
        const argsText = typeof event?.arguments === "string" ? event.arguments : "";
        if (!Number.isFinite(outputIndex)) continue;
        const cur = inProgress[outputIndex];
        if (!cur) continue;
        if (argsText) cur.arguments = argsText;
        params.onStreamEvent?.({
          type: "tool_call_done",
          tool: { name: cur.name, callId: cur.call_id, argsJsonText: cur.arguments ?? "", outputIndex }
        });
        continue;
      }

      if (t === "response.output_item.done") {
        const outputIndex = Number(event?.output_index);
        const item = event?.item;
        if (!Number.isFinite(outputIndex) || !item || item.type !== "function_call") continue;
        sawAnyCall = true;

        const call: FunctionCallItem = {
          type: "function_call",
          id: item.id,
          call_id: item.call_id,
          name: item.name,
          arguments: item.arguments ?? ""
        };

        // Add the call item to the locally managed conversation state.
        inputList.push(call);

        toolCalls += 1;
        let args: any = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }
        const isMutating = MUTATING_TOOLS.has(call.name);

        let result: any;
        if (stepMode && isMutating && stepsCompleted >= stepMaxSteps) {
          return session.finalize(`Stopped after ${stepMaxSteps} steps (step mode cap).`);
        }

        if (
          stepMode &&
          (call.name === "place_note" || call.name === "add_notes") &&
          Array.isArray(args?.notes) &&
          args.notes.length > stepMaxNotesPerAdd
        ) {
          result = { ok: false, error: "step_mode_max_notes_exceeded", max: stepMaxNotesPerAdd };
        } else {
          result = runTool(call.name, args);
          if (stepMode && isMutating) {
            stepsCompleted += 1;
            if (stepsCompleted >= stepMaxSteps) {
              inputList.push({
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(result)
              });
              const tool: ToolSummary = { name: call.name, callId: call.call_id, argsJsonText: call.arguments ?? "", outputIndex };
              params.onStreamEvent?.({
                type: "tool_applied",
                tool,
                ok: Boolean(result?.ok),
                warnings: Array.isArray(result?.warnings) ? result.warnings : undefined,
                outputText: call.name === "composer_thought" && typeof result?.text === "string" ? result.text : undefined
              });
              params.onDraftUpdate?.({ draftState: session.draftState, opCount: session.opLog.length, lastTool: tool });
              return session.finalize(`Stopped after ${stepMaxSteps} steps (step mode cap).`);
            }
          }
        }
        inputList.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });

        const tool: ToolSummary = { name: call.name, callId: call.call_id, argsJsonText: call.arguments ?? "", outputIndex };
        params.onStreamEvent?.({
          type: "tool_applied",
          tool,
          ok: Boolean(result?.ok),
          warnings: Array.isArray(result?.warnings) ? result.warnings : undefined,
          outputText: call.name === "composer_thought" && typeof result?.text === "string" ? result.text : undefined
        });
        params.onDraftUpdate?.({ draftState: session.draftState, opCount: session.opLog.length, lastTool: tool });

        if (call.name === "finalize_composition_run" || call.name === "finalize_proposal") return session.finalize(args?.musicalSummary);
        if (toolCalls >= maxToolCalls) break;
        continue;
      }

      if (t === "response.done" || t === "done") {
        lastResponse = event?.response ?? lastResponse;
        break;
      }
    }

    if (!sawAnyCall) break;
  }

  return session.finalize(
    lastResponse ? "Agent did not finalize; returning current draft as proposal." : "No model response."
  );
};
