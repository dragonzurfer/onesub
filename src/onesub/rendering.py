from __future__ import annotations

import json
import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .config import DisplayConfig, ManualWindow, RenderConfig
from .models import AudioAnalysis, Segment, Transcript, WordDynamics, WordTiming

logger = logging.getLogger(__name__)

_FS_PATTERN = re.compile(r"\\fs(\d+)")


def _format_timestamp(seconds: float) -> str:
    centiseconds = max(0, int(round(seconds * 100)))
    cs = centiseconds % 100
    total_seconds = centiseconds // 100
    s = total_seconds % 60
    total_minutes = total_seconds // 60
    m = total_minutes % 60
    h = total_minutes // 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape_ass_text(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")


def _word_markup(word: WordTiming, dynamics: WordDynamics, config: RenderConfig, rms_min: float, rms_max: float) -> str:
    if rms_max <= rms_min:
        normalized = 0.5
    else:
        normalized = (dynamics.rms - rms_min) / (rms_max - rms_min)
    normalized = max(0.0, min(1.0, normalized))

    target_span = config.size_mapping.max_size - config.size_mapping.min_size
    size = config.size_mapping.clamp(config.size_mapping.min_size + normalized * target_span)
    font = config.choose_font(size)
    escaped_text = _escape_ass_text(word.text)
    return rf"{{\fn{font}\fs{int(round(size))}}}{escaped_text}"


@dataclass
class CaptionLine:
    start: float
    end: float
    words: List[WordTiming]


@dataclass
class DialogueEntry:
    start: float
    end: float
    text: str


@dataclass
class Placement:
    end: float
    x: int
    y: int


@dataclass(frozen=True)
class WordRender:
    markup: str
    size: float


def _format_caption_text(
    words: Iterable[WordTiming],
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
) -> str:
    lines = _layout_words_by_size(words, word_infos, line_limits)
    rendered_lines: List[str] = []
    for line_words in lines:
        tokens = [word_infos[word.index].markup for word in line_words if word_infos.get(word.index)]
        rendered_lines.append(" ".join(tokens))
    return r"\N".join(line for line in rendered_lines if line)


def _layout_words_by_size(
    words: Iterable[WordTiming],
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
) -> List[List[WordTiming]]:
    lines: List[List[WordTiming]] = []
    current_line: List[WordTiming] = []
    current_max: float = 0.0
    limit_index = 0
    current_limit = line_limits[limit_index] if limit_index < len(line_limits) else None

    for word in words:
        info = word_infos.get(word.index)
        size = info.size if info else 0.0

        exceeds_size = bool(current_line) and size > current_max
        exceeds_count = bool(current_line) and current_limit is not None and len(current_line) >= current_limit

        if not current_line or (not exceeds_size and not exceeds_count):
            current_line.append(word)
            if size > current_max:
                current_max = size
            continue

        lines.append(current_line)
        if limit_index + 1 < len(line_limits):
            limit_index += 1
            current_limit = line_limits[limit_index]
        else:
            current_limit = None
        current_line = [word]
        current_max = size

    if current_line:
        lines.append(current_line)
    return lines


def build_ass_script(
    transcript: Transcript,
    analysis: AudioAnalysis,
    config: RenderConfig,
    play_res: Tuple[int, int] = (1920, 1080),
) -> str:
    dynamics_map: Dict[int, WordDynamics] = {item.word_index: item for item in analysis.words}
    global_min = analysis.rms_min
    global_max = analysis.rms_max

    width, height = play_res
    placements = _load_placements(config, play_res)
    header = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            "WrapStyle: 0",
            "Collisions: Normal",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "Timer: 100.0000",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
            "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
            "Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,{config.default_font},{int(config.size_mapping.min_size)},&H00FFFFFF,&H000000FF,"
            f"&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,{config.outline},{config.shadow},{config.alignment},80,80,80,1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )

    lines = [header]

    caption_lines = _build_caption_lines(transcript, config.display)
    dialogue_entries = _build_dialogue_entries(
        caption_lines,
        dynamics_map,
        config,
        global_min,
        global_max,
        placements,
    )

    for entry in dialogue_entries:
        start_ts = _format_timestamp(entry.start)
        end_ts = _format_timestamp(entry.end)
        line = f"Dialogue: 0,{start_ts},{end_ts},Default,,0,0,0,,{entry.text}"
        lines.append(line)

    return "\n".join(lines) + "\n"


def write_ass_script(content: str, output_path: Path) -> Path:
    output_path = output_path.expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    logger.info("Generated subtitle script: %s", output_path)
    return output_path


def _ffmpeg_filter_path(path: Path) -> str:
    return str(path).replace("\\", r"\\").replace(":", r"\:").replace(" ", r"\ ")


