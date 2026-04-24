import { describe, expect, it } from "vitest";

import { readableToolLabel, toolActionText } from "../ui/agentTrace";

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
});
