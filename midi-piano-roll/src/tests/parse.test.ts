import { describe, expect, it } from "vitest";

import { parseMidi } from "../lib/midi/parse";

describe("parseMidi", () => {
  it("parses a minimal format-0 midi with one note", () => {
    // Header: MThd, len 6, format 0, ntrks 1, division 480 (0x01E0)
    // Track:
    //   delta 0: note on (ch0) 60 vel 64
    //   delta 480: note off 60 vel 64  (vlq 0x83 0x60)
    //   delta 0: end of track
    const bytes = new Uint8Array([
      0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
      0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x0d,
      0x00, 0x90, 0x3c, 0x40,
      0x83, 0x60, 0x80, 0x3c, 0x40,
      0x00, 0xff, 0x2f, 0x00
    ]);

    const project = parseMidi(bytes.buffer);
    expect(project.ppq).toBe(480);
    expect(project.tracks.length).toBe(1);

    const track = project.tracks[0]!;
    expect(track.notes.length).toBe(1);
    const n = track.notes[0]!;
    expect(n.pitch).toBe(60);
    expect(n.startTick).toBe(0);
    expect(n.durationTicks).toBe(480);
    expect(n.endTick).toBe(480);
  });
});

