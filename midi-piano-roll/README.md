# MIDI Piano Roll + Agentic Composer

Browser-based, FL-style piano roll viewer/editor for `.mid/.midi` files with an optional agentic “composer” workflow:

- The AI never writes MIDI bytes.
- The AI can only modify notes via strict composer tools.
- Successful composer runs write directly into the live MIDI, with **Undo** as the safety valve.
- If an automatic write cannot be committed, the app falls back to a pending review state with **Apply** or **Reject**.

## Setup

This project depends on npm packages (Vite, Vitest, `@tonejs/midi`). If your environment blocks network access, install deps once you have connectivity:

```bash
cd midi-piano-roll
npm install
```

## Run

### Viewer only

```bash
npm run dev
```

Open the printed local URL, then upload a MIDI file.

### Viewer + Composer (AI)

The dev server exposes a server-side route at `/api/openai/responses` so your `OPENAI_API_KEY` stays off the client.

Single terminal:

```bash
cd midi-piano-roll
export OPENAI_API_KEY="..."
npm run dev
```

In the UI: load a MIDI or start a blank project, choose the track/range, write a prompt in **Composer**, then click **Compose**. The live activity log shows each tool call while the music is being written. Use **Undo** to reverse the last committed run.

If you prefer running a standalone proxy on a separate port, see `midi-piano-roll/agent-proxy/README.md`.

## Controls

- **Wheel**: vertical scroll (pitch)
- **Shift + wheel**: horizontal scroll (time)
- **Ctrl/Cmd + wheel**: horizontal zoom
- **Alt + wheel**: vertical zoom
- **Middle-drag** or **Space + drag**: pan
- **Click**: select note
- **Shift + click**: toggle selection
- **Drag empty space**: marquee selection (Shift to add)
- **Ruler drag**: scrub playhead
- **Space**: play/stop (visual transport)
- **Home/End**: jump playhead

## Export

Use the **Export MIDI** button to download the current live state as `export.mid`.
