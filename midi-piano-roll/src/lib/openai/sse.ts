type SseFrame = {
  event?: string;
  data: string;
};

function parseFrame(rawFrame: string): SseFrame | null {
  const lines = rawFrame.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    // Ignore comments.
    if (line.startsWith(":")) continue;

    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    // SSE allows an optional leading space after ":".
    const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");

    if (field === "event") event = value;
    else if (field === "data") dataLines.push(value);
    // ignore: id, retry, and any unknown fields
  }

  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line.
    for (;;) {
      const sep = buf.search(/\r?\n\r?\n/);
      if (sep === -1) break;
      const frameRaw = buf.slice(0, sep);
      buf = buf.slice(sep).replace(/^\r?\n\r?\n/, "");
      const frame = parseFrame(frameRaw);
      if (frame) yield frame;
    }
  }

  // Flush decoder + any trailing frame.
  buf += decoder.decode();
  const tail = buf.trim();
  if (tail) {
    const frame = parseFrame(tail);
    if (frame) yield frame;
  }
}

/**
 * Parse an OpenAI Responses SSE stream (or similar) into event objects.
 *
 * - Supports both SSE "event:" field and JSON payload "type".
 * - If a frame has data "[DONE]", yields { type: "done" }.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  for await (const frame of readSseFrames(body)) {
    if (frame.data === "[DONE]") {
      yield { type: "done" };
      continue;
    }
    let obj: any;
    try {
      obj = JSON.parse(frame.data);
    } catch {
      yield { type: "error", error: "invalid_json", raw: frame.data };
      continue;
    }
    if (obj && typeof obj === "object" && typeof obj.type !== "string" && frame.event) {
      obj.type = frame.event;
    }
    yield obj;
  }
}

