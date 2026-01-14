from __future__ import annotations

import json
import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from .config import DisplayConfig, ManualWindow, RenderConfig, SegmentStyle, SizeMapping, WriteOnKeyframe
from .models import AudioAnalysis, Segment, Transcript, WordDynamics, WordTiming

logger = logging.getLogger(__name__)

_FS_PATTERN = re.compile(r"\\fs(\d+)")


def _normalize_hex_color(value: str, fallback: str) -> str:
    candidate = value.strip() if value else ""
    if not candidate:
        candidate = fallback
    if not candidate.startswith("#"):
        candidate = f"#{candidate}"
    if len(candidate) != 7:
        return fallback.upper()
    hex_part = candidate[1:]
    if not all(ch in "0123456789ABCDEFabcdef" for ch in hex_part):
        return fallback.upper()
    return f"#{hex_part.upper()}"


def _hex_to_ass_bgr(color: str) -> str:
    normalized = _normalize_hex_color(color, "#FFFFFF")
    r = normalized[1:3]
    g = normalized[3:5]
    b = normalized[5:7]
    return f"&H{b}{g}{r}&"


def _hex_to_style_color(color: str) -> str:
    normalized = _normalize_hex_color(color, "#FFFFFF")
    r = normalized[1:3]
    g = normalized[3:5]
    b = normalized[5:7]
    return f"&H00{b}{g}{r}"


def _ass_primary_tag(color: str) -> str:
    return rf"\\c{_hex_to_ass_bgr(color)}"


def _ass_outline_tag(color: str) -> str:
    return rf"\\3c{_hex_to_ass_bgr(color)}"


def _ass_shadow_tag(color: str) -> str:
    return rf"\\4c{_hex_to_ass_bgr(color)}"

def _ass_font_style_flags(font_style: str) -> Tuple[int, int]:
    style = (font_style or "").strip().lower().replace("-", "_")
    bold = -1 if style in {"bold", "bold_italic"} else 0
    italic = -1 if style in {"italic", "bold_italic"} else 0
    return bold, italic

def _ass_font_style_tags(font_style: str) -> str:
    bold_flag, italic_flag = _ass_font_style_flags(font_style)
    bold_tag = 1 if bold_flag != 0 else 0
    italic_tag = 1 if italic_flag != 0 else 0
    return rf"\\b{bold_tag}\\i{italic_tag}"


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


def _word_markup(
    word: WordTiming,
    dynamics: WordDynamics,
    config: RenderConfig,
    size_mapping: SizeMapping,
    rms_min: float,
    rms_max: float,
    primary_tag: str,
    outline_tag: str,
    shadow_tag: str,
    style_tag: str,
    font_override: Optional[str] = None,
) -> str:
    if rms_max <= rms_min:
        normalized = 0.5
    else:
        normalized = (dynamics.rms - rms_min) / (rms_max - rms_min)
    normalized = max(0.0, min(1.0, normalized))

    target_span = size_mapping.max_size - size_mapping.min_size
    size = size_mapping.clamp(size_mapping.min_size + normalized * target_span)
    font = font_override or config.choose_font(size)
    escaped_text = _escape_ass_text(word.text)
    return rf"{{\fn{font}\fs{int(round(size))}{style_tag}{primary_tag}{outline_tag}{shadow_tag}}}{escaped_text}"


@dataclass
class CaptionLine:
    start: float
    end: float
    words: List[WordTiming]
    segment_id: Optional[int] = None


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
    segment_id: Optional[int] = None


@dataclass(frozen=True)
class WordRender:
    markup: str
    size: float


@dataclass(frozen=True)
class SegmentColor:
    start: float
    end: float
    color: str
    shadow: str


def _format_caption_text(
    words: Iterable[WordTiming],
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
    letter_spacing: float,
    word_spacing: float,
) -> str:
    rendered_lines, _ = _render_lines(words, word_infos, line_limits, letter_spacing, word_spacing)
    return r"\N".join(line for line in rendered_lines if line)


