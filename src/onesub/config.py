from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional


@dataclass(frozen=True)
class FontBand:
    min_size: float
    max_size: float
    font: str

    def matches(self, size: float) -> bool:
        return self.min_size <= size <= self.max_size


@dataclass(frozen=True)
class SizeMapping:
    min_size: float
    max_size: float

    def clamp(self, value: float) -> float:
        return min(self.max_size, max(self.min_size, value))


@dataclass(frozen=True)
class ManualWindow:
    start: float
    end: float
    id: Optional[int] = None
    word_ids: List[int] = field(default_factory=list)

    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class DisplayConfig:
    mode: str = "segment"
    words_per_caption: int = 6
    interval_seconds: float = 3.0
    rolling_window: int = 6
    windows: List[ManualWindow] = field(default_factory=list)
    reveal_mode: str = "block"
    line_word_limits: List[int] = field(default_factory=list)

    @classmethod
    def from_dict(cls, payload: dict, base_path: Optional[Path] = None) -> "DisplayConfig":
        if not payload:
            return cls()

        mode = str(payload.get("mode", "segment"))
        words_per_caption = int(payload.get("words_per_caption", 6))
        interval_seconds = float(payload.get("interval_seconds", 3.0))
        rolling_window = int(payload.get("rolling_window", max(words_per_caption, 1)))

        windows_payload = payload.get("windows", [])
        windows_path_value = payload.get("windows_path")
        windows: List[ManualWindow] = []

        if windows_path_value:
            windows_path = Path(windows_path_value)
            if base_path and not windows_path.is_absolute():
                windows_path = (base_path / windows_path).resolve()
            data = _load_windows_file(windows_path)
            windows_payload = data.get("windows", windows_payload)

        for window in windows_payload:
            try:
                start = float(window["start"])
                end = float(window["end"])
            except (KeyError, TypeError, ValueError):
                continue
            if end <= start:
                continue
            raw_id = window.get("id") if isinstance(window, dict) else None
            window_id = None
            if raw_id is not None:
                try:
                    window_id = int(raw_id)
                except (TypeError, ValueError):
                    window_id = None

            raw_word_ids = []
            if isinstance(window, dict):
                raw_word_ids = window.get("word_ids", [])
            word_ids: List[int] = []
            if isinstance(raw_word_ids, list):
                for value in raw_word_ids:
                    try:
                        word_ids.append(int(value))
                    except (TypeError, ValueError):
                        continue

            windows.append(ManualWindow(start=start, end=end, id=window_id, word_ids=word_ids))

        line_limits_raw = payload.get("line_word_limits", [])
        line_limits: List[int] = []
        for value in line_limits_raw:
            try:
                limit = int(value)
            except (TypeError, ValueError):
                continue
            if limit > 0:
                line_limits.append(limit)

        reveal_raw = payload.get("reveal_mode", payload.get("reveal", "block"))
        reveal_mode = str(reveal_raw).lower()
        if reveal_mode not in {"block", "per_word"}:
            reveal_mode = "block"

        if line_limits:
            total_line_words = sum(line_limits)
            words_per_caption = max(words_per_caption, total_line_words)
            rolling_window = max(rolling_window, total_line_words)

        return cls(
            mode=mode,
            words_per_caption=max(words_per_caption, 1),
            interval_seconds=max(interval_seconds, 0.1),
            rolling_window=max(rolling_window, 1),
            windows=windows,
            reveal_mode=reveal_mode,
            line_word_limits=line_limits,
        )


@dataclass(frozen=True)
class SegmentStyle:
    id: Optional[int]
    start: float
    end: float
    size_min: Optional[float] = None
    size_max: Optional[float] = None
    letter_spacing: Optional[float] = None
    word_spacing: Optional[float] = None
    line_spacing: Optional[float] = None
    font: Optional[str] = None
    font_style: Optional[str] = None
    font_color: Optional[str] = None
    shadow_color: Optional[str] = None
    write_on: List["WriteOnKeyframe"] = field(default_factory=list)


@dataclass(frozen=True)
class WriteOnKeyframe:
    time: float
    value: float


