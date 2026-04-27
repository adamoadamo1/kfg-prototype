# Kitchens for Good — Interactive Video Prototype

Single-page interactive video. Viewer watches an intro, picks one of three setup
questions, optionally goes deeper, and lands on the apprentice closing story
that all three paths converge on.

## Quick start

1. Drop video files into `videos/`. Filenames must match `tree-config.json`:
   ```
   videos/00_intro.mov              # Emma's intro
   videos/01_q1_origin.mov          # Q1 setup — COVID + grandfather
   videos/02_q1_deep.mov            # Q1 deep — family, cooking as a financial skill
   videos/03_q2_secret_sauce.mov    # Q2 setup — investment per person + donor experience
   videos/05_q3_setup.mov           # Q3 setup — current capacity, why we need to grow
   videos/04_close.mov              # shared close — flywheel + T's story
   ```
   If a file is missing at runtime, the app shows a placeholder card with the
   node ID and expected filename so you can continue past it.

2. Generate captions:
   ```
   pip install openai-whisper
   python scripts/transcribe.py
   ```

3. Run a local dev server:
   ```
   python -m http.server 8000
   ```

4. Open <http://localhost:8000> and click **Begin**.

## Editing the tree

All flow lives in `tree-config.json`. Each node is one of two shapes:

- `video` — plays a clip then advances to `next`
- `decision` — pauses on the last frame, shows a panel with `options`

To add a new path, add a node and point an existing `next` (or option) at it.
No code change needed.

## Transcripts

`scripts/transcribe.py` reads every supported video in `videos/` and writes a
matching `.vtt` to `transcripts/`.

```
python scripts/transcribe.py             # transcribe new videos only
python scripts/transcribe.py --force     # re-transcribe everything
python scripts/transcribe.py --model small   # smaller / faster
```

Supported source formats: `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`.

The page hooks each VTT in via `<track kind="subtitles" default>`. Captions
default ON; the bottom-left **CC** toggle turns them on/off.

## Why a server (not file://)?

Browsers block `fetch()` and `<track>` loads from `file://` URLs.
`python -m http.server 8000` is the simplest workaround.

## Stack

Vanilla HTML / CSS / JS. No build step.

```
index.html         markup + asset links
style.css          layout and theme
app.js             state machine + decision UI + preloading
tree-config.json   flow definition
scripts/
  transcribe.py    whisper → VTT
videos/            (you drop these in)
transcripts/       (auto-generated)
```

## Keyboard

- **Tab** — cycle decision buttons
- **Enter / Space** — activate the focused button
- **Esc** — return to the most recent decision

## Out of scope (v1)

- Analytics, accounts, backend, multi-language
- Custom video player chrome (only CC toggle + pause)
- Animations beyond a 300ms fade between videos

## Notes on filename / extension mismatch

The default config uses `.mp4`. If your source files are `.mov` or another
container, either:

- transcode them to `.mp4` (most browser-friendly), or
- update the `video` field in `tree-config.json` to match the actual filenames.

`.mov` files with H.264 video usually play in Chrome/Safari, but `.mp4` is the
most reliable cross-browser bet.
