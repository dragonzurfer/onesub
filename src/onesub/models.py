from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional


@dataclass
class WordTiming:
    index: int
    text: str
    start: float
    end: float
    probability: Optional[float] = None

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class Segment:
    index: int
    start: float
    end: float
    text: str
    words: List[WordTiming]


@dataclass
class Transcript:
    audio_path: Path
    model_name: str
    language: Optional[str]
    segments: List[Segment]

    def flatten_words(self) -> List[WordTiming]:
        return [word for segment in self.segments for word in segment.words]


@dataclass
class WordDynamics:
    word_index: int
    start: float
    end: float
    rms: float
    peak: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass
class AudioAnalysis:
    audio_path: Path
    sample_rate: int
    words: List[WordDynamics]

    @property
    def rms_min(self) -> float:
        return min((w.rms for w in self.words), default=0.0)

    @property
    def rms_max(self) -> float:
        return max((w.rms for w in self.words), default=0.0)

    @property
    def peak_min(self) -> float:
        return min((w.peak for w in self.words), default=0.0)

    @property
    def peak_max(self) -> float:
        return max((w.peak for w in self.words), default=0.0)

