const TOOL_LABELS: Record<string, string> = {
  place_note: "Add notes",
  add_notes: "Add notes",
  review_notes: "Review notes",
  get_scope_summary: "Review notes",
  list_notes: "Review notes",
  find_notes: "Review notes",
  edit_note: "Revise notes",
  move_notes: "Revise notes",
  resize_notes: "Revise notes",
  set_velocity: "Revise notes",
  delete_notes: "Remove notes",
  clear_range: "Remove notes",
  quantize: "Tighten timing",
  humanize: "Humanize timing",
  add_chord_progression: "Write chord progression",
  arpeggiate: "Write arpeggio",
  drum_pattern_basic: "Write drum pattern",
  finalize_composition_run: "Finish composition",
  finalize_proposal: "Finish composition",
  composer_thought: "Composer thought"
};

export const readableToolLabel = (toolName: string): string => {
  const known = TOOL_LABELS[toolName];
  if (known) return known;
  return toolName
    .split("_")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
};

export const toolActionText = (
  toolName: string,
  phase: "started" | "prepared" | "applied" | "failed",
  detail?: string
): string => {
  const label = readableToolLabel(toolName);
  if (phase === "started") return `Starting: ${label}`;
  if (phase === "prepared") return `Ready: ${label}`;
  if (phase === "failed") return `Could not complete: ${label}${detail ? ` - ${detail}` : ""}`;
  return `${label}${detail ? ` - ${detail}` : ""}`;
};
