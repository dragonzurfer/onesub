from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable, List, Optional

from .models import Segment, Transcript, WordTiming

logger = logging.getLogger(__name__)


def _parse_segments(raw_segments: Iterable[dict]) -> List[Segment]:
    word_index = 0
    segments: List[Segment] = []
    for seg_idx, segment in enumerate(raw_segments):
        words_payload = segment.get("words") or []
        words: List[WordTiming] = []
        for payload in words_payload:
            if payload is None:
                continue
            start = float(payload.get("start", segment.get("start", 0.0)))
            end = float(payload.get("end", segment.get("end", start)))
            text = (payload.get("word") or "").strip()
            if not text:
                continue
            word = WordTiming(
                index=word_index,
                text=text,
                start=start,
                end=end,
                probability=payload.get("probability"),
            )
            words.append(word)
            word_index += 1

        segment_obj = Segment(
            index=seg_idx,
            start=float(segment.get("start", 0.0)),
            end=float(segment.get("end", 0.0)),
            text=(segment.get("text") or "").strip(),
            words=words,
        )
        segments.append(segment_obj)
    return segments


def build_transcript(
    audio_path: Path,
    model_name: str,
    language: Optional[str],
    raw_result: dict,
) -> Transcript:
    segments = _parse_segments(raw_result.get("segments", []))
    logger.info("Parsed %d segments and %d words", len(segments), sum(len(s.words) for s in segments))
    return Transcript(
        audio_path=audio_path,
        model_name=model_name,
        language=language,
        segments=segments,
    )


def transcribe_audio(
    audio_path: Path,
    model_name: str = "base",
    language: Optional[str] = None,
    device: Optional[str] = None,
) -> Transcript:
    """
    Run Whisper transcription and emit a Transcript with per-word timestamps.
    """
    import whisper  # Lazy import so unit tests without whisper do not fail eagerly.

    audio_path = audio_path.expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    logger.info("Loading Whisper model '%s' (device=%s)", model_name, device or "auto")
    model = whisper.load_model(model_name, device=device)
    logger.info("Transcribing audio: %s", audio_path)
    options = {
        "language": language,
        "word_timestamps": True,
        "task": "transcribe",
    }
    # Remove None values so whisper uses its defaults.
    options = {k: v for k, v in options.items() if v is not None}
    raw_result = model.transcribe(str(audio_path), **options)
    return build_transcript(audio_path=audio_path, model_name=model_name, language=language, raw_result=raw_result)

