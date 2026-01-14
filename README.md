# OneSub Subtitle Workflow

Generate stylised subtitles from `.m4a` / `.mp3` audio and burn them into `.mov` / `.mp4` videos in a configurable two-step pipeline. The guide below walks through setup, running the tools, and tuning the styling options with concrete examples.

## Requirements

- Python 3.9 or newer
- `ffmpeg` available on your `PATH`
- Optional but recommended: GPU + CUDA for faster Whisper inference

## Set Up the Environment

```bash
./scripts/bootstrap_python_env.sh
source .venv/bin/activate
```

The bootstrapper creates `.venv`, upgrades `pip`, and performs `pip install -e .`. The `start_onesub.command` launcher runs it automatically, so the Go backend and Python helpers always share the same dependency set. Prefer a fully manual setup? Use the traditional sequence instead:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .
```

The editable install exposes two commands: `onesub-prepare` (slow, runs Whisper once) and `onesub-render` (fast, consumes cached JSON output to render videos).

## Workflow Overview

1. **Step 1: Prepare data** – run Whisper, capture the transcript with per-word timestamps, and analyse loudness.
2. **Step 2: Render video** – feed the cached JSON data plus a styling configuration into `ffmpeg` to burn captions onto the video.

Re-running step 2 is cheap; repeat it whenever you tweak the styling without redoing the transcription.

## Step 1 – Prepare Captions and Loudness Data

```bash
onesub-prepare "sample audio.m4a" -o data/prepared --model base
# or point at a video file; audio is extracted automatically
onesub-prepare "sample recording.mov" -o data/prepared --model base
```

Files produced inside `data/prepared`:
- `captions.json` – transcript grouped by Whisper segments with nested word metadata.
- `audio_analysis.json` – RMS and peak values for every word.
- `word_timings.json` – flattened per-word view (useful for custom grouping).

Key options for `onesub-prepare`:
- `audio` (positional): path to the input `.m4a`/`.mp3` audio file or `.mp4`/`.mov` video (audio is extracted on the fly).
- `-o / --output-dir`: where to store the JSON output (defaults to `data/prepared`).
- `--model`: Whisper checkpoint (`tiny`, `base`, `small`, `medium`, `large`; default `base`).
- `--language`: optional language override instead of Whisper auto-detect.
- `--device`: PyTorch device hint (`cuda`, `cpu`, etc.).

## Step 2 – Render Subtitles Onto a Video

```bash
onesub-render "sample recording.mov" \
  --captions data/prepared/captions.json \
  --analysis data/prepared/audio_analysis.json \
  --config config/example_fonts.json \
  --output data/rendered/output.mp4
