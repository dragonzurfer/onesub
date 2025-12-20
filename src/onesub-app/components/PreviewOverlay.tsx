"use client";

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RenderSettings } from "./SettingsPanel";

const PREVIEW_SIZE_SCALE = 0.3;
const PREVIEW_MIN_SIZE = 8;
type TimelineWord = {
  id: number;
  text: string;
  start: number;
  end: number;
  rms?: number;
};

type SegmentWithWords = {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: TimelineWord[];
};

type Placement = { x: number; y: number };

interface PreviewOverlayProps {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  segments: SegmentWithWords[];
  settings: RenderSettings;
  placements: Record<number, Placement>;
  onPlacementChange(segmentId: number, placement: Placement): void;
  onActiveSegmentChange?(segmentId: number | null): void;
}

const DEFAULT_PLACEMENT: Placement = { x: 0.5, y: 0.82 };

export function PreviewOverlay({
  videoRef,
  segments,
  settings,
  placements,
  onPlacementChange,
  onActiveSegmentChange,
}: PreviewOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const videoElement = videoRef.current;
  const lineHeightStyle = settings.lineSpacing > 0 ? `calc(1em + ${settings.lineSpacing}px)` : undefined;
  const baseScaledSize = useMemo(
    () => Math.max(PREVIEW_MIN_SIZE, Math.round(((settings.sizeMin + settings.sizeMax) / 2) * PREVIEW_SIZE_SCALE)),
    [settings.sizeMin, settings.sizeMax]
  );

  const pickFontFamily = useCallback(
    (size: number) => {
      const band = settings.fontBands?.find(
        (entry) =>
          typeof entry.minSize === "number" &&
          typeof entry.maxSize === "number" &&
          size >= entry.minSize &&
          size <= entry.maxSize &&
          entry.font.trim() !== ""
      );
      const font = band?.font?.trim() || settings.defaultFont || "Arial";
      return font;
    },
    [settings.fontBands, settings.defaultFont]
  );

  const globalRmsRange = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    segments.forEach((segment) => {
      (segment.words ?? []).forEach((word) => {
        if (typeof word.rms === "number") {
          if (word.rms < min) {
            min = word.rms;
          }
          if (word.rms > max) {
            max = word.rms;
          }
        }
      });
    });
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 };
    }
    return { min, max };
  }, [segments]);

  type WordStyle = { size: number; font: string };

  const computeWordStyles = useCallback(
    (words: TimelineWord[]): Map<number, WordStyle> => {
      if (!words.length) {
        return new Map();
      }
      const rmsValues = words
        .map((word) => (typeof word.rms === "number" ? word.rms : null))
        .filter((value): value is number => value !== null);

      const hasLocal = rmsValues.length > 0;
      const localMin = hasLocal ? Math.min(...rmsValues) : globalRmsRange.min;
      const localMax = hasLocal ? Math.max(...rmsValues) : globalRmsRange.max;
      const useLocal = hasLocal && localMax > localMin;

      const minRef = useLocal ? localMin : globalRmsRange.min;
      const maxRef = useLocal ? localMax : globalRmsRange.max;
      const span = Math.max(0, settings.sizeMax - settings.sizeMin);

      const styles = new Map<number, WordStyle>();
      words.forEach((word) => {
        const rms = typeof word.rms === "number" ? word.rms : null;
        let normalized = 0.5;
        if (rms !== null && maxRef > minRef) {
          normalized = (rms - minRef) / (maxRef - minRef);
        }
        normalized = Math.max(0, Math.min(1, normalized));
        const absoluteSize = settings.sizeMin + normalized * span;
        const font = pickFontFamily(absoluteSize);
        const scaledSize = Math.max(PREVIEW_MIN_SIZE, Math.round(absoluteSize * PREVIEW_SIZE_SCALE));
        styles.set(word.id, { size: scaledSize, font });
      });
      return styles;
    },
    [globalRmsRange.max, globalRmsRange.min, pickFontFamily, settings.sizeMax, settings.sizeMin]
  );

  const layoutWords = useCallback(
    (wordsToLayout: TimelineWord[], wordStyles: Map<number, WordStyle>): TimelineWord[][] => {
      if (wordsToLayout.length === 0) {
        return [];
      }
      const lines: TimelineWord[][] = [];
      let currentLine: TimelineWord[] = [];
      let currentMax = 0;
      let limitIndex = 0;
      const limits = settings.lineWordLimits ?? [];
      let currentLimit = typeof limits[limitIndex] === "number" ? limits[limitIndex] : undefined;

      wordsToLayout.forEach((word) => {
        const style = wordStyles.get(word.id);
        const size = style?.size ?? settings.sizeMin;
        const exceedsSize = currentLine.length > 0 && size > currentMax;
        const exceedsCount = currentLine.length > 0 && currentLimit !== undefined && currentLine.length >= currentLimit;

        if (currentLine.length === 0 || (!exceedsSize && !exceedsCount)) {
          currentLine.push(word);
          if (size > currentMax) {
            currentMax = size;
          }
          return;
        }

        lines.push(currentLine);
        if (limitIndex + 1 < limits.length) {
          limitIndex += 1;
          currentLimit = limits[limitIndex];
        } else {
          currentLimit = undefined;
        }
        currentLine = [word];
        currentMax = size;
      });

      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
      return lines;
    },
    [settings.lineWordLimits, settings.sizeMin]
  );

  useEffect(() => {
    if (!videoElement) {
      return;
    }
    const handleTimeUpdate = () => setCurrentTime(videoElement.currentTime);
    videoElement.addEventListener("timeupdate", handleTimeUpdate);
    handleTimeUpdate();
    return () => videoElement.removeEventListener("timeupdate", handleTimeUpdate);
  }, [videoElement]);

  const activeSegment = useMemo(
    () => segments.find((segment) => currentTime >= segment.start && currentTime <= segment.end),
    [segments, currentTime]
  );

  useEffect(() => {
    onActiveSegmentChange?.(activeSegment?.id ?? null);
  }, [activeSegment, onActiveSegmentChange]);

  const previewContent = useMemo(() => {
    if (!activeSegment) {
      return {
        lines: [] as TimelineWord[][],
        styles: new Map<number, WordStyle>(),
        baseFont: pickFontFamily((settings.sizeMin + settings.sizeMax) / 2),
      };
    }

    const baseWords =
      (activeSegment.words && activeSegment.words.length > 0)
        ? [...activeSegment.words]
        : (activeSegment.text || "")
            .split(/\s+/)
            .filter(Boolean)
            .map((text, index) => ({
              id: activeSegment.id * 1000 + index,
              text,
              start: activeSegment.start,
              end: activeSegment.end,
            }));

    if (baseWords.length === 0) {
      return {
        lines: [] as TimelineWord[][],
        styles: new Map<number, WordStyle>(),
        baseFont: pickFontFamily((settings.sizeMin + settings.sizeMax) / 2),
      };
    }

    const wordStyles = computeWordStyles(baseWords);
    const visibleWords =
      settings.revealMode === "per_word"
        ? baseWords.filter((word) => currentTime + 0.05 >= word.start)
        : baseWords;

    if (visibleWords.length === 0) {
      return {
        lines: [] as TimelineWord[][],
        styles: wordStyles,
        baseFont: pickFontFamily((settings.sizeMin + settings.sizeMax) / 2),
      };
    }

    const lines = layoutWords(visibleWords, wordStyles);
    const representative = lines[0]?.[0];
    const representativeStyle = representative ? wordStyles.get(representative.id) : undefined;
    const baseFont = representativeStyle?.font ?? pickFontFamily((settings.sizeMin + settings.sizeMax) / 2);
    return { lines, styles: wordStyles, baseFont };
  }, [
    activeSegment,
    computeWordStyles,
    currentTime,
    layoutWords,
    pickFontFamily,
    settings.revealMode,
    settings.sizeMin,
    settings.sizeMax,
  ]);

  const textShadow = useMemo(() => {
    const outline = Math.max(0, settings.outline ?? 0);
    const shadow = Math.max(0, settings.shadow ?? 0);
    const layers: string[] = [];

    if (outline > 0) {
      const offsets = [-outline, outline];
      offsets.forEach((x) => {
        offsets.forEach((y) => {
          layers.push(`${x}px ${y}px 0 rgba(0,0,0,0.9)`);
        });
      });
    }

    if (shadow > 0) {
      layers.push(`${shadow}px ${shadow}px ${Math.max(shadow * 1.5, shadow)}px rgba(0,0,0,0.8)`);
    }

    return layers.length > 0 ? layers.join(", ") : undefined;
  }, [settings.outline, settings.shadow]);

  const placement = activeSegment
    ? placements[activeSegment.id] ?? DEFAULT_PLACEMENT
    : DEFAULT_PLACEMENT;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeSegment || !containerRef.current) {
      return;
    }
    event.preventDefault();

    const updatePlacement = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const x = Math.min(Math.max((clientX - rect.left) / rect.width, 0.05), 0.95);
      const y = Math.min(Math.max((clientY - rect.top) / rect.height, 0.05), 0.95);
      onPlacementChange(activeSegment.id, { x, y });
    };

    updatePlacement(event.clientX, event.clientY);
    setIsDragging(true);

    const handleMove = (moveEvent: PointerEvent) => {
      updatePlacement(moveEvent.clientX, moveEvent.clientY);
    };

    const handleUp = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  if (!activeSegment) {
    return <div ref={containerRef} className="pointer-events-none h-full w-full" />;
  }

  return (
    <div ref={containerRef} className="pointer-events-none relative h-full w-full">
      <div
        className="pointer-events-auto absolute flex max-w-3xl -translate-x-1/2 -translate-y-1/2 cursor-move flex-col items-center"
        style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%` }}
        onPointerDown={handlePointerDown}
      >
        <span
          className={`mb-1 inline-flex h-3 w-3 items-center justify-center rounded-full border border-white/60 bg-white/80 text-[8px] text-slate-900 transition ${
            isDragging ? "scale-110" : ""
          }`}
        >
          •
        </span>
        <div
          className="rounded-lg bg-black/70 px-4 py-2 text-center text-white shadow-[0_0_12px_rgba(0,0,0,0.7)]"
          style={{
            fontFamily: previewContent.baseFont,
            textShadow,
            lineHeight: lineHeightStyle,
            fontSize: baseScaledSize,
          }}
        >
          {previewContent.lines.length > 0 ? (
            <div className="flex flex-col items-center gap-1">
              {previewContent.lines.map((lineWords, lineIndex) => (
                <div key={`line-${lineIndex}`} className="flex flex-wrap items-baseline justify-center gap-x-2">
                  {lineWords.map((word) => {
                    const style = previewContent.styles.get(word.id);
                    const fontSize = style?.size ?? settings.sizeMin;
                    const fontFamily = style?.font ?? previewContent.baseFont;
                    return (
                      <span
                        key={word.id}
                        className="font-semibold"
                        style={{
                          fontSize,
                          fontFamily,
                          lineHeight: lineHeightStyle,
                        }}
                      >
                        {word.text}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : settings.revealMode !== "per_word" && activeSegment?.text ? (
            <span
              className="font-semibold opacity-80"
              style={{
                fontSize: baseScaledSize,
                fontFamily: previewContent.baseFont,
              }}
            >
              {activeSegment.text}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
