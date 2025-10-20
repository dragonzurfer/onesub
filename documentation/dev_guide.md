<a id="top"></a>

# OneSub Developer Guide

This document explains the architecture, modules, and key functions that power the OneSub toolchain. It is organised for quick navigation by new contributors and includes cross-references between sections.

## Table of Contents

1. [System Overview](#system-overview)
2. [Execution Flow](#execution-flow)
3. [Core Modules](#core-modules)
   - [Data Models (`src/onesub/models.py`)](#data-models)
   - [Transcription (`src/onesub/transcription.py`)](#transcription)
   - [Audio Analysis (`src/onesub/audio_analysis.py`)](#audio-analysis)
   - [Rendering (`src/onesub/rendering.py`)](#rendering)
   - [Configuration (`src/onesub/config.py`)](#configuration)
   - [Serialization (`src/onesub/serialization.py`)](#serialization)
4. [Task Entry Points](#task-entry-points)
   - [Preparation CLI (`src/onesub/tasks/prepare.py`)](#prepare-task)
   - [Rendering CLI (`src/onesub/tasks/render.py`)](#render-task)
5. [Supporting Assets](#supporting-assets)
6. [Extensibility Notes](#extensibility-notes)

---

## System Overview

OneSub implements a two-phase workflow:

1. **Preparation** (`onesub-prepare`)  
   - Ingests an audio track or video file.
   - Runs Whisper transcription with word-level timestamps.
   - Calculates per-word loudness metrics.
   - Persists transcription, audio analysis, and flattened word timing data as JSON.

2. **Rendering** (`onesub-render`)  
   - Loads cached JSON artifacts.
  - Builds an ASS subtitle script mapping loudness to font size and font-family bands.
  - Applies optional placement and grouping rules.
  - Invokes `ffmpeg` to burn captions into a video.

Every subsystem is implemented as a composable Python module, allowing reuse in tests or alternative front-ends.  
[Back to top](#top)

---

## Execution Flow

```
onesub-prepare (.mp3/.m4a/.mp4/.mov)
   ├── src/onesub/tasks/prepare.py::run()
   │    ├── optional ffmpeg audio extraction
   │    ├── src/onesub/transcription.py::transcribe_audio()
   │    ├── src/onesub/audio_analysis.py::analyze_word_dynamics()
   │    └── src/onesub/serialization.py::dump_json()
   └── Outputs: captions.json, audio_analysis.json, word_timings.json

onesub-render (.mov/.mp4)
   ├── src/onesub/tasks/render.py::run()
   │    ├── src/onesub/serialization.py::{load_transcript, load_audio_analysis}
   │    ├── src/onesub/config.py::RenderConfig.from_dict()
   │    ├── src/onesub/rendering.py::build_ass_script()
   │    └── src/onesub/rendering.py::render_with_ffmpeg()
   └── Outputs: output.ass, output.mp4
```

[Back to top](#top)

---

## Core Modules

### Data Models (`src/onesub/models.py`)

Defines immutable dataclasses describing transcripts and analysis results.

- `WordTiming`: index, text, start/end seconds, probability, `duration` property.
- `Segment`: grouping of words with aggregate start/end and raw text.
- `Transcript`: origin path, Whisper model metadata, list of `Segment`s. Provides `flatten_words()` helper.
- `WordDynamics`: RMS and peak metrics per word with `duration` property.
- `AudioAnalysis`: wraps dynamics plus sample rate and convenience min/max properties.

These dataclasses are the canonical schema shared by other modules.  
[Back to top](#top)

### Transcription (`src/onesub/transcription.py`)

Responsibilities:

- `_parse_segments(raw_segments)`: converts Whisper JSON arrays into `Segment`/`WordTiming` objects.
- `build_transcript(audio_path, model_name, language, raw_result)`: assembles a `Transcript`.
- `transcribe_audio(audio_path, model_name="base", language=None, device=None)`: lazy-imports Whisper, runs transcription with `word_timestamps=True`, and returns a `Transcript`.

Usage: called from the preparation task; can be reused directly in tests.  
[Back to top](#top)

### Audio Analysis (`src/onesub/audio_analysis.py`)

Responsibilities:

- `_compute_rms(signal)`, `_compute_peak(signal)`: helper math.
- `analyze_word_dynamics(audio_path, words)`: loads audio via SoundFile (or Whisper fallback), converts to mono, computes RMS/peak per word window using word start/end times. Returns `AudioAnalysis`.

Relies on numpy and soundfile; falls back to Whisper’s loader when soundfile cannot decode (e.g. `.m4a`).  
[Back to top](#top)

### Rendering (`src/onesub/rendering.py`)

This is the most complex module, assembling subtitles and invoking `ffmpeg`.

Key components:

- **Helpers**:
  - `_format_timestamp(seconds)`: ASS timestamp string.
  - `_escape_ass_text(text)`: escapes ASS control characters.
  - `_word_markup(...)`: maps loudness to font size and font family, returning inline ASS tags.
  - `_layout_words_by_size(words, word_infos, line_limits)`: greedy algorithm ensuring no word exceeds the largest size already on a line; respects recommended `line_word_limits`.
  - `_extract_size_from_markup(markup, config)`: pulls `\fs` size from markup for layout decisions.
  - `_load_placements(config, play_res)`: parses optional placement JSON to support time-based screen positions.
  - `_resolve_position(...)`, `_placement_for_time(...)`, `_apply_position(...)`: placement utilities.

- **Data Structures**:
  - `CaptionLine`, `DialogueEntry`, `Placement`, `WordRender`.

- **Main pipeline**:
  - `build_ass_script(transcript, analysis, config, play_res=(1920,1080))`: creates ASS header, builds dialogue lines using `_build_caption_lines` (supports segment/fixed-count/interval/rolling/manual modes) and `_build_dialogue_entries`.
  - `_build_dialogue_entries(...)`: constructs dialogue entries for block or per-word reveal modes.
  - `_dialogues_per_word(...)`: incremental reveal logic.
  - `_compute_line_markups(...)`: gathers markups and sizes per word.
  - `_group_*` functions: implement each grouping mode.
  - `write_ass_script(content, output_path)`: I/O helper.
  - `render_with_ffmpeg(input_video, ass_path, output_video, ffmpeg_binary="ffmpeg")`: runs subprocess with burn-in filter.

[Back to top](#top)

### Configuration (`src/onesub/config.py`)

Defines configuration dataclasses and loaders.

- `FontBand`: font override for a size range.
- `SizeMapping`: min/max font sizes with `clamp`.
- `ManualWindow`: explicit time window (used in manual grouping).
- `DisplayConfig`: display options including grouping mode, counts, intervals, rolling window size, manual windows, `reveal_mode`, `line_word_limits`.
- `RenderConfig`: top-level render options (size mapping, font bands, default font, outline/shadow, alignment, optional `placements_path`, `DisplayConfig`).
- `_load_windows_file`: helper to parse manual window JSON.

`RenderConfig.from_dict()` loads JSON/YAML payloads with path resolution for optional window/placement files.  
[Back to top](#top)

### Serialization (`src/onesub/serialization.py`)

Provides JSON (de)serialisation utilities:

- `transcript_to_dict`, `analysis_to_dict`: convert dataclasses to JSON-ready dicts (including aggregate stats for analysis).
- `dump_json(data, output_path)`: writes indented UTF-8 JSON.
- `load_transcript(path)`, `load_audio_analysis(path)`: rebuild dataclasses from JSON.
- `word_timings_to_dict(transcript)`: flattened word list for debugging/custom windows.

[Back to top](#top)

---

## Task Entry Points

### Preparation CLI (`src/onesub/tasks/prepare.py`)

Functions:

- `run(input_path, output_dir, model_name="base", language=None, device=None)`: orchestrates the whole preparation flow. Accepts audio (`.m4a/.mp3/.wav/.flac/.aac`) or video (`.mp4/.mov/.mkv`). If a video is provided, `_extract_audio_from_video` uses `ffmpeg` to create a temporary `.m4a`. After transcription and analysis, JSON artifacts are written and temporary files removed.
- `_prepare_audio_source(input_path)`: validates and routes to audio extraction when required.
- `_extract_audio_from_video(video_path)`: spawns `ffmpeg -vn -acodec aac` to dump audio, logging warnings if cleanup fails.
- `build_parser()`: exposes CLI arguments.
- `main(argv=None)`: CLI entry.

Artifacts generated: `captions.json`, `audio_analysis.json`, `word_timings.json`.  
[Back to top](#top)

### Rendering CLI (`src/onesub/tasks/render.py`)

Functions:

- `_load_config(path)`: loads styling configuration (JSON/YAML), returning `RenderConfig`.
- `run(video_path, captions_path, analysis_path, output_path, config_path, ffmpeg_binary="ffmpeg")`: loads JSON artifacts, resolves render config, builds ASS subtitle content, writes `.ass` next to the output video, and calls `render_with_ffmpeg`.
- `build_parser()` and `main(argv=None)`: CLI interface.

Outputs: rendered video at `--output` plus a sibling `.ass` file.  
[Back to top](#top)

---

## Supporting Assets

- `config/example_fonts.json`: Demonstrates styling options (font bands, size mapping, alignment, display mode, placements path).
- `config/example_windows.json`: Sample manual-window JSON.
- `config/example_placements.json`: Sample time-based placement file.
- `README.md`: end-user instructions; cross-reference with this developer guide when making changes to CLI behaviour.

[Back to top](#top)

---

## Extensibility Notes

- **Transcription**: To swap Whisper versions or backends, adjust `transcribe_audio`; ensure `_parse_segments` continues to produce `WordTiming`. For batch processing, wrap `run()` and share the Whisper model instance externally to avoid repeated loads.
- **Audio analysis**: Additional loudness metrics can be added by extending `WordDynamics` and updating `analysis_to_dict`.
- **Rendering**: New grouping modes can be added in `_build_caption_lines`; be sure to update DisplayConfig defaults and documentation. For custom styling tokens, extend `_word_markup` and maintain `_extract_size_from_markup`.
- **Placement rules**: `_load_placements` supports mixed percentage and pixel values; extend schema as needed (e.g. rotations) and update `RenderConfig` to parse new fields.
- **Testing**: Each module is importable; embed sample JSON fixtures under `tests/` to validate new features without running Whisper or ffmpeg during unit tests.

[Back to top](#top)
