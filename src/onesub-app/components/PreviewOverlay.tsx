"use client";

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontStyle, RenderSettings } from "./SettingsPanel";

const PREVIEW_MIN_SIZE = 8;
const SIZE_MIN = 10;
const SIZE_MAX = 3000;
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

type SubtitleOverride = {
  sizeMin?: number;
  sizeMax?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  lineSpacing?: number;
  fontFamily?: string;
  fontStyle?: FontStyle;
  fontColor?: string;
  shadowColor?: string;
  writeOnKeyframes?: { time: number; value: number }[];
};

interface PreviewOverlayProps {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  segments: SegmentWithWords[];
  settings: RenderSettings;
  placements: Record<number, Placement>;
  segmentOverrides?: Record<number, SubtitleOverride>;
  onPlacementChange(segmentId: number, placement: Placement): void;
  onSizeChange(segmentId: number, sizeMin: number, sizeMax: number): void;
  onActiveSegmentChange?(segmentId: number | null): void;
}

const DEFAULT_PLACEMENT: Placement = { x: 0.5, y: 0.82 };
const resolveFontStyle = (style?: FontStyle) => {
  switch (style) {
    case "italic":
      return { fontWeight: 400, fontStyle: "italic" as const };
    case "bold_italic":
      return { fontWeight: 700, fontStyle: "italic" as const };
    case "regular":
      return { fontWeight: 400, fontStyle: "normal" as const };
    case "bold":
    default:
      return { fontWeight: 700, fontStyle: "normal" as const };
  }
};