def render_with_ffmpeg(
    input_video: Path,
    ass_path: Path,
    output_video: Path,
    ffmpeg_binary: str = "ffmpeg",
) -> Path:
    input_video = input_video.expanduser().resolve()
    output_video = output_video.expanduser().resolve()
    output_video.parent.mkdir(parents=True, exist_ok=True)
    command = [
        ffmpeg_binary,
        "-y",
        "-i",
        str(input_video),
        "-vf",
        f"ass={_ffmpeg_filter_path(ass_path)}",
        "-c:a",
        "copy",
        str(output_video),
    ]
    logger.info("Running ffmpeg to render subtitles...")
    subprocess.run(command, check=True)
    logger.info("Video written to %s", output_video)
    return output_video


def _build_caption_lines(transcript: Transcript, display: DisplayConfig) -> List[CaptionLine]:
    words = transcript.flatten_words()
    if display.mode == "fixed_count":
        return _group_fixed_count(words, display.words_per_caption)
    if display.mode == "fixed_interval":
        return _group_fixed_interval(words, display.interval_seconds)
    if display.mode == "rolling":
        return _group_rolling(words, display.rolling_window)
    if display.mode == "manual_windows" and display.windows:
        return _group_manual_windows(words, display.windows)
    return _group_by_segment(transcript)


def _group_by_segment(transcript: Transcript) -> List[CaptionLine]:
    lines: List[CaptionLine] = []
    for segment in transcript.segments:
        if not segment.words:
            continue
        lines.append(CaptionLine(start=segment.start, end=segment.end, words=list(segment.words)))
    return lines


def _group_fixed_count(words: List[WordTiming], batch_size: int) -> List[CaptionLine]:
    if batch_size <= 0:
        batch_size = 6
    lines: List[CaptionLine] = []
    for idx in range(0, len(words), batch_size):
        chunk = words[idx : idx + batch_size]
        if not chunk:
            continue
        lines.append(CaptionLine(start=chunk[0].start, end=chunk[-1].end, words=list(chunk)))
    return lines


def _group_fixed_interval(words: List[WordTiming], interval: float) -> List[CaptionLine]:
    if not words:
        return []
    interval = max(interval, 0.1)
    lines: List[CaptionLine] = []
    window_start = words[0].start
    window_end = window_start + interval
    chunk: List[WordTiming] = []

    for word in words:
        if word.start < window_end:
            chunk.append(word)
        else:
            if chunk:
                lines.append(CaptionLine(start=chunk[0].start, end=chunk[-1].end, words=list(chunk)))
            chunk = [word]
            window_start = word.start
            window_end = window_start + interval
    if chunk:
        lines.append(CaptionLine(start=chunk[0].start, end=chunk[-1].end, words=list(chunk)))
    return lines


def _group_rolling(words: List[WordTiming], window_size: int) -> List[CaptionLine]:
    if not words:
        return []
    window_size = max(window_size, 1)
    lines: List[CaptionLine] = []
    total = len(words)
    for idx, word in enumerate(words):
        start_index = max(0, idx - window_size + 1)
        chunk = words[start_index : idx + 1]
        start_time = word.start
        if idx + 1 < total:
            end_time = max(start_time, words[idx + 1].start)
        else:
            end_time = word.end
        lines.append(CaptionLine(start=start_time, end=end_time, words=list(chunk)))
    return lines


def _group_manual_windows(words: List[WordTiming], windows: Iterable[ManualWindow]) -> List[CaptionLine]:
    lines: List[CaptionLine] = []
    word_iter = iter(words)
    current_word = next(word_iter, None)
    for window in windows:
        chunk: List[WordTiming] = []
        while current_word and current_word.end <= window.start:
            current_word = next(word_iter, None)
        while current_word and current_word.start < window.end:
            chunk.append(current_word)
            current_word = next(word_iter, None)
        if chunk:
            start = min(chunk[0].start, window.start)
            end = max(chunk[-1].end, window.end)
            lines.append(CaptionLine(start=start, end=end, words=list(chunk)))
    return lines


def _build_dialogue_entries(
    caption_lines: List[CaptionLine],
    dynamics_map: Dict[int, WordDynamics],
    config: RenderConfig,
    global_min: float,
    global_max: float,
    placements: List[Placement],
) -> List[DialogueEntry]:
    entries: List[DialogueEntry] = []
    reveal_mode = config.display.reveal_mode
    line_limits = config.display.line_word_limits

    for line_data in caption_lines:
        word_infos = _compute_line_markups(
            line_data,
            dynamics_map,
            config,
            global_min,
            global_max,
        )
        if reveal_mode == "per_word":
            entries.extend(_dialogues_per_word(line_data, word_infos, line_limits, placements))
        else:
            text = _format_caption_text(line_data.words, word_infos, line_limits)
            if not text:
                continue
            start = line_data.start
            end = max(line_data.end, start + 0.01)
            placement = _placement_for_time(placements, start)
            positioned = _apply_position(text, placement)
            entries.append(DialogueEntry(start=start, end=end, text=positioned))
    return entries