def _letter_spacing_tag(letter_spacing: float) -> str:
    if abs(letter_spacing) < 0.01:
        return ""
    return rf"{{\fsp{int(round(letter_spacing))}}}"


def _word_separator(letter_spacing: float, word_spacing: float) -> str:
    if word_spacing <= 0:
        return " "
    combined = letter_spacing + word_spacing
    prefix = rf"{{\fsp{int(round(combined))}}}\h"
    reset = ""
    if abs(combined - letter_spacing) > 0.01:
        reset = rf"{{\fsp{int(round(letter_spacing))}}}"
    return f"{prefix}{reset}"


def _render_lines(
    words: Iterable[WordTiming],
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
    letter_spacing: float,
    word_spacing: float,
) -> Tuple[List[str], List[float]]:
    lines = _layout_words_by_size(words, word_infos, line_limits)
    rendered_lines: List[str] = []
    line_heights: List[float] = []
    prefix = _letter_spacing_tag(letter_spacing)
    separator = _word_separator(letter_spacing, word_spacing)
    for line_words in lines:
        tokens = [word_infos[word.index].markup for word in line_words if word_infos.get(word.index)]
        if not tokens:
            continue
        rendered_lines.append(f"{prefix}{separator.join(tokens)}" if prefix else separator.join(tokens))
        max_height = 0.0
        for word in line_words:
            info = word_infos.get(word.index)
            if info and info.size > max_height:
                max_height = info.size
        line_heights.append(max_height)
    return rendered_lines, line_heights


def _replace_markup_text(markup: str, text: str) -> str:
    if not markup:
        return _escape_ass_text(text)
    idx = markup.find("}")
    escaped = _escape_ass_text(text)
    if idx == -1:
        return escaped
    return f"{markup[:idx + 1]}{escaped}"


def _apply_partial_reveal(markup: str, full_text: str, visible_count: int) -> str:
    if visible_count <= 0:
        return ""
    if visible_count >= len(full_text):
        return _replace_markup_text(markup, full_text)
    visible = _escape_ass_text(full_text[:visible_count])
    hidden = _escape_ass_text(full_text[visible_count:])
    idx = markup.find("}")
    prefix = markup[: idx + 1] if idx != -1 else ""
    hidden_tag = r"{\alpha&HFF&\3a&HFF&\4a&HFF&}"
    reset_tag = r"{\alpha&H00&\3a&H00&\4a&H00&}"
    if not hidden:
        return f"{prefix}{visible}" if prefix else visible
    if prefix:
        return f"{prefix}{visible}{hidden_tag}{hidden}{reset_tag}"
    return f"{visible}{hidden_tag}{hidden}{reset_tag}"


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
    play_res: Optional[Tuple[int, int]] = None,
) -> str:
    dynamics_map: Dict[int, WordDynamics] = {item.word_index: item for item in analysis.words}
    global_min = analysis.rms_min
    global_max = analysis.rms_max

    if play_res is None:
        width = config.play_res_x or 1920
        height = config.play_res_y or 1080
    else:
        width, height = play_res
    placements, placements_by_segment = _load_placements(config, (width, height))
    colors = _load_color_overrides(config)
    segment_styles = config.segment_styles
    primary_style_color = _hex_to_style_color(config.font_color)
    outline_style_color = _hex_to_style_color(config.shadow_color)
    bold_flag, italic_flag = _ass_font_style_flags(config.font_style)
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
            f"Style: Default,{config.default_font},{int(config.size_mapping.min_size)},{primary_style_color},&H000000FF,"
            f"{outline_style_color},&H64000000,{bold_flag},{italic_flag},0,0,100,100,0,0,1,{config.outline},{config.shadow},{config.alignment},80,80,80,1",
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
        placements_by_segment,
        colors,
        config.font_color,
        config.shadow_color,
        segment_styles,
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
    if display.windows:
        return _group_manual_windows(words, display.windows)
    if display.mode == "fixed_count":
        return _group_fixed_count(words, display.words_per_caption)
    if display.mode == "fixed_interval":
        return _group_fixed_interval(words, display.interval_seconds)
    if display.mode == "rolling":
        return _group_rolling(words, display.rolling_window)
    return _group_by_segment(transcript)


