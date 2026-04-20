import { describe, expect, it } from "vitest";

import type { ProjectState } from "../lib/compose/state";
import { runComposerAgent } from "../lib/agent/orchestrator";

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
  maxTick: 480 * 4 * 8
});

function toSse(events: any[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "\n";
}

function streamFromString(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Deliberately split to exercise chunk boundaries.
      const mid = Math.max(1, Math.floor(s.length / 2));
      controller.enqueue(enc.encode(s.slice(0, mid)));
      controller.enqueue(enc.encode(s.slice(mid)));
      controller.close();
    }
  });
}

describe("orchestrator (streaming)", () => {
  it("applies streamed tool calls and returns a proposal", async () => {
    let callIndex = 0;
    const scopeId = "SCOPE";

    const fakeFetch = async () => {
      callIndex += 1;

      if (callIndex === 1) {
        const sse = toSse([
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "function_call", id: "fc1", call_id: "c1", name: "get_scope_summary", arguments: "" }
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            delta: `{"scopeId":"${scopeId}"}`
          },
          {
            type: "response.function_call_arguments.done",
            output_index: 0,
            arguments: `{"scopeId":"${scopeId}"}`
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc1",
              call_id: "c1",
              name: "get_scope_summary",
              arguments: `{"scopeId":"${scopeId}"}`
            }
          },
          { type: "response.done", response: { id: "resp1" } }
        ]);
        return new Response(streamFromString(sse), { status: 200, headers: { "content-type": "text/event-stream" } });
      }

      if (callIndex === 2) {
        const sse = toSse([
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "function_call", id: "fc2", call_id: "c2", name: "add_notes", arguments: "" }
          },
          {
            type: "response.function_call_arguments.delta",
            output_index: 0,
            delta: `{"scopeId":"${scopeId}","notes":[{"pitch":60,"startTick":0,"durationTicks":120,"velocity":0.5,"id":null}]}`
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "function_call",
              id: "fc2",
              call_id: "c2",
              name: "add_notes",
              arguments: `{"scopeId":"${scopeId}","notes":[{"pitch":60,"startTick":0,"durationTicks":120,"velocity":0.5,"id":null}]}`
            }
          },
          { type: "response.done", response: { id: "resp2" } }
        ]);
        return new Response(streamFromString(sse), { status: 200, headers: { "content-type": "text/event-stream" } });
      }

      const sse = toSse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "fc3", call_id: "c3", name: "finalize_proposal", arguments: "" }
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 0,
          delta: `{"scopeId":"${scopeId}","musicalSummary":"ok"}`
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            type: "function_call",
            id: "fc3",
            call_id: "c3",
            name: "finalize_proposal",
            arguments: `{"scopeId":"${scopeId}","musicalSummary":"ok"}`
          }
        },
        { type: "response.done", response: { id: "resp3" } }
      ]);
      return new Response(streamFromString(sse), { status: 200, headers: { "content-type": "text/event-stream" } });
    };

    let draftUpdates = 0;
    let lastNotePitch: number | null = null;

    const proposal = await runComposerAgent({
      userPrompt: "add one note",
      scope: { trackIndex: 0, tickStart: 0, tickEnd: 1920 },
      liveState: mkState(),
      fetchFn: fakeFetch as any,
      proxyUrl: "http://127.0.0.1:8787/api/openai/responses",
      scopeIdOverride: scopeId,
      stream: true,
      onDraftUpdate: ({ draftState }) => {
        draftUpdates += 1;
        const track = draftState.tracks[0];
        lastNotePitch = track?.notes?.[0]?.pitch ?? null;
      }
    });

    expect(draftUpdates).toBeGreaterThan(0);
    expect(lastNotePitch).toBe(60);
    expect(proposal.ops.length).toBe(1);
    expect(proposal.draftState.tracks[0]!.notes.length).toBe(1);
    expect(proposal.draftState.tracks[0]!.notes[0]!.pitch).toBe(60);
    expect(proposal.musicalSummary).toBe("ok");
  });
});

