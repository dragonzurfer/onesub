from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

from ..config import RenderConfig
from ..rendering import build_ass_script, render_with_ffmpeg, write_ass_script
from ..serialization import load_audio_analysis, load_transcript

logger = logging.getLogger(__name__)


def _load_config(path: Path) -> RenderConfig:
    path = path.expanduser().resolve()
    if path.suffix.lower() in {".yaml", ".yml"}:
        try:
            import yaml  # type: ignore
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise RuntimeError(
                f"YAML configuration requested but PyYAML is not installed: {path}"
            ) from exc
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    else:
        payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Configuration file must define an object/dict at the top level.")
    return RenderConfig.from_dict(payload, base_path=path.parent)


def run(
    video_path: Path,
    captions_path: Path,
    analysis_path: Path,
    output_path: Path,
    config_path: Path,
    ffmpeg_binary: str = "ffmpeg",
) -> Path:
    transcript = load_transcript(captions_path)
    audio_analysis = load_audio_analysis(analysis_path)
    render_config = _load_config(config_path)

    ass_content = build_ass_script(transcript, audio_analysis, render_config)
    ass_path = output_path.with_suffix(".ass")
    write_ass_script(ass_content, ass_path)
    return render_with_ffmpeg(video_path, ass_path, output_path, ffmpeg_binary=ffmpeg_binary)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Render stylised subtitles onto a video.")
    parser.add_argument("video", type=Path, help="Input video file (.mov/.mp4).")
    parser.add_argument("--captions", type=Path, required=True, help="Path to captions.json produced by prepare step.")
    parser.add_argument(
        "--analysis",
        type=Path,
        required=True,
        help="Path to audio_analysis.json produced by prepare step.",
    )
    parser.add_argument(
        "--config",
        type=Path,
        required=True,
        help="Styling configuration (JSON or YAML).",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("data/rendered/output.mp4"),
        help="Path to the rendered video with subtitles.",
    )
    parser.add_argument("--ffmpeg", default="ffmpeg", help="ffmpeg binary to use (default: ffmpeg on PATH).")
    return parser


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    parser = build_parser()
    args = parser.parse_args(argv)
    run(
        video_path=args.video,
        captions_path=args.captions,
        analysis_path=args.analysis,
        output_path=args.output,
        config_path=args.config,
        ffmpeg_binary=args.ffmpeg,
    )


if __name__ == "__main__":
    main()