def _group_by_segment(transcript: Transcript) -> List[CaptionLine]:
    lines: List[CaptionLine] = []
    for segment in transcript.segments:
        if not segment.words:
            continue
        lines.append(
            CaptionLine(
                start=segment.start,
                end=segment.end,
                words=list(segment.words),
                segment_id=segment.index,
            )
        )
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
    word_lookup = {word.index: word for word in words}
    word_iter = iter(words)
    current_word = next(word_iter, None)
    for window in windows:
        chunk: List[WordTiming] = []
        if window.word_ids:
            for word_id in window.word_ids:
                word = word_lookup.get(word_id)
                if word:
                    chunk.append(word)
        else:
            while current_word and current_word.end <= window.start:
                current_word = next(word_iter, None)
            while current_word and current_word.start < window.end:
                chunk.append(current_word)
                current_word = next(word_iter, None)
        if chunk:
            start = window.start
            end = window.end
            lines.append(CaptionLine(start=start, end=end, words=list(chunk), segment_id=window.id))
    return lines


def _segment_style_for_line(
    line_data: CaptionLine,
    styles_by_id: Dict[Optional[int], SegmentStyle],
    styles: List[SegmentStyle],
) -> Optional[SegmentStyle]:
    if line_data.segment_id is not None:
        direct = styles_by_id.get(line_data.segment_id)
        if direct:
            return direct
        return None
    for style in styles:
        if style.start <= line_data.end and style.end >= line_data.start:
            return style
    return None


def _effective_size_mapping(base: SizeMapping, style: Optional[SegmentStyle]) -> SizeMapping:
    if not style:
        return base
    min_size = style.size_min if style.size_min is not None else base.min_size
    max_size = style.size_max if style.size_max is not None else base.max_size
    if max_size < min_size:
        min_size, max_size = max_size, min_size
    return SizeMapping(min_size=min_size, max_size=max_size)


def _line_alignment_tag(alignment: int) -> int:
    if alignment in {1, 4, 7}:
        return 7
    if alignment in {2, 5, 8}:
        return 8
    if alignment in {3, 6, 9}:
        return 9
    return 7


def _block_top(alignment: int, anchor_y: float, total_height: float) -> float:
    if alignment in {7, 8, 9}:
        return anchor_y
    if alignment in {4, 5, 6}:
        return anchor_y - total_height / 2
    return anchor_y - total_height


def _build_line_entries(
    rendered_lines: List[str],
    line_heights: List[float],
    placement: Placement,
    start: float,
    end: float,
    alignment: int,
    line_spacing: float,
) -> List[DialogueEntry]:
    if not rendered_lines:
        return []
    if len(line_heights) != len(rendered_lines):
        line_heights = [max(line_heights) if line_heights else 0.0] * len(rendered_lines)
    total_height = sum(line_heights) + line_spacing * max(len(rendered_lines) - 1, 0)
    top = _block_top(alignment, placement.y, total_height)
    line_alignment = _line_alignment_tag(alignment)
    entries: List[DialogueEntry] = []
    y_offset = top
    for text, height in zip(rendered_lines, line_heights):
        pos_x = int(round(placement.x))
        pos_y = int(round(y_offset))
        positioned = rf"{{\pos({pos_x},{pos_y})\an{line_alignment}}}{text}"
        entries.append(DialogueEntry(start=start, end=end, text=positioned))
        y_offset += height + line_spacing
    return entries


