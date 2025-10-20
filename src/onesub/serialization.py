from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Dict, List

from .models import AudioAnalysis, Segment, Transcript, WordDynamics, WordTiming


def _normalize(obj: Any) -> Any:
    if is_dataclass(obj):
        return {key: _normalize(value) for key, value in asdict(obj).items()}
    if isinstance(obj, (list, tuple)):
        return [_normalize(item) for item in obj]
    if isinstance(obj, dict):
        return {key: _normalize(value) for key, value in obj.items()}
    if isinstance(obj, Path):
        return str(obj)
    return obj


def transcript_to_dict(transcript: Transcript) -> Dict[str, Any]:
    return _normalize(transcript)


def analysis_to_dict(analysis: AudioAnalysis) -> Dict[str, Any]:
    data = _normalize(analysis)
    data["stats"] = {
        "rms_min": analysis.rms_min,
        "rms_max": analysis.rms_max,
        "peak_min": analysis.peak_min,
        "peak_max": analysis.peak_max,
    }
    return data


def dump_json(data: Dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _load_json(path: Path) -> Dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_transcript(path: Path) -> Transcript:
    payload = _load_json(path)
    segments: List[Segment] = []
    for segment in payload.get("segments", []):
        words = [
            WordTiming(
                index=int(word.get("index", idx)),
                text=str(word.get("text", "")),
                start=float(word.get("start", 0.0)),
                end=float(word.get("end", 0.0)),
                probability=word.get("probability"),
            )
            for idx, word in enumerate(segment.get("words", []))
        ]
        segments.append(
            Segment(
                index=int(segment.get("index", len(segments))),
                start=float(segment.get("start", 0.0)),
                end=float(segment.get("end", 0.0)),
                text=str(segment.get("text", "")),
                words=words,
            )
        )
    return Transcript(
        audio_path=Path(payload.get("audio_path", "")),
        model_name=str(payload.get("model_name", "")),
        language=payload.get("language"),
        segments=segments,
    )


def load_audio_analysis(path: Path) -> AudioAnalysis:
    payload = _load_json(path)
    words = [
        WordDynamics(
            word_index=int(item.get("word_index", idx)),
            start=float(item.get("start", 0.0)),
            end=float(item.get("end", 0.0)),
            rms=float(item.get("rms", 0.0)),
            peak=float(item.get("peak", 0.0)),
        )
        for idx, item in enumerate(payload.get("words", []))
    ]
    return AudioAnalysis(
        audio_path=Path(payload.get("audio_path", "")),
        sample_rate=int(payload.get("sample_rate", 0)),
        words=words,
    )


def word_timings_to_dict(transcript: Transcript) -> Dict[str, Any]:
    words_payload = []
    for segment in transcript.segments:
        for word in segment.words:
            words_payload.append(
                {
                    "index": word.index,
                    "segment_index": segment.index,
                    "text": word.text,
                    "start": word.start,
                    "end": word.end,
                    "duration": word.duration,
                    "probability": word.probability,
                }
            )
    return {
        "audio_path": str(transcript.audio_path),
        "model_name": transcript.model_name,
        "language": transcript.language,
        "words": words_payload,
    }