export function PreviewOverlay({
  videoRef,
  segments,
  settings,
  placements,
  segmentOverrides,
  onPlacementChange,
  onSizeChange,
  onActiveSegmentChange,
}: PreviewOverlayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [draggingSegmentId, setDraggingSegmentId] = useState<number | null>(null);
  const [videoBox, setVideoBox] = useState<{ left: number; top: number; width: number; height: number } | null>(
    null
  );
  const resizeRef = useRef<{
    segmentId: number;
    startY: number;
    startMin: number;
    startMax: number;
  } | null>(null);
  const videoElement = videoRef.current;

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

  const updateVideoBox = useCallback(() => {
    if (!containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const videoWidth = videoElement?.videoWidth ?? rect.width;
    const videoHeight = videoElement?.videoHeight ?? rect.height;
    if (videoWidth <= 0 || videoHeight <= 0) {
      setVideoBox({ left: 0, top: 0, width: rect.width, height: rect.height });
      return;
    }
    const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
    const width = videoWidth * scale;
    const height = videoHeight * scale;
    const left = (rect.width - width) / 2;
    const top = (rect.height - height) / 2;
    setVideoBox({ left, top, width, height });
  }, [videoElement]);

  useEffect(() => {
    updateVideoBox();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => updateVideoBox());
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateVideoBox]);

  useEffect(() => {
    if (!videoElement) {
      return;
    }
    const handleLoaded = () => updateVideoBox();
    videoElement.addEventListener("loadedmetadata", handleLoaded);
    return () => videoElement.removeEventListener("loadedmetadata", handleLoaded);
  }, [updateVideoBox, videoElement]);

  const previewScale = useMemo(() => {
    if (!videoBox) {
      return 0.3;
    }
    const baseWidth = settings.videoWidth && settings.videoWidth > 0
      ? settings.videoWidth
      : (videoElement?.videoWidth || 1920);
    const baseHeight = settings.videoHeight && settings.videoHeight > 0
      ? settings.videoHeight
      : (videoElement?.videoHeight || 1080);
    return Math.min(videoBox.width / baseWidth, videoBox.height / baseHeight);
  }, [settings.videoHeight, settings.videoWidth, videoBox, videoElement?.videoHeight, videoElement?.videoWidth]);

  const defaultPlacement = useMemo(
    () => ({
      x: Math.min(1, Math.max(0, settings.defaultPositionX ?? DEFAULT_PLACEMENT.x)),
      y: Math.min(1, Math.max(0, settings.defaultPositionY ?? DEFAULT_PLACEMENT.y)),
    }),
    [settings.defaultPositionX, settings.defaultPositionY]
  );

  const computeWordStyles = useCallback(
    (words: TimelineWord[], sizeMin: number, sizeMax: number, fontOverride?: string): Map<number, WordStyle> => {
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
      const span = Math.max(0, sizeMax - sizeMin);

      const styles = new Map<number, WordStyle>();
      words.forEach((word) => {
        const rms = typeof word.rms === "number" ? word.rms : null;
        let normalized = 0.5;
        if (rms !== null && maxRef > minRef) {
          normalized = (rms - minRef) / (maxRef - minRef);
        }
        normalized = Math.max(0, Math.min(1, normalized));
        const absoluteSize = sizeMin + normalized * span;
        const font = fontOverride || pickFontFamily(absoluteSize);
        const scaledSize = Math.max(PREVIEW_MIN_SIZE, Math.round(absoluteSize * previewScale));
        styles.set(word.id, { size: scaledSize, font });
      });
      return styles;
    },
    [globalRmsRange.max, globalRmsRange.min, pickFontFamily, previewScale]
  );

  const normalizeWriteOnKeyframes = useCallback(
    (frames: { time: number; value: number }[], start: number, end: number) => {
      const clamped = frames
        .map((frame) => ({
          time: Math.min(Math.max(frame.time, start), end),
          value: Math.min(1, Math.max(0, frame.value)),
        }))
        .sort((a, b) => a.time - b.time);
      const merged: { time: number; value: number }[] = [];
      clamped.forEach((frame) => {
        const last = merged[merged.length - 1];
        if (last && Math.abs(last.time - frame.time) < 0.001) {
          last.value = frame.value;
        } else {
          merged.push({ ...frame });
        }
      });
      for (let i = 1; i < merged.length; i += 1) {
        if (merged[i].value < merged[i - 1].value) {
          merged[i].value = merged[i - 1].value;
        }
      }
      return merged;
    },
    []
  );

  const writeOnProgressAt = useCallback((frames: { time: number; value: number }[], time: number) => {
    if (frames.length === 0) {
      return null;
    }
    if (time <= frames[0].time) {
      return frames[0].value;
    }
    for (let i = 0; i < frames.length - 1; i += 1) {
      const current = frames[i];
      const next = frames[i + 1];
      if (time <= next.time) {
        const span = next.time - current.time;
        if (span <= 0) {
          return next.value;
        }
        const t = (time - current.time) / span;
        return current.value + t * (next.value - current.value);
      }
    }
    return frames[frames.length - 1].value;
  }, []);

  useEffect(() => {
    if (!videoElement) {
      return;
    }
    const handleTimeUpdate = () => setCurrentTime(videoElement.currentTime);
    videoElement.addEventListener("timeupdate", handleTimeUpdate);
    handleTimeUpdate();
    return () => videoElement.removeEventListener("timeupdate", handleTimeUpdate);
  }, [videoElement]);

  const layoutWords = useCallback(
    (wordsToLayout: TimelineWord[], wordStyles: Map<number, WordStyle>, fallbackSize: number): TimelineWord[][] => {
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
        const size = style?.size ?? fallbackSize;
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
    [settings.lineWordLimits]
  );

  const activeSegments = useMemo(
    () => segments.filter((segment) => currentTime >= segment.start && currentTime <= segment.end),
    [segments, currentTime]
  );

  const primarySegment = useMemo(() => {
    if (activeSegments.length === 0) {
      return null;
    }
    return activeSegments.reduce((latest, segment) => (segment.start >= latest.start ? segment : latest));
  }, [activeSegments]);

  useEffect(() => {
    onActiveSegmentChange?.(primarySegment?.id ?? null);
  }, [primarySegment, onActiveSegmentChange]);

  const buildTextShadow = useCallback(
    (shadowColor: string) => {
      const outline = Math.max(0, settings.outline ?? 0);
      const shadow = Math.max(0, settings.shadow ?? 0);
      const layers: string[] = [];
      const normalizedShadow = (value: string) => {
        const hex = value?.trim?.() ?? "";
        const sanitized = hex.startsWith("#") ? hex.slice(1) : hex;
        if (sanitized.length !== 6) {
          return "0,0,0";
        }
        const r = parseInt(sanitized.slice(0, 2), 16);
        const g = parseInt(sanitized.slice(2, 4), 16);
        const b = parseInt(sanitized.slice(4, 6), 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
          return "0,0,0";
        }
        return `${r},${g},${b}`;
      };
      const shadowRgb = normalizedShadow(shadowColor);

      if (outline > 0) {
        const offsets = [-outline, outline];
        offsets.forEach((x) => {
          offsets.forEach((y) => {
            layers.push(`${x}px ${y}px 0 rgba(${shadowRgb},0.9)`);
          });
        });
      }

      if (shadow > 0) {
        layers.push(`${shadow}px ${shadow}px ${Math.max(shadow * 1.5, shadow)}px rgba(${shadowRgb},0.8)`);
      }

      return layers.length > 0 ? layers.join(", ") : undefined;
    },
    [settings.outline, settings.shadow]
  );

  const getEffectiveSize = useCallback(
    (segmentId: number) => {
      const override = segmentOverrides?.[segmentId];
      let min = override?.sizeMin ?? settings.sizeMin;
      let max = override?.sizeMax ?? settings.sizeMax;
      if (max < min) {
        [min, max] = [max, min];
      }
      return { min, max };
    },
    [segmentOverrides, settings.sizeMax, settings.sizeMin]
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, segmentId: number) => {
    if (!containerRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onActiveSegmentChange?.(segmentId);

    if (event.metaKey) {
      event.stopPropagation();
      const { min, max } = getEffectiveSize(segmentId);
      resizeRef.current = {
        segmentId,
        startY: event.clientY,
        startMin: min,
        startMax: max,
      };
      setDraggingSegmentId(segmentId);

      const endResize = () => {
        if (!resizeRef.current) {
          return;
        }
        resizeRef.current = null;
        setDraggingSegmentId(null);
        window.removeEventListener("pointermove", handleResizeMove);
        window.removeEventListener("pointerup", handleResizeUp);
        window.removeEventListener("keyup", handleResizeKeyUp);
      };

      const handleResizeMove = (moveEvent: PointerEvent) => {
        const resizeState = resizeRef.current;
        if (!resizeState) {
          return;
        }
        if (!moveEvent.metaKey) {
          endResize();
          return;
        }
        const scale = Math.max(previewScale, 0.05);
        const delta = (resizeState.startY - moveEvent.clientY) / (scale * 2);
        let nextMin = resizeState.startMin + delta;
        let nextMax = resizeState.startMax + delta;
        nextMin = Math.max(SIZE_MIN, Math.min(SIZE_MAX, nextMin));
        nextMax = Math.max(SIZE_MIN, Math.min(SIZE_MAX, nextMax));
        if (nextMax < nextMin) {
          nextMax = nextMin;
        }

        onSizeChange(segmentId, nextMin, nextMax);
      };

      const handleResizeUp = () => {
        endResize();
      };

      const handleResizeKeyUp = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === "Meta") {
          endResize();
        }
      };

      window.addEventListener("pointermove", handleResizeMove);
      window.addEventListener("pointerup", handleResizeUp, { once: true });
      window.addEventListener("keyup", handleResizeKeyUp);
      return;
    }

    const updatePlacement = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const box = videoBox ?? { left: 0, top: 0, width: rect.width, height: rect.height };
      const xRaw = (clientX - rect.left - box.left) / box.width;
      const yRaw = (clientY - rect.top - box.top) / box.height;
      const x = Math.min(Math.max(xRaw, 0.02), 0.98);
      const y = Math.min(Math.max(yRaw, 0.02), 0.98);
      onPlacementChange(segmentId, { x, y });
    };

    updatePlacement(event.clientX, event.clientY);
    setDraggingSegmentId(segmentId);

    const handleMove = (moveEvent: PointerEvent) => {
      updatePlacement(moveEvent.clientX, moveEvent.clientY);
    };

    const handleUp = () => {
      setDraggingSegmentId(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const alignment = settings.alignment;
  const alignmentStyles = () => {
    switch (alignment) {
      case 1:
        return { transform: "translate(0, -100%)", alignItems: "flex-start", textAlign: "left" as const };
      case 2:
        return { transform: "translate(-50%, -100%)", alignItems: "center", textAlign: "center" as const };
      case 3:
        return { transform: "translate(-100%, -100%)", alignItems: "flex-end", textAlign: "right" as const };
      case 4:
        return { transform: "translate(0, -50%)", alignItems: "flex-start", textAlign: "left" as const };
      case 5:
        return { transform: "translate(-50%, -50%)", alignItems: "center", textAlign: "center" as const };
      case 6:
        return { transform: "translate(-100%, -50%)", alignItems: "flex-end", textAlign: "right" as const };
      case 7:
        return { transform: "translate(0, 0)", alignItems: "flex-start", textAlign: "left" as const };
      case 8:
        return { transform: "translate(-50%, 0)", alignItems: "center", textAlign: "center" as const };
      case 9:
        return { transform: "translate(-100%, 0)", alignItems: "flex-end", textAlign: "right" as const };
      default:
        return { transform: "translate(-50%, -50%)", alignItems: "center", textAlign: "center" as const };
    }
  };

  const alignmentStyle = alignmentStyles();
  const fallbackBox = {
    left: 0,
    top: 0,
    width: containerRef.current?.clientWidth ?? 0,
    height: containerRef.current?.clientHeight ?? 0,
  };
  const anchorBox = videoBox ?? fallbackBox;

  return (
    <div ref={containerRef} className="pointer-events-none relative h-full w-full">
      {activeSegments.map((segment) => {
        const overrides = segmentOverrides?.[segment.id];
        const effectiveSizeMin = overrides?.sizeMin ?? settings.sizeMin;
        const effectiveSizeMax = overrides?.sizeMax ?? settings.sizeMax;
        const effectiveLineSpacing = overrides?.lineSpacing ?? settings.lineSpacing;
        const effectiveLetterSpacing = overrides?.letterSpacing ?? settings.letterSpacing;
        const effectiveWordSpacing = overrides?.wordSpacing ?? settings.wordSpacing;
        const effectiveFontColor = overrides?.fontColor ?? settings.fontColor;
        const effectiveShadowColor = overrides?.shadowColor ?? settings.shadowColor;
        const effectiveFontStyle = overrides?.fontStyle ?? settings.fontStyle;
        const fontStyleDescriptor = resolveFontStyle(effectiveFontStyle);
        const writeOnFramesRaw = overrides?.writeOnKeyframes ?? [];
        const writeOnFrames =
          writeOnFramesRaw.length > 0
            ? normalizeWriteOnKeyframes(writeOnFramesRaw, segment.start, segment.end)
            : [];
        const writeOnProgress = writeOnFrames.length > 0 ? writeOnProgressAt(writeOnFrames, currentTime) : null;

        const scaledLineSpacing = Math.max(0, effectiveLineSpacing) * previewScale;
        const scaledLetterSpacing = effectiveLetterSpacing * previewScale;
        const scaledWordSpacing = effectiveWordSpacing * previewScale;
        const baseScaledSize = Math.max(
          PREVIEW_MIN_SIZE,
          Math.round(((effectiveSizeMin + effectiveSizeMax) / 2) * previewScale)
        );
        const fontOverride = overrides?.fontFamily?.trim() || undefined;
        const baseFontFallback = fontOverride ?? pickFontFamily((effectiveSizeMin + effectiveSizeMax) / 2);

        const baseWords =
          (segment.words && segment.words.length > 0)
            ? [...segment.words]
            : (segment.text || "")
                .split(/\s+/)
                .filter(Boolean)
                .map((text, index) => ({
                  id: segment.id * 1000 + index,
                  text,
                  start: segment.start,
                  end: segment.end,
                }));

        let previewLines: TimelineWord[][] = [];
        let wordStyles = new Map<number, WordStyle>();
        let baseFont = baseFontFallback;
        const partialReveal = new Map<number, number>();

        if (baseWords.length > 0) {
          wordStyles = computeWordStyles(baseWords, effectiveSizeMin, effectiveSizeMax, fontOverride);
          const visibleWords =
            writeOnProgress !== null
              ? (() => {
                  const totalChars = baseWords.reduce((sum, word) => sum + word.text.length, 0);
                  if (totalChars === 0 || writeOnProgress <= 0) {
                    return [];
                  }
                  const targetChars = Math.min(totalChars, Math.max(1, Math.ceil(writeOnProgress * totalChars)));
                  const visible: TimelineWord[] = [];
                  let remaining = targetChars;
                  for (const word of baseWords) {
                    if (remaining <= 0) {
                      break;
                    }
                    if (word.text.length <= remaining) {
                      visible.push(word);
                      remaining -= word.text.length;
                      continue;
                    }
                    visible.push(word);
                    partialReveal.set(word.id, remaining);
                    break;
                  }
                  return visible;
                })()
              : settings.revealMode === "per_word"
                ? baseWords.filter((word) => currentTime >= word.start)
                : baseWords;

          if (visibleWords.length > 0) {
            previewLines = layoutWords(visibleWords, wordStyles, baseScaledSize);
            const representative = previewLines[0]?.[0];
            const representativeStyle = representative ? wordStyles.get(representative.id) : undefined;
            baseFont = representativeStyle?.font ?? baseFontFallback;
          }
        }

        const textShadow = buildTextShadow(effectiveShadowColor);
        const placement = placements[segment.id] ?? defaultPlacement;
        const anchorLeft = anchorBox.left + placement.x * anchorBox.width;
        const anchorTop = anchorBox.top + placement.y * anchorBox.height;

        return (
          <div
            key={segment.id}
            className="pointer-events-auto absolute cursor-move select-none"
            style={{ left: `${anchorLeft}px`, top: `${anchorTop}px` }}
            onPointerDown={(event) => handlePointerDown(event, segment.id)}
          >
            <span
              className={`absolute inline-flex h-3 w-3 items-center justify-center rounded-full border border-white/60 bg-white/80 text-[8px] text-slate-900 transition ${
                draggingSegmentId === segment.id ? "scale-110" : ""
              }`}
              style={{ transform: "translate(-50%, -50%)" }}
            >
              .
            </span>
            <div
              className="absolute flex max-w-3xl flex-col"
              style={{
                transform: alignmentStyle.transform,
                fontFamily: baseFont,
                fontWeight: fontStyleDescriptor.fontWeight,
                fontStyle: fontStyleDescriptor.fontStyle,
                color: effectiveFontColor,
                textShadow,
                fontSize: baseScaledSize,
                alignItems: alignmentStyle.alignItems,
                textAlign: alignmentStyle.textAlign,
              }}
            >
              {previewLines.length > 0 ? (
                <div
                  className="flex flex-col"
                  style={{
                    rowGap: `${scaledLineSpacing}px`,
                  }}
                >
                  {previewLines.map((lineWords, lineIndex) => (
                    <div
                      key={`${segment.id}-line-${lineIndex}`}
                      className="flex flex-wrap items-baseline"
                      style={{
                        columnGap: `${Math.max(
                          0,
                          Math.round(
                            Math.max(
                              baseScaledSize,
                              ...lineWords.map((word) => wordStyles.get(word.id)?.size ?? baseScaledSize)
                            ) * 0.25
                          ) + scaledWordSpacing
                        )}px`,
                      }}
                    >
                      {lineWords.map((word) => {
                        const style = wordStyles.get(word.id);
                        const fontSize = style?.size ?? baseScaledSize;
                        const fontFamily = style?.font ?? baseFont;
                        const visibleCount = partialReveal.get(word.id);
                        const isPartial = visibleCount !== undefined && visibleCount < word.text.length;
                        return (
                          <span
                            key={`${segment.id}-${word.id}`}
                            style={{
                              fontSize,
                              fontFamily,
                              lineHeight: 1,
                              letterSpacing: `${scaledLetterSpacing}px`,
                            }}
                          >
                            {isPartial ? (
                              <>
                                <span>{word.text.slice(0, visibleCount)}</span>
                                <span style={{ color: "transparent", textShadow: "none" }}>
                                  {word.text.slice(visibleCount)}
                                </span>
                              </>
                            ) : (
                              word.text
                            )}
                          </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : writeOnProgress === null && settings.revealMode !== "per_word" && segment.text ? (
                <span
                  className="opacity-80"
                  style={{
                    fontSize: baseScaledSize,
                    fontFamily: baseFont,
                    letterSpacing: `${scaledLetterSpacing}px`,
                    wordSpacing: `${scaledWordSpacing}px`,
                  }}
                >
                  {segment.text}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
