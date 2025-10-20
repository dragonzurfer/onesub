from __future__ import annotations

import argparse
import logging
import os
import subprocess
import tempfile
from pathlib import Path

from ..audio_analysis import analyze_word_dynamics
from ..serialization import analysis_to_dict, dump_json, transcript_to_dict, word_timings_to_dict
from ..transcription import transcribe_audio

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv"}
SUPPORTED_AUDIO = {".m4a", ".mp3", ".wav", ".flac", ".aac"}


def run(
    input_path: Path,
    output_dir: Path,
    model_name: str = "base",
    language: str | None = None,
    device: str | None = None,
) -> tuple[Path, Path]:
    input_path = input_path.expanduser().resolve()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    temp_audio: Path | None = None
    try:
        audio_source = _prepare_audio_source(input_path)
        if audio_source != input_path:
            temp_audio = audio_source

        transcript = transcribe_audio(audio_path=audio_source, model_name=model_name, language=language, device=device)
        words = transcript.flatten_words()
        if not words:
            raise RuntimeError("No word-level timings were generated. Whisper may need word timestamp support.")

        audio_analysis = analyze_word_dynamics(audio_path=audio_source, words=words)

        if temp_audio is not None:
            transcript.audio_path = input_path
            audio_analysis.audio_path = input_path

        output_dir = output_dir.expanduser().resolve()
        captions_path = output_dir / "captions.json"
        analysis_path = output_dir / "audio_analysis.json"
        word_timings_path = output_dir / "word_timings.json"

        dump_json(transcript_to_dict(transcript), captions_path)
        dump_json(analysis_to_dict(audio_analysis), analysis_path)
        dump_json(word_timings_to_dict(transcript), word_timings_path)
        logger.info("Stored transcript at %s", captions_path)
        logger.info("Stored audio analysis at %s", analysis_path)
        logger.info("Stored word timings at %s", word_timings_path)
        return captions_path, analysis_path
    finally:
        if temp_audio and temp_audio.exists():
            try:
                temp_audio.unlink()
            except OSError:
                logger.warning("Could not remove temporary audio file: %s", temp_audio)


def _prepare_audio_source(input_path: Path) -> Path:
    suffix = input_path.suffix.lower()
    if suffix in SUPPORTED_AUDIO:
        return input_path
    if suffix in VIDEO_EXTENSIONS:
        return _extract_audio_from_video(input_path)
    raise ValueError(
        f"Unsupported input format: {suffix}. Provide audio ({', '.join(sorted(SUPPORTED_AUDIO))}) "
        f"or video ({', '.join(sorted(VIDEO_EXTENSIONS))})."
    )


def _extract_audio_from_video(video_path: Path) -> Path:
    fd, tmp_path_str = tempfile.mkstemp(suffix=".m4a", prefix="onesub_audio_")
    os.close(fd)
    tmp_path = Path(tmp_path_str)
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-acodec",
        "aac",
        str(tmp_path),
    ]
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(
            f"Failed to extract audio from {video_path}: {exc.stderr.decode('utf-8', 'ignore')}"
        ) from exc
    logger.info("Extracted audio from %s to %s", video_path, tmp_path)
    return tmp_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate Whisper subtitles and loudness analysis.")
    parser.add_argument("audio", type=Path, help="Input .m4a/.mp3 audio track or .mp4/.mov video")
    parser.add_argument(
        "-o",
        "--output-dir",
        type=Path,
        default=Path("data/prepared"),
        help="Directory to store captions.json and audio_analysis.json",
    )
    parser.add_argument("--model", default="base", help="Whisper model name (tiny, base, small, medium, large)")
    parser.add_argument("--language", default=None, help="Force Whisper language (default: auto detect)")
    parser.add_argument(
        "--device",
        default=None,
        help="Torch device override (e.g. cuda, cpu). Defaults to Whisper auto-detect.",
    )
    return parser


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
    parser = build_parser()
    args = parser.parse_args(argv)
    run(
        input_path=args.audio,
        output_dir=args.output_dir,
        model_name=args.model,
        language=args.language,
        device=args.device,
    )


if __name__ == "__main__":
    main()