@dataclass(frozen=True)
class RenderConfig:
    size_mapping: SizeMapping
    font_bands: List[FontBand]
    default_font: str
    font_style: str = "bold"
    outline: int = 2
    shadow: int = 0
    line_spacing: int = 0
    letter_spacing: float = 0.0
    word_spacing: float = 0.0
    alignment: int = 7
    font_color: str = "#FFFFFF"
    shadow_color: str = "#000000"
    play_res_x: int = 1920
    play_res_y: int = 1080
    placements_path: Optional[Path] = None
    colors_path: Optional[Path] = None
    segment_styles: List[SegmentStyle] = field(default_factory=list)
    display: DisplayConfig = field(default_factory=DisplayConfig)

    @classmethod
    def from_dict(cls, payload: dict, base_path: Optional[Path] = None) -> "RenderConfig":
        size_payload = payload.get("size_mapping", {})
        font_bands_payload: Iterable[dict] = payload.get("font_bands", [])

        size_mapping = SizeMapping(
            min_size=float(size_payload.get("min", 24.0)),
            max_size=float(size_payload.get("max", 48.0)),
        )

        font_bands = [
            FontBand(
                min_size=float(item.get("min_size", size_mapping.min_size)),
                max_size=float(item.get("max_size", size_mapping.max_size)),
                font=str(item.get("font", payload.get("default_font", "Arial"))),
            )
            for item in font_bands_payload
        ]

        default_font = str(payload.get("default_font", "Arial"))
        font_style = _normalize_font_style(payload.get("font_style")) or "bold"

        display_payload = payload.get("display", {})
        display_config = DisplayConfig.from_dict(display_payload, base_path=base_path)

        alignment_value = int(payload.get("alignment", 7))
        if alignment_value < 1 or alignment_value > 9:
            alignment_value = 7

        placements_value = payload.get("placements_path")
        placements_path: Optional[Path] = None
        if placements_value:
            raw_path = Path(str(placements_value)).expanduser()
            if base_path and not raw_path.is_absolute():
                parts = raw_path.parts
                if parts and Path(base_path).name == parts[0]:
                    raw_path = Path(*parts[1:]) if len(parts) > 1 else Path()
                resolved = (base_path / raw_path).resolve()
            else:
                resolved = raw_path.resolve()
            placements_path = resolved

        colors_value = payload.get("colors_path")
        colors_path: Optional[Path] = None
        if colors_value:
            raw_path = Path(str(colors_value)).expanduser()
            if base_path and not raw_path.is_absolute():
                parts = raw_path.parts
                if parts and Path(base_path).name == parts[0]:
                    raw_path = Path(*parts[1:]) if len(parts) > 1 else Path()
                resolved = (base_path / raw_path).resolve()
            else:
                resolved = raw_path.resolve()
            colors_path = resolved

        segment_styles_payload = payload.get("segment_styles", [])
        segment_styles_value = payload.get("segment_styles_path")
        if segment_styles_value:
            raw_path = Path(str(segment_styles_value)).expanduser()
            if base_path and not raw_path.is_absolute():
                parts = raw_path.parts
                if parts and Path(base_path).name == parts[0]:
                    raw_path = Path(*parts[1:]) if len(parts) > 1 else Path()
                resolved = (base_path / raw_path).resolve()
            else:
                resolved = raw_path.resolve()
            data = _load_segment_styles_file(resolved)
            segment_styles_payload = data.get("segments", segment_styles_payload)

        segment_styles: List[SegmentStyle] = []
        if isinstance(segment_styles_payload, list):
            for entry in segment_styles_payload:
                if not isinstance(entry, dict):
                    continue
                raw_id = entry.get("id")
                segment_id = None
                if raw_id is not None:
                    try:
                        segment_id = int(raw_id)
                    except (TypeError, ValueError):
                        segment_id = None

                start_raw = entry.get("start", 0.0)
                end_raw = entry.get("end", start_raw)
                try:
                    start = float(start_raw)
                    end = float(end_raw)
                except (TypeError, ValueError):
                    continue
                if segment_id is None and end <= start:
                    continue

                def _optional_float(value: object) -> Optional[float]:
                    if value is None:
                        return None
                    try:
                        return float(value)
                    except (TypeError, ValueError):
                        return None

                size_min = _optional_float(entry.get("size_min"))
                size_max = _optional_float(entry.get("size_max"))
                letter_spacing = _optional_float(entry.get("letter_spacing"))
                word_spacing = _optional_float(entry.get("word_spacing"))
                line_spacing = _optional_float(entry.get("line_spacing"))
                font_value = entry.get("font")
                font = None
                if isinstance(font_value, str):
                    font = font_value.strip() or None
                font_style = _normalize_font_style(entry.get("font_style"))

                font_color_value = entry.get("font_color")
                shadow_color_value = entry.get("shadow_color")
                font_color = _parse_color(font_color_value, "#FFFFFF") if font_color_value else None
                shadow_color = _parse_color(shadow_color_value, "#000000") if shadow_color_value else None

                write_on_frames: List[WriteOnKeyframe] = []
                raw_write_on = entry.get("write_on", [])
                if isinstance(raw_write_on, list):
                    for frame in raw_write_on:
                        if not isinstance(frame, dict):
                            continue
                        try:
                            time = float(frame.get("time"))
                            value = float(frame.get("value"))
                        except (TypeError, ValueError):
                            continue
                        value = max(0.0, min(1.0, value))
                        write_on_frames.append(WriteOnKeyframe(time=time, value=value))

                segment_styles.append(
                    SegmentStyle(
                        id=segment_id,
                        start=start,
                        end=end,
                        size_min=size_min,
                        size_max=size_max,
                        letter_spacing=letter_spacing,
                        word_spacing=word_spacing,
                        line_spacing=line_spacing,
                        font=font,
                        font_style=font_style,
                        font_color=font_color,
                        shadow_color=shadow_color,
                        write_on=write_on_frames,
                    )
                )


        play_res_x_raw = payload.get("play_res_x", payload.get("playResX", 1920))
        play_res_y_raw = payload.get("play_res_y", payload.get("playResY", 1080))
        try:
            play_res_x = int(play_res_x_raw)
        except (TypeError, ValueError):
            play_res_x = 1920
        try:
            play_res_y = int(play_res_y_raw)
        except (TypeError, ValueError):
            play_res_y = 1080
        if play_res_x <= 0:
            play_res_x = 1920
        if play_res_y <= 0:
            play_res_y = 1080

        return cls(
            size_mapping=size_mapping,
            font_bands=font_bands,
            default_font=default_font,
            font_style=font_style,
            outline=int(payload.get("outline", 2)),
            shadow=int(payload.get("shadow", 0)),
            line_spacing=int(payload.get("line_spacing", 0)),
            letter_spacing=float(payload.get("letter_spacing", 0.0)),
            word_spacing=float(payload.get("word_spacing", 0.0)),
            alignment=alignment_value,
            font_color=_parse_color(payload.get("font_color"), "#FFFFFF"),
            shadow_color=_parse_color(payload.get("shadow_color"), "#000000"),
            play_res_x=play_res_x,
            play_res_y=play_res_y,
            placements_path=placements_path,
            colors_path=colors_path,
            segment_styles=segment_styles,
            display=display_config,
        )

    def choose_font(self, size: float) -> str:
        for band in self.font_bands:
            if band.matches(size):
                return band.font
        return self.default_font


def _load_windows_file(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Windows configuration file not found: {path}")
    import json

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse windows file {path}: {exc}") from exc


def _load_segment_styles_file(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Segment styles file not found: {path}")
    import json

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse segment styles file {path}: {exc}") from exc

def _normalize_font_style(value: object) -> Optional[str]:
    if value is None:
        return None
    candidate = str(value).strip().lower().replace("-", "_")
    if not candidate:
        return None
    if candidate in {"regular", "normal"}:
        return "regular"
    if candidate in {"bold"}:
        return "bold"
    if candidate in {"italic", "oblique"}:
        return "italic"
    if candidate in {"bold_italic", "italic_bold", "bolditalic", "italicbold"}:
        return "bold_italic"
    return None

def _parse_color(value: object, fallback: str) -> str:
    candidate = str(value).strip() if value is not None else ""
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
