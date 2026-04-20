import { describe, expect, it } from "vitest";

import { parseSse } from "../lib/openai/sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    }
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<any[]> {
  const out: any[] = [];
  for await (const ev of parseSse(body)) out.push(ev);
  return out;
}

describe("parseSse", () => {
  it("parses JSON events separated by blank lines", async () => {
    const sse =
      [
        'data: {"type":"a","x":1}',
        "",
        'data: {"type":"b","y":2}',
        "",
        "data: [DONE]",
        ""
      ].join("\n") + "\n";

    const events = await collect(streamFromChunks([sse.slice(0, 10), sse.slice(10)]));

    expect(events.length).toBe(3);
    expect(events[0]?.type).toBe("a");
    expect(events[1]?.type).toBe("b");
    expect(events[2]?.type).toBe("done");
  });

  it("uses the SSE event field as type if JSON lacks type", async () => {
    const sse = ["event: custom.event", 'data: {"ok":true}', "", ""].join("\n");
    const events = await collect(streamFromChunks([sse]));
    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe("custom.event");
    expect(events[0]?.ok).toBe(true);
  });
});

