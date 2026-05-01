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
  it("routes thinking, composer notes, and tool activity to separate live render paths", () => {
    const renderThinkingPanel = vi.fn();
    const renderActionTimeline = vi.fn();
    const cockpit = createComposerCockpit({ renderThinkingPanel, renderActionTimeline });

    const thinkingEvent: AgentTimelineEvent = { type: "thinking", text: "thinking summary", at: 1 };
    const composerThought: AgentTimelineEvent = { type: "tool_applied", name: "composer_thought", ok: true, outputText: "Use a gentler cadence.", at: 2 };
    const started = toolEvent("tool_call_started");
    const delta = toolEvent("tool_call_delta");
    const done = toolEvent("tool_call_done");
    const applied = toolEvent("tool_applied");

    cockpit.append(thinkingEvent);
    expect(renderThinkingPanel).toHaveBeenCalledTimes(1);
    expect(renderThinkingPanel).toHaveBeenLastCalledWith([thinkingEvent]);
    expect(renderActionTimeline).not.toHaveBeenCalled();

    cockpit.append(composerThought);
    expect(renderThinkingPanel).toHaveBeenCalledTimes(2);
    expect(renderThinkingPanel).toHaveBeenLastCalledWith([thinkingEvent, composerThought]);
    expect(renderActionTimeline).not.toHaveBeenCalled();

    cockpit.append(started);
    expect(renderThinkingPanel).toHaveBeenCalledTimes(2);
    expect(renderActionTimeline).toHaveBeenCalledTimes(1);
    expect(renderActionTimeline).toHaveBeenLastCalledWith([thinkingEvent, composerThought, started]);

    cockpit.append(delta);
    expect(renderThinkingPanel).toHaveBeenCalledTimes(2);
    expect(renderActionTimeline).toHaveBeenCalledTimes(1);

    cockpit.append(done);
    expect(renderThinkingPanel).toHaveBeenCalledTimes(2);
    expect(renderActionTimeline).toHaveBeenCalledTimes(2);
    expect(renderActionTimeline).toHaveBeenLastCalledWith([thinkingEvent, composerThought, started, delta, done]);

    cockpit.append(applied);
    expect(renderThinkingPanel).toHaveBeenCalledTimes(2);
    expect(renderActionTimeline).toHaveBeenCalledTimes(3);
    expect(renderActionTimeline).toHaveBeenLastCalledWith([thinkingEvent, composerThought, started, delta, done, applied]);

    cockpit.flushFinalView();

    expect(renderThinkingPanel).toHaveBeenCalledTimes(3);
    expect(renderThinkingPanel).toHaveBeenLastCalledWith([thinkingEvent, composerThought, started, delta, done, applied]);
    expect(renderActionTimeline).toHaveBeenCalledTimes(4);
    expect(renderActionTimeline).toHaveBeenLastCalledWith([thinkingEvent, composerThought, started, delta, done, applied]);
  });
});
