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
            windows.append(ManualWindow(start=start, end=end))

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
class RenderConfig:
    size_mapping: SizeMapping
    font_bands: List[FontBand]
    default_font: str
    outline: int = 2
    shadow: int = 0
    line_spacing: int = 0
    alignment: int = 7
    placements_path: Optional[Path] = None
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


        return cls(
            size_mapping=size_mapping,
            font_bands=font_bands,
            default_font=default_font,
            outline=int(payload.get("outline", 2)),
            shadow=int(payload.get("shadow", 0)),
            line_spacing=int(payload.get("line_spacing", 0)),
            alignment=alignment_value,
            placements_path=placements_path,
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

(value: object, fallback: str) -> str:
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