def _dialogues_per_word(
    line_data: CaptionLine,
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
    placements: List[Placement],
) -> List[DialogueEntry]:
    words = line_data.words
    if not words:
        return []

    entries: List[DialogueEntry] = []
    total = len(words)

    cumulative: List[WordTiming] = []
    for idx, word in enumerate(words):
        cumulative.append(word)
        text = _format_caption_text(cumulative, word_infos, line_limits)
        if not text:
            continue
        start = max(line_data.start, word.start)
        if idx + 1 < total:
            next_start = words[idx + 1].start
            boundary = max(next_start, word.end)
            end_candidate = min(line_data.end, boundary)
        else:
            boundary = max(line_data.end, word.end)
            end_candidate = boundary
        end = max(start + 0.01, end_candidate)
        placement = _placement_for_time(placements, start)
        positioned = _apply_position(text, placement)
        entries.append(DialogueEntry(start=start, end=end, text=positioned))

    return entries


def _compute_line_markups(
    line_data: CaptionLine,
    dynamics_map: Dict[int, WordDynamics],
    config: RenderConfig,
    global_min: float,
    global_max: float,
) -> Dict[int, WordRender]:
    values: List[float] = []
    for word in line_data.words:
        dynamics = dynamics_map.get(word.index)
        if dynamics:
            values.append(dynamics.rms)

    local_min = min(values) if values else global_min
    local_max = max(values) if values else global_max

    use_local = local_max > local_min
    word_infos: Dict[int, WordRender] = {}

    for word in line_data.words:
        dynamics = dynamics_map.get(word.index)
        if dynamics:
            if use_local:
                markup = _word_markup(word, dynamics, config, rms_min=local_min, rms_max=local_max)
            else:
                markup = _word_markup(word, dynamics, config, rms_min=global_min, rms_max=global_max)
            size = _extract_size_from_markup(markup, config)
            word_infos[word.index] = WordRender(markup=markup, size=size)
        else:
            markup = _fallback_markup(word, config)
            size = _extract_size_from_markup(markup, config)
            word_infos[word.index] = WordRender(markup=markup, size=size)

    return word_infos


def _fallback_markup(word: WordTiming, config: RenderConfig) -> str:
    escaped_text = _escape_ass_text(word.text)
    size = int(round(config.size_mapping.min_size))
    return rf"{{\fn{config.default_font}\fs{size}}}{escaped_text}"


def _extract_size_from_markup(markup: str, config: RenderConfig) -> float:
    match = _FS_PATTERN.search(markup)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return float(config.size_mapping.min_size)


def _load_placements(config: RenderConfig, play_res: Tuple[int, int]) -> List[Placement]:
    width, height = play_res
    default = [Placement(end=float("inf"), x=width // 2, y=height // 2)]

    if not config.placements_path:
        return default

    path = config.placements_path
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("Placements file not found: %s", path)
        return default
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse placements file %s: %s", path, exc)
        return default

    entries = payload.get("placements") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        logger.warning("Placements file %s must contain a list under 'placements'", path)
        return default

    placements: List[Placement] = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        end_raw = item.get("end")
        try:
            end_value = float(end_raw)
        except (TypeError, ValueError):
            continue
        x_value = _resolve_position(item.get("width"), width)
        if x_value is None:
            x_value = _resolve_position(item.get("x"), width)
        if x_value is None:
            x_value = _resolve_position(item.get("x_px"), width, allow_unit=False)
        if x_value is None:
            x_value = width // 2

        y_value = _resolve_position(item.get("height"), height)
        if y_value is None:
            y_value = _resolve_position(item.get("y"), height)
        if y_value is None:
            y_value = _resolve_position(item.get("y_px"), height, allow_unit=False)
        if y_value is None:
            y_value = height // 2

        placements.append(Placement(end=end_value, x=x_value, y=y_value))

    placements.sort(key=lambda p: p.end)
    if not placements or placements[-1].end != float("inf"):
        placements.append(Placement(end=float("inf"), x=width // 2, y=height // 2))
    return placements


def _resolve_position(value: Optional[object], dimension: int, allow_unit: bool = True) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.endswith("%"):
            try:
                percent = float(stripped[:-1]) / 100.0
            except ValueError:
                return None
            percent = min(max(percent, 0.0), 1.0)
            return int(round(percent * dimension))
        if allow_unit:
            try:
                numeric = float(stripped)
            except ValueError:
                return None
        else:
            try:
                numeric = int(stripped)
            except ValueError:
                return None
    elif isinstance(value, (int, float)):
        numeric = float(value)
    else:
        return None

    if allow_unit and 0.0 <= numeric <= 1.0:
        numeric *= dimension
    numeric = max(0.0, min(numeric, float(dimension)))
    return int(round(numeric))


def _placement_for_time(placements: List[Placement], time_point: float) -> Placement:
    for placement in placements:
        if time_point <= placement.end:
            return placement
    return placements[-1]


def _apply_position(text: str, placement: Placement) -> str:
    if not text:
        return text
    return rf"{{\pos({placement.x},{placement.y})}}{text}"
