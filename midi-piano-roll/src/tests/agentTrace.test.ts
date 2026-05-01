import { describe, expect, it } from "vitest";

import { COMPOSITION_PROCESS_LABEL, parseThinkingText, readableToolLabel, thinkingPanelRenderKey, toolActionText } from "../ui/agentTrace";
import type { AgentTimelineEvent } from "../app/store";

describe("agent trace labels", () => {
  it("maps internal composer tool names to natural visible labels", () => {
    expect(readableToolLabel("place_note")).toBe("Add notes");
    expect(readableToolLabel("review_notes")).toBe("Review notes");
    expect(readableToolLabel("finalize_composition_run")).toBe("Finish composition");
  });

  it("keeps internal snake_case names out of action text", () => {
    const text = toolActionText("place_note", "started");

    expect(text).toContain("Add notes");
    expect(text).not.toContain("place_note");
  });

  it("humanizes unknown tool names instead of rendering raw identifiers", () => {
    expect(readableToolLabel("shape_phrase_curve")).toBe("Shape Phrase Curve");
  });

  it("uses the stronger visible label for the thinking summary surface", () => {
    expect(COMPOSITION_PROCESS_LABEL).toBe("Composition Process");
  });
});

describe("thinking text parsing", () => {
  it("extracts a leading bold thinking headline", () => {
    expect(parseThinkingText("**Defining musical forms**\n\nI am shaping the row.")).toEqual({
      headline: "Defining musical forms",
      body: "I am shaping the row."
    });
  });

  it("leaves plain thinking text as body copy", () => {
    expect(parseThinkingText("I am shaping the row.")).toEqual({
      headline: null,
      body: "I am shaping the row."
    });
  });

  it("does not promote later bold text into a headline", () => {
    expect(parseThinkingText("I am **noticing contrast** in the middle.")).toEqual({
      headline: null,
      body: "I am **noticing contrast** in the middle."
    });
  });
});

describe("thinking panel render key", () => {
  it("stays stable when the visible thinking text has not changed", () => {
    const first: AgentTimelineEvent[] = [{ type: "thinking", text: "**Shaping the phrase**\n\nMoving upward.", at: 1 }];
    const repeated: AgentTimelineEvent[] = [
      ...first,
      { type: "status", message: "Tool churn that is not shown in the panel.", at: 2 }
    ];

    expect(thinkingPanelRenderKey(repeated)).toBe(thinkingPanelRenderKey(first));
  });

  it("stays stable when unrelated visible tool activity changes", () => {
    const first: AgentTimelineEvent[] = [{ type: "thinking", text: "**Shaping the phrase**\n\nMoving upward.", at: 1 }];
    const repeated: AgentTimelineEvent[] = [
      ...first,
      { type: "tool_call_started", name: "place_note", argsPreview: "", at: 2 },
      { type: "tool_call_done", name: "place_note", argsPreview: "{\"pitch\":60}", at: 3 },
      { type: "tool_applied", name: "place_note", ok: true, at: 4 }
    ];

    expect(thinkingPanelRenderKey(repeated)).toBe(thinkingPanelRenderKey(first));
  });

  it("changes when the visible thinking text changes", () => {
    const first: AgentTimelineEvent[] = [{ type: "thinking", text: "**Shaping the phrase**\n\nMoving upward.", at: 1 }];
    const changed: AgentTimelineEvent[] = [
      ...first,
      { type: "thinking", text: "**Resolving the cadence**\n\nLanding lower.", at: 2 }
    ];

    expect(thinkingPanelRenderKey(changed)).not.toBe(thinkingPanelRenderKey(first));
  });
});
