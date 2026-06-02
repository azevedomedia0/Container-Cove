# IINA Trim Plugin — Design Spec
**Date:** 2026-06-02

## Overview

A standalone IINA plugin that lets users trim video files without leaving the player. The user marks in/out points via a draggable overlay panel, then exports the clip to a new file using ffmpeg's keyframe-accurate copy mode (no re-encoding).

---

## User Flow

1. User opens a video in IINA.
2. User triggers trim mode via **File > Trim Video…** or **⌘⇧T**.
3. Video pauses. A trim panel slides up from the bottom of the video.
4. User drags the left handle (start) and right handle (end) on the timeline strip to set the clip range. Clicking anywhere on the strip seeks the video to that position.
5. Start/End timecodes and clip duration update live as handles move.
6. User clicks **Save** — a macOS save dialog opens for filename/location.
7. On confirmation, ffmpeg runs: `ffmpeg -ss <start> -to <end> -i <input> -c copy <output>`.
8. OSD confirms: `Saved: <filename>` (or shows an error).
9. Overlay closes. Video resumes from its paused position.
10. **Cancel** (or **Escape**) closes the overlay and resumes playback without saving.

---

## Overlay UI

**Layout:** A slim panel anchored to the bottom of the video window. Dark frosted background (`rgba(18,18,18,0.97)` + `backdrop-filter: blur`), separated from the video by a subtle top border.

**Timeline strip:**
- Full-width track bar in muted white.
- Selected range highlighted in IINA blue (`#0A84FF`).
- Two draggable handles (blue, `16×20px` with a grip line). Handles cannot cross; minimum range is 1 second.
- Clicking anywhere on the track seeks the video.

**Info row (below strip):**
- **Start** label (12px, uppercase) + timecode (14px monospace, blue)
- **Duration** label (12px) + value (14px monospace, white) — centered
- **End** label (12px, uppercase) + timecode (14px monospace, blue)

**Buttons (right side):**
- **Save** — blue (`#0A84FF`), disabled until range is valid (≥1 second)
- **Cancel** — muted ghost style

---

## Architecture

Single `index.js` file. No bundler or build step.

### IINA API modules used

| Module | Usage |
|---|---|
| `iina.menu` | Add "Trim Video…" to File menu with ⌘⇧T shortcut |
| `iina.mpv` | Read `time-pos` and `duration`; call `pause` / `resume` |
| `iina.overlay` | Render trim panel as HTML/CSS/JS WebView via `simpleMode()` |
| `iina.utils` | Shell out to `ffmpeg`; run `osascript` for save dialog |
| `iina.event` | Listen for `iina.window-loaded` before activating |
| `iina.core` | `osd()` for success/error messages |

### Communication flow

- Plugin → overlay: `overlay.setContent()` with serialized state (duration, current positions)
- Overlay → plugin: `overlay.postMessage({ type, payload })` for handle drag updates and button clicks

---

## ffmpeg Command

```bash
ffmpeg -ss <start_seconds> -to <end_seconds> -i "<input_path>" -c copy "<output_path>"
```

- `-c copy` — keyframe-accurate, no re-encoding, near-instant
- Actual cut lands on the nearest preceding keyframe (may be off by up to ~2s)
- Input file path retrieved via `mpv.getString('path')` at trim open time
- ffmpeg must be on `$PATH` (typically installed via Homebrew)

---

## Error Handling

| Condition | Behaviour |
|---|---|
| No video loaded | Menu item disabled |
| ffmpeg not on PATH | OSD: `ffmpeg not found — install via brew install ffmpeg` |
| ffmpeg exits non-zero | OSD: `Trim failed (exit <code>)` |
| Save dialog cancelled | Overlay stays open; no file written |
| Start ≥ End | Save button disabled |

---

## File Structure

```
iina-trim.iinaplugin/
├── Info.json          — plugin metadata and permissions
├── index.js           — all plugin logic
├── package.json       — dev dependency: iina-plugin-definition
└── jsconfig.json      — editor type hints
```

### Info.json permissions required

```json
"permissions": [
  "show-osd",
  "show-alert",
  "video-overlay",
  "file-system",
  "shell-execute"
]
```

---

## Out of Scope

- Re-encoding / format conversion
- Trim preview playback within the panel
- Multiple trim segments
- Windows / Linux support