def _build_dialogue_entries(
    caption_lines: List[CaptionLine],
    dynamics_map: Dict[int, WordDynamics],
    config: RenderConfig,
    global_min: float,
    global_max: float,
    placements: List[Placement],
    placements_by_segment: Dict[int, Placement],
    color_overrides: List[SegmentColor],
    default_color: str,
    default_shadow: str,
    segment_styles: List[SegmentStyle],
) -> List[DialogueEntry]:
    entries: List[DialogueEntry] = []
    reveal_mode = config.display.reveal_mode
    line_limits = config.display.line_word_limits
    segment_styles_by_id = {style.id: style for style in segment_styles if style.id is not None}

    for line_data in caption_lines:
        segment_style = _segment_style_for_line(line_data, segment_styles_by_id, segment_styles)
        size_mapping = _effective_size_mapping(config.size_mapping, segment_style)
        letter_spacing = segment_style.letter_spacing if segment_style and segment_style.letter_spacing is not None else config.letter_spacing
        word_spacing = segment_style.word_spacing if segment_style and segment_style.word_spacing is not None else config.word_spacing
        line_spacing = segment_style.line_spacing if segment_style and segment_style.line_spacing is not None else config.line_spacing
        line_spacing = max(0.0, line_spacing)

        word_infos = _compute_line_markups(
            line_data,
            dynamics_map,
            config,
            size_mapping,
            global_min,
            global_max,
            color_overrides,
            default_color,
            default_shadow,
            segment_style,
        )
        if segment_style and segment_style.write_on:
            entries.extend(
                _dialogues_write_on(
                    line_data,
                    word_infos,
                    line_limits,
                    placements,
                    placements_by_segment,
                    letter_spacing,
                    word_spacing,
                    line_spacing,
                    config.alignment,
                    segment_style.write_on,
                )
            )
        elif reveal_mode == "per_word":
            entries.extend(
                _dialogues_per_word(
                    line_data,
                    word_infos,
                    line_limits,
                    placements,
                    placements_by_segment,
                    letter_spacing,
                    word_spacing,
                    line_spacing,
                    config.alignment,
                )
            )
        else:
            rendered_lines, line_heights = _render_lines(
                line_data.words,
                word_infos,
                line_limits,
                letter_spacing,
                word_spacing,
            )
            if not rendered_lines:
                continue
            start = line_data.start
            end = max(line_data.end, start + 0.01)
            placement = _placement_for_line(line_data, placements, placements_by_segment, start)
            if line_spacing > 0 and len(rendered_lines) > 1:
                entries.extend(
                    _build_line_entries(
                        rendered_lines,
                        line_heights,
                        placement,
                        start,
                        end,
                        config.alignment,
                        line_spacing,
                    )
                )
            else:
                text = r"\N".join(rendered_lines)
                positioned = _apply_position(text, placement)
                entries.append(DialogueEntry(start=start, end=end, text=positioned))
    return entries


def _normalize_write_on_keyframes(
    keyframes: List[WriteOnKeyframe],
    start: float,
    end: float,
) -> List[WriteOnKeyframe]:
    cleaned: List[WriteOnKeyframe] = []
    for frame in keyframes:
        time = min(max(frame.time, start), end)
        value = max(0.0, min(1.0, frame.value))
        cleaned.append(WriteOnKeyframe(time=time, value=value))
    cleaned.sort(key=lambda frame: frame.time)
    merged: List[WriteOnKeyframe] = []
    for frame in cleaned:
        if merged and abs(merged[-1].time - frame.time) < 0.001:
            merged[-1] = frame
        else:
            merged.append(frame)
    normalized: List[WriteOnKeyframe] = []
    last_value = 0.0
    for frame in merged:
        value = max(frame.value, last_value)
        normalized.append(WriteOnKeyframe(time=frame.time, value=value))
        last_value = value
    return normalized


