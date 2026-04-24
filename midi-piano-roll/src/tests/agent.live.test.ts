import { describe, expect, test } from "vitest";

import type { ProjectState } from "../lib/compose/state";
import { runComposerAgent } from "../lib/agent/orchestrator";

const LIVE = process.env.LIVE_AGENT_TEST === "1";

describe.runIf(LIVE)("agent (live)", () => {
  test("can propose adding notes via the proxy + tools", async () => {
    const ppq = 480;
    const barTicks = ppq * 4; // 4/4

    const liveState: ProjectState = {
      ppq,
      tempos: [{ tick: 0, bpm: 120 }],
      timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
      tracks: [
        {
          trackIndex: 0,
          name: "Piano",
          channel: 0,
          notes: []
        }
      ],
      maxTick: barTicks * 8
    };

    const proposal = await runComposerAgent({
      userPrompt: [
        "Within the scope, compose a simple 1-bar C-major arpeggio starting at bar 1 beat 1.",
        "Use place_note in small 1-3 note batches, review_notes, and finalize_composition_run.",
        "Keep it sparse (no more than ~16 notes)."
      ].join("\n"),
      scope: { trackIndex: 0, tickStart: 0, tickEnd: barTicks },
      liveState,
      proxyUrl: process.env.AGENT_PROXY_URL ?? "http://127.0.0.1:8787/api/openai/responses",
      proxyOrigin: process.env.AGENT_PROXY_ORIGIN ?? "http://localhost:5173"
    });

    if (proposal.diffStats.added <= 0 || proposal.ops.length <= 0) {
      throw new Error(
        [
          "No changes were proposed.",
          `diffStats=${JSON.stringify(proposal.diffStats)}`,
          `ops=${proposal.ops.length}`,
          `musicalSummary=${proposal.musicalSummary ?? ""}`,
          `warnings=${JSON.stringify(proposal.warnings.slice(0, 10))}`
        ].join("\n")
      );
    }
  }, 120_000);
});
