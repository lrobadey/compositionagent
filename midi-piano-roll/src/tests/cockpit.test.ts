import { describe, expect, it, vi } from "vitest";

import { createComposerCockpit } from "../ui/cockpit";
import type { AgentTimelineEvent } from "../app/store";

const toolEvent = (type: Extract<AgentTimelineEvent["type"], "tool_call_started" | "tool_call_delta" | "tool_call_done" | "tool_applied">): AgentTimelineEvent => {
  if (type === "tool_applied") {
    return { type, name: "place_note", ok: true, at: 1 };
  }
  if (type === "tool_call_delta") {
    return { type, name: "place_note", argsPreview: '{"pitch":60', at: 1 };
  }
  return { type, name: "place_note", argsPreview: "", at: 1 };
};

describe("composer cockpit", () => {
  it("keeps tool chatter out of the live cockpit and refreshes summary on thinking", () => {
    const renderThinkingPanel = vi.fn();
    const renderActionTimeline = vi.fn();
    const cockpit = createComposerCockpit({ renderThinkingPanel, renderActionTimeline });

    cockpit.append(toolEvent("tool_call_started"));
    cockpit.append(toolEvent("tool_call_delta"));
    cockpit.append(toolEvent("tool_call_done"));
    cockpit.append(toolEvent("tool_applied"));

    expect(renderThinkingPanel).not.toHaveBeenCalled();
    expect(renderActionTimeline).not.toHaveBeenCalled();

    const thinkingEvent: AgentTimelineEvent = { type: "thinking", text: "thinking summary", at: 2 };
    cockpit.append(thinkingEvent);

    expect(renderThinkingPanel).toHaveBeenCalledTimes(1);
    expect(renderThinkingPanel).toHaveBeenCalledWith([
      toolEvent("tool_call_started"),
      toolEvent("tool_call_delta"),
      toolEvent("tool_call_done"),
      toolEvent("tool_applied"),
      thinkingEvent
    ]);
    expect(renderActionTimeline).not.toHaveBeenCalled();

    cockpit.flushFinalView();

    expect(renderThinkingPanel).toHaveBeenCalledTimes(2);
    expect(renderActionTimeline).toHaveBeenCalledTimes(1);
    expect(renderActionTimeline).toHaveBeenCalledWith([
      toolEvent("tool_call_started"),
      toolEvent("tool_call_delta"),
      toolEvent("tool_call_done"),
      toolEvent("tool_applied"),
      thinkingEvent
    ]);
  });
});