def _write_on_time_for_progress(
    keyframes: List[WriteOnKeyframe],
    start: float,
    progress: float,
) -> Optional[float]:
    if not keyframes:
        return None
    if progress <= keyframes[0].value:
        return start
    for idx in range(len(keyframes) - 1):
        current = keyframes[idx]
        next_frame = keyframes[idx + 1]
        if current.value <= progress <= next_frame.value:
            span = next_frame.time - current.time
            if span <= 0 or abs(next_frame.value - current.value) < 0.0001:
                return next_frame.time
            ratio = (progress - current.value) / (next_frame.value - current.value)
            return current.time + ratio * span
    if progress <= keyframes[-1].value:
        return keyframes[-1].time
    return None


def _dialogues_write_on(
    line_data: CaptionLine,
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
    placements: List[Placement],
    placements_by_segment: Dict[int, Placement],
    letter_spacing: float,
    word_spacing: float,
    line_spacing: float,
    alignment: int,
    keyframes: List[WriteOnKeyframe],
) -> List[DialogueEntry]:
    words = line_data.words
    if not words:
        return []

    normalized = _normalize_write_on_keyframes(keyframes, line_data.start, line_data.end)
    if not normalized:
        return []

    total_chars = sum(len(word.text) for word in words)
    if total_chars == 0:
        return []

    reveal_times: List[Tuple[float, int]] = []
    epsilon = 0.0001
    for idx in range(total_chars):
        threshold = (idx + epsilon) / total_chars
        reveal_time = _write_on_time_for_progress(normalized, line_data.start, threshold)
        if reveal_time is None:
            break
        reveal_times.append((reveal_time, idx + 1))

    if not reveal_times:
        return []

    merged_events: List[Tuple[float, int]] = []
    for time_value, count in reveal_times:
        if merged_events and abs(merged_events[-1][0] - time_value) < 0.001:
            merged_events[-1] = (time_value, max(merged_events[-1][1], count))
        else:
            merged_events.append((time_value, count))

    entries: List[DialogueEntry] = []
    for idx, (start_time, count) in enumerate(merged_events):
        end_time = line_data.end
        if idx + 1 < len(merged_events):
            end_time = min(end_time, merged_events[idx + 1][0])
        if end_time <= start_time:
            continue
        visible_words: List[WordTiming] = []
        remaining = count
        partial_override: Optional[Tuple[int, str, int]] = None
        for word in words:
            if remaining <= 0:
                break
            if len(word.text) <= remaining:
                visible_words.append(word)
                remaining -= len(word.text)
                continue
            if remaining > 0:
                visible_words.append(word)
                partial_override = (word.index, word.text, remaining)
            remaining = 0
            break

        if not visible_words:
            continue

        active_word_infos = word_infos
        if partial_override:
            info = word_infos.get(partial_override[0])
            if info:
                updated = WordRender(
                    markup=_apply_partial_reveal(info.markup, partial_override[1], partial_override[2]),
                    size=info.size,
                )
                active_word_infos = {**word_infos, partial_override[0]: updated}
        rendered_lines, line_heights = _render_lines(
            visible_words,
            active_word_infos,
            line_limits,
            letter_spacing,
            word_spacing,
        )
        if not rendered_lines:
            continue
        placement = _placement_for_line(line_data, placements, placements_by_segment, start_time)
        start = max(line_data.start, start_time)
        end = max(start + 0.01, end_time)
        if line_spacing > 0 and len(rendered_lines) > 1:
            entries.extend(
                _build_line_entries(
                    rendered_lines,
                    line_heights,
                    placement,
                    start,
                    end,
                    alignment,
                    line_spacing,
                )
            )
        else:
            text = r"\N".join(rendered_lines)
            positioned = _apply_position(text, placement)
            entries.append(DialogueEntry(start=start, end=end, text=positioned))

    return entries