```

This command generates an `.ass` subtitle script beside the output video and uses `ffmpeg` to burn the styled captions in place.

Options for `onesub-render`:
- `video` (positional): input `.mov` or `.mp4`.
- `--captions`: path to `captions.json` (required).
- `--analysis`: path to `audio_analysis.json` (required).
- `--config`: JSON or YAML styling configuration (required).
- `-o / --output`: target video path (default `data/rendered/output.mp4`).
- `--ffmpeg`: alternate ffmpeg binary if it is not named `ffmpeg`.

## Styling Configuration Reference

Each render configuration controls fonts, sizing, outlines, and how words are grouped. See `config/example_fonts.json` for a complete sample.

- `default_font`: fallback font for captions.
- `size_mapping.min` / `size_mapping.max`: minimum/maximum font size used after loudness normalisation.
- `font_bands`: optional overrides that map size ranges to specific fonts.
- `outline`, `shadow`, `line_spacing`: additional ASS style tweaks.
- `alignment`: optional ASS alignment value (1–9) when you want captions anchored somewhere other than the default top-left.
- `placements_path`: optional path to a JSON file describing time-based positions for the captions (details below). If omitted, subtitles default to the video centre.
- `display`: governs how words are grouped on screen (details below), including whether words appear together or progressively via `reveal_mode`, and how many words appear on each line via `line_word_limits`. By default captions are rendered top-left with an 80px margin so multi-line reveals stay anchored; set `alignment` (1–9 in ASS terms) to move them. Word loudness is normalised per caption window so relative emphasis is preserved even when the grouping window changes.

You can store the configuration as JSON or YAML; when `display.mode` references `windows_path`, relative paths resolve from the configuration file’s directory.

## Caption Grouping Modes

The renderer always works off the per-word timings recorded in `word_timings.json`. Set `display.mode` to choose a grouping strategy:

- `"segment"` (default): Whisper segments become caption blocks.
- `"fixed_count"`: batches of `display.words_per_caption` words share a caption.
- `"fixed_interval"`: start a new caption every `display.interval_seconds` seconds.
- `"rolling"`: update the caption on every word while showing the latest `display.rolling_window` words.
- `"manual_windows"`: define explicit `{ "start": ..., "end": ... }` windows inline or via `display.windows_path`; words that fall into each window appear together.
- `display.reveal_mode`: set to `"block"` (default) to show all words in the window immediately, or `"per_word"` to add each word as it is spoken while keeping earlier words visible until the window ends.
- `display.line_word_limits`: optional list describing the target words per line (e.g. `[2, 3]`). The renderer treats these as recommendations and will spill to a new line early whenever a word's size would exceed the largest word already on that line, preventing late reflow.

### Display Mode Snippets

`segment` (default):
```json
"display": {
  "mode": "segment"
}
```

`fixed_count` (six words at a time, arranged as two lines of three):
```json
"display": {
  "mode": "fixed_count",
  "words_per_caption": 6,
  "line_word_limits": [3, 3],
  "reveal_mode": "block"
}
```

`fixed_interval` (new caption every three seconds):
```json
"display": {
  "mode": "fixed_interval",
  "interval_seconds": 3.0
}
```

`rolling` (show the last eight words as they are spoken):
```json
"display": {
  "mode": "rolling",
  "rolling_window": 8,
  "line_word_limits": [2, 3, 3],
  "reveal_mode": "per_word"
}
```

`manual_windows` (load ranges from `config/example_windows.json`):
```json
"display": {
  "mode": "manual_windows",
  "windows_path": "config/example_windows.json"
}
```

Inline window definitions work as well:
```json
"display": {
  "mode": "manual_windows",
  "line_word_limits": [2, 3],
  "reveal_mode": "per_word",
  "windows": [
    { "start": 0.0, "end": 3.0 },
    { "start": 3.5, "end": 7.0 }
  ]
}
```

## End-to-End Example

1. Prepare audio (once):
   ```bash
   onesub-prepare "sample audio.m4a" -o data/prepared --model base
   ```
2. Copy `config/example_fonts.json` and tune it, for example:
   ```json
   {
     "default_font": "Arial",
     "size_mapping": { "min": 28, "max": 64 },
     "font_bands": [
       { "min_size": 28, "max_size": 40, "font": "Helvetica" },
       { "min_size": 41, "max_size": 64, "font": "Impact" }
     ],
    "outline": 3,
    "shadow": 1,
    "line_spacing": 4,
    "alignment": 7,
    "placements_path": "config/my_placements.json",
    "display": {
       "mode": "fixed_count",
       "words_per_caption": 5,
       "line_word_limits": [2, 3],
       "reveal_mode": "per_word"
     }
   }
   ```
   Save the file as `config/my_styling.json`, create a matching placements file (e.g. copy `config/example_placements.json` to `config/my_placements.json`), then reference the styling in the render command with `--config config/my_styling.json`.
3. Render the video:
   ```bash
   onesub-render "sample recording.mov" \
     --captions data/prepared/captions.json \
     --analysis data/prepared/audio_analysis.json \
     --config config/my_styling.json \
     --output data/rendered/subtitled.mp4
   ```
4. Re-run step 3 with different `display` modes or font settings until you like the result. The `.ass` file next to the output video can also be edited manually if needed.

## Custom Time Windows

Create a file such as `config/custom_windows.json`:
```json
{
  "windows": [
    { "start": 0.0, "end": 2.5 },
    { "start": 2.5, "end": 5.0 },
    { "start": 5.0, "end": 9.0 }
  ]
}
```

Point your render configuration at it:
```json
"display": {
  "mode": "manual_windows",
  "windows_path": "config/custom_windows.json"
}
```

Now rerun `onesub-render` to see the captions grouped exactly by those ranges.

## Custom Placements

Place each caption at specific screen coordinates by creating a placements file referenced via `placements_path`:

```json
{
  "placements": [
    { "end": 5.0, "width": 0.5, "height": 0.35 },
    { "end": 10.0, "width": 0.7, "height": 0.2 },
    { "end": 9999.0, "width": 0.5, "height": 0.8 }
  ]
}
```


## Testing the Render Stage

Transcription can take time, so the rendering code is modular for isolated testing. You can import `onesub.rendering.build_ass_script` in a Python REPL, feed it the JSON payloads, and inspect the generated ASS text without running `ffmpeg`.

## Web Studio Preview

An experimental Next.js workspace lives in `src/onesub-app` for interactive editing.

```bash
cd src/onesub-app
pnpm install   # or npm install / yarn
pnpm dev
```

Features include video upload, timeline editing, styling controls, and live overlay previews. Export the resulting JSON to feed the CLI workflow when ready.

Set the backend endpoint via `NEXT_PUBLIC_ONESUB_API` (defaults to `http://localhost:8080`). The Go service in `src/onesub-app/backend` exposes `/api/upload`, `/api/render`, and `/api/media` for the UI; run it with `go run main.go` after building the CLI binaries so it can execute `onesub-prepare` / `onesub-render`. Back-end configuration is loaded from environment variables (optionally via a `.env` file or `ONESUB_ENV_FILE`) so you can point to a venv (`ONESUB_PYTHON_VENV`), add the repo to the Python path (`ONESUB_PYTHONPATH`, defaulting to `<ONESUB_CLI_WORKDIR>/src`), and set the project root (`ONESUB_CLI_WORKDIR`). If `ONESUB_PYTHON_VENV` is provided, the backend will refuse to fall back to the system Python, helping you catch misconfigured virtualenvs early.

Click any caption in the timeline to move the playhead and open colour pickers for that window. You can assign per-caption font colours and shadow colours; the preview updates live, and the renderer applies those overrides automatically.

## Project Layout

- `src/onesub/transcription.py`: Whisper integration and transcript parsing.
- `src/onesub/audio_analysis.py`: per-word RMS and peak extraction.
- `src/onesub/rendering.py`: caption grouping, ASS generation, and ffmpeg bridge.
- `src/onesub/tasks/prepare.py` / `render.py`: CLI entry points.
- `config/`: example styling, window, and placement configuration files.
- `src/onesub-app`: Next.js web studio for uploading media, editing timelines, adjusting styling, and previewing placements before rendering.
