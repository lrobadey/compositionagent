import type { AgentTimelineEvent } from "../app/store";

export type ComposerCockpitRenderers = {
  renderThinkingPanel: (events: AgentTimelineEvent[]) => void;
  renderActionTimeline: (events: AgentTimelineEvent[]) => void;
};

export type ComposerCockpit = {
  append: (event: AgentTimelineEvent) => void;
  flushFinalView: () => void;
  getEvents: () => AgentTimelineEvent[];
  reset: () => void;
};

export const createComposerCockpit = (renderers: ComposerCockpitRenderers): ComposerCockpit => {
  let events: AgentTimelineEvent[] = [];

  const append = (event: AgentTimelineEvent): void => {
    events = [...events, event];

    // Keep the cockpit quiet during tool churn; only live-repaint the summary panel.
    if (event.type === "thinking") {
      renderers.renderThinkingPanel(events);
    }
  };

  const flushFinalView = (): void => {
    renderers.renderThinkingPanel(events);
    renderers.renderActionTimeline(events);
  };

  const getEvents = (): AgentTimelineEvent[] => events.slice();

  const reset = (): void => {
    events = [];
  };

  return { append, flushFinalView, getEvents, reset };
};