def _dialogues_per_word(
    line_data: CaptionLine,
    word_infos: Dict[int, WordRender],
    line_limits: List[int],
    placements: List[Placement],
    placements_by_segment: Dict[int, Placement],
    letter_spacing: float,
    word_spacing: float,
    line_spacing: float,
    alignment: int,
) -> List[DialogueEntry]:
    words = line_data.words
    if not words:
        return []

    entries: List[DialogueEntry] = []
    total = len(words)

    visible_words: List[WordTiming] = []
    last_position: Optional[Tuple[int, int]] = None

    for idx, word in enumerate(words):
        placement = _placement_for_line(line_data, placements, placements_by_segment, max(line_data.start, word.start))
        current_position = (placement.x, placement.y)

        if last_position != current_position:
            visible_words = [word]
        else:
            visible_words.append(word)

        rendered_lines, line_heights = _render_lines(
            visible_words,
            word_infos,
            line_limits,
            letter_spacing,
            word_spacing,
        )
        if not rendered_lines:
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
        if line_spacing > 0 and len(rendered_lines) > 1:
            entries.extend(
                _build_line_entries(
                    rendered_lines,
                    line_heights,
                    placement,
                    start,
                    end,
                    alignment,
                    line_spacing,
                )
            )
        else:
            text = r"\N".join(rendered_lines)
            positioned = _apply_position(text, placement)
            entries.append(DialogueEntry(start=start, end=end, text=positioned))
        last_position = current_position

    return entries


def _compute_line_markups(
    line_data: CaptionLine,
    dynamics_map: Dict[int, WordDynamics],
    config: RenderConfig,
    size_mapping: SizeMapping,
    global_min: float,
    global_max: float,
    color_overrides: List[SegmentColor],
    default_color: str,
    default_shadow: str,
    segment_style: Optional[SegmentStyle],
) -> Dict[int, WordRender]:
    values: List[float] = []
    font_override = None
    if segment_style and segment_style.font:
        font_override = segment_style.font
    effective_font_style = segment_style.font_style if segment_style and segment_style.font_style else config.font_style
    style_tag = _ass_font_style_tags(effective_font_style)

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
        primary_hex, shadow_hex = _color_for_time(color_overrides, word.start, default_color, default_shadow)
        if segment_style and segment_style.font_color:
            primary_hex = segment_style.font_color
        if segment_style and segment_style.shadow_color:
            shadow_hex = segment_style.shadow_color
        primary_tag = _ass_primary_tag(primary_hex)
        outline_tag = _ass_outline_tag(shadow_hex)
        shadow_tag = _ass_shadow_tag(shadow_hex)
        if dynamics:
            if use_local:
                markup = _word_markup(
                    word,
                    dynamics,
                    config,
                    size_mapping,
                    rms_min=local_min,
                    rms_max=local_max,
                    primary_tag=primary_tag,
                    outline_tag=outline_tag,
                    shadow_tag=shadow_tag,
                    style_tag=style_tag,
                    font_override=font_override,
                )
            else:
                markup = _word_markup(
                    word,
                    dynamics,
                    config,
                    size_mapping,
                    rms_min=global_min,
                    rms_max=global_max,
                    primary_tag=primary_tag,
                    outline_tag=outline_tag,
                    shadow_tag=shadow_tag,
                    style_tag=style_tag,
                    font_override=font_override,
                )
            size = _extract_size_from_markup(markup, size_mapping)
            word_infos[word.index] = WordRender(markup=markup, size=size)
        else:
            markup = _fallback_markup(
                word,
                config,
                size_mapping,
                primary_tag,
                outline_tag,
                shadow_tag,
                style_tag=style_tag,
                font_override=font_override,
            )
            size = _extract_size_from_markup(markup, size_mapping)
            word_infos[word.index] = WordRender(markup=markup, size=size)

    return word_infos


