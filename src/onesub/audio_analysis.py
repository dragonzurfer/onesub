from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Iterable, List

import numpy as np
import soundfile as sf
from soundfile import LibsndfileError

from .models import AudioAnalysis, WordDynamics, WordTiming

logger = logging.getLogger(__name__)


def _compute_rms(signal: np.ndarray) -> float:
    if signal.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(signal), dtype=np.float64)))


def _compute_peak(signal: np.ndarray) -> float:
    if signal.size == 0:
        return 0.0
    return float(np.max(np.abs(signal)))


def _load_waveform(audio_path: Path) -> tuple[np.ndarray, int]:
    try:
        signal, sample_rate = sf.read(str(audio_path))
        logger.info("Loaded audio via soundfile (sample_rate=%d)", sample_rate)
    except (RuntimeError, LibsndfileError) as exc:
        logger.info("soundfile failed (%s); falling back to whisper audio loader", exc)
        whisper_audio = importlib.import_module("whisper.audio")
        signal = whisper_audio.load_audio(str(audio_path))
        sample_rate = whisper_audio.SAMPLE_RATE
    if signal.ndim > 1:
        signal = signal.mean(axis=1)
    return signal, sample_rate


def analyze_word_dynamics(audio_path: Path, words: Iterable[WordTiming]) -> AudioAnalysis:
    """
    Measure RMS energy and peak amplitude for each word span.
    """
    audio_path = audio_path.expanduser().resolve()
    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    signal, sample_rate = _load_waveform(audio_path)
    logger.info("Prepared audio %s (samples=%d, sample_rate=%d)", audio_path, signal.shape[0], sample_rate)

    total_samples = signal.shape[0]
    dynamics: List[WordDynamics] = []

    for word in words:
        start_index = max(0, int(word.start * sample_rate))
        end_index = min(total_samples, int(word.end * sample_rate))
        snippet = signal[start_index:end_index]
        rms = _compute_rms(snippet)
        peak = _compute_peak(snippet)
        dynamics.append(
            WordDynamics(
                word_index=word.index,
                start=word.start,
                end=word.end,
                rms=rms,
                peak=peak,
            )
        )

    logger.info("Analyzed dynamics for %d words", len(dynamics))
    return AudioAnalysis(audio_path=audio_path, sample_rate=sample_rate, words=dynamics)