def _fallback_markup(
    word: WordTiming,
    config: RenderConfig,
    size_mapping: SizeMapping,
    primary_tag: str,
    outline_tag: str,
    shadow_tag: str,
    style_tag: str,
    font_override: Optional[str] = None,
) -> str:
    escaped_text = _escape_ass_text(word.text)
    size = int(round(size_mapping.min_size))
    font = font_override or config.default_font
    return rf"{{\fn{font}\fs{size}{style_tag}{primary_tag}{outline_tag}{shadow_tag}}}{escaped_text}"


def _extract_size_from_markup(markup: str, size_mapping: SizeMapping) -> float:
    match = _FS_PATTERN.search(markup)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            pass
    return float(size_mapping.min_size)


def _load_placements(config: RenderConfig, play_res: Tuple[int, int]) -> Tuple[List[Placement], Dict[int, Placement]]:
    width, height = play_res
    default = [Placement(end=float("inf"), x=width // 2, y=height // 2)]

    if not config.placements_path:
        return default, {}

    path = config.placements_path
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("Placements file not found: %s", path)
        return default, {}
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse placements file %s: %s", path, exc)
        return default, {}

    entries = payload.get("placements") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        logger.warning("Placements file %s must contain a list under 'placements'", path)
        return default, {}

    placements: List[Placement] = []
    placements_by_segment: Dict[int, Placement] = {}
    for item in entries:
        if not isinstance(item, dict):
            continue
        end_raw = item.get("end", float("inf"))
        try:
            end_value = float(end_raw)
        except (TypeError, ValueError):
            end_value = float("inf")
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

        segment_id = None
        for key in ("segment_id", "segmentId", "id"):
            if key in item:
                try:
                    segment_id = int(item[key])
                except (TypeError, ValueError):
                    segment_id = None
                break

        placement = Placement(end=end_value, x=x_value, y=y_value, segment_id=segment_id)
        if segment_id is not None:
            placements_by_segment[segment_id] = placement
        else:
            placements.append(placement)

    placements.sort(key=lambda p: p.end)
    if not placements or placements[-1].end != float("inf"):
        placements.append(Placement(end=float("inf"), x=width // 2, y=height // 2))
    return placements, placements_by_segment


def _load_color_overrides(config: RenderConfig) -> List[SegmentColor]:
    if not config.colors_path:
        return []

    try:
        payload = json.loads(config.colors_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("Colors file not found: %s", config.colors_path)
        return []
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse colors file %s: %s", config.colors_path, exc)
        return []

    entries = payload.get("colors") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        logger.warning("Colors file %s must contain a list under 'colors'", config.colors_path)
        return []

    overrides: List[SegmentColor] = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        try:
            start = float(item.get("start"))
            end = float(item.get("end"))
        except (TypeError, ValueError):
            continue
        if end <= start:
            continue
        color_hex = _normalize_hex_color(str(item.get("color", config.font_color)), config.font_color)
        shadow_hex = _normalize_hex_color(str(item.get("shadow", config.shadow_color)), config.shadow_color)
        overrides.append(SegmentColor(start=start, end=end, color=color_hex, shadow=shadow_hex))

    overrides.sort(key=lambda entry: entry.start)
    return overrides


def _color_for_time(
    overrides: List[SegmentColor],
    timestamp: float,
    default_color: str,
    default_shadow: str,
) -> tuple[str, str]:
    for entry in overrides:
        if entry.start <= timestamp <= entry.end:
            return entry.color, entry.shadow
    return (
        _normalize_hex_color(default_color, default_color),
        _normalize_hex_color(default_shadow, default_shadow),
    )


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


def _placement_for_line(
    line_data: CaptionLine,
    placements: List[Placement],
    placements_by_segment: Dict[int, Placement],
    time_point: float,
) -> Placement:
    if line_data.segment_id is not None:
        placement = placements_by_segment.get(line_data.segment_id)
        if placement:
            return placement
    return _placement_for_time(placements, time_point)


def _apply_position(text: str, placement: Placement) -> str:
    if not text:
        return text
    return rf"{{\pos({placement.x},{placement.y})}}{text}"
