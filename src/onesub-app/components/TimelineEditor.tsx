"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

export type TimelineWord = {
  id: number;
  text: string;
  start: number;
  end: number;
  rms?: number;
};

export type TimelineSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: TimelineWord[];
  track?: number;
};

interface TimelineEditorProps {
  segments: TimelineSegment[];
  duration: number;
  activeSegmentId?: number | null;
  selectedSegmentIds: Set<number>;
  onSelect(segment: TimelineSegment, isMulti: boolean): void;
  onSegmentsChange(segments: TimelineSegment[]): void;
  playheadTime: number;
  onSeek(time: number): void;
}

const TIMELINE_MIN_WIDTH = 600;
const DEFAULT_PIXELS_PER_SECOND = 80;
const MIN_PIXELS_PER_SECOND = 40;
const MAX_PIXELS_PER_SECOND = 200;
const TRACK_HEIGHT = 64;
const MIN_SEGMENT_DURATION = 0.05;
const SNAP_THRESHOLD_SECONDS = 0.12;

type DragMode = "move" | "resize-start" | "resize-end";

type DragState = {
  segmentId: number;
  mode: DragMode;
  originStart: number;
  originEnd: number;
  originTrack: number;
  pointerStartX: number;
  pointerStartY: number;
};

export function TimelineEditor({
  segments,
  duration,
  activeSegmentId,
  selectedSegmentIds,
  onSelect,
  onSegmentsChange,
  playheadTime,
  onSeek,
}: TimelineEditorProps) {
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [trackCount, setTrackCount] = useState(1);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [draggingSegmentId, setDraggingSegmentId] = useState<number | null>(null);
  const playheadDragRef = useRef(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);

  const segmentsRef = useRef(segments);
  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  const maxTrackIndex = useMemo(
    () => Math.max(0, ...segments.map((segment) => segment.track ?? 0)),
    [segments]
  );

  useEffect(() => {
    setTrackCount((prev) => Math.max(prev, maxTrackIndex + 1, 1));
  }, [maxTrackIndex]);

  const trackDuration = Math.max(duration || 0, 0.5);
  const trackWidthPx = Math.max(trackDuration * pixelsPerSecond, TIMELINE_MIN_WIDTH);
  const playheadLeft = Math.min(Math.max(playheadTime, 0), trackDuration) * pixelsPerSecond;

  const timelineMarks = useMemo(() => {
    const marks: number[] = [];
    const limit = Math.ceil(trackDuration);
    const step = limit > 30 ? 5 : 1;
    for (let i = 0; i <= limit; i += step) {
      marks.push(i);
    }
    return marks;
  }, [trackDuration]);

  const snapBoundariesBase = useMemo(() => {
    const values = new Set<number>();
    segments.forEach((segment) => {
      values.add(segment.start);
      values.add(segment.end);
      (segment.words ?? []).forEach((word) => {
        values.add(word.start);
        values.add(word.end);
      });
    });
    values.add(0);
    values.add(trackDuration);
    return Array.from(values).sort((a, b) => a - b);
  }, [segments, trackDuration]);

  const snapBoundariesWithPlayhead = useMemo(() => {
    const values = new Set<number>(snapBoundariesBase);
    values.add(playheadTime);
    return Array.from(values).sort((a, b) => a - b);
  }, [snapBoundariesBase, playheadTime]);

  const snapValue = (value: number, boundaries: number[]) => {
    if (!snapEnabled || boundaries.length === 0) {
      return value;
    }
    let closest = value;
    let bestDistance = SNAP_THRESHOLD_SECONDS;
    boundaries.forEach((boundary) => {
      const distance = Math.abs(value - boundary);
      if (distance <= bestDistance) {
        closest = boundary;
        bestDistance = distance;
      }
    });
    return closest;
  };

  const snapSegmentTime = (value: number) => snapValue(value, snapBoundariesWithPlayhead);
  const snapPlayheadTime = (value: number) => snapValue(value, snapBoundariesBase);

  const updateSegments = (updated: TimelineSegment[]) => {
    onSegmentsChange(updated);
  };

  const updateSegment = (segmentId: number, updates: Partial<TimelineSegment>) => {
    const currentSegments = segmentsRef.current;
    const next = currentSegments.map((segment) =>
      segment.id === segmentId ? { ...segment, ...updates } : segment
    );
    updateSegments(next);
  };

  const handlePointerMove = (event: PointerEvent) => {
    const dragState = dragRef.current;
    if (!dragState || !tracksRef.current) {
      return;
    }

    const { segmentId, mode, originStart, originEnd, originTrack, pointerStartX, pointerStartY } = dragState;
    const deltaX = event.clientX - pointerStartX;
    const deltaY = event.clientY - pointerStartY;
    const timeDelta = deltaX / pixelsPerSecond;

    let nextStart = originStart;
    let nextEnd = originEnd;

    if (mode === "move") {
      nextStart = originStart + timeDelta;
      nextEnd = originEnd + timeDelta;
      const durationSpan = originEnd - originStart;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = durationSpan;
      }
      if (nextEnd > trackDuration) {
        nextEnd = trackDuration;
        nextStart = Math.max(0, nextEnd - durationSpan);
      }
      const snappedStart = snapSegmentTime(nextStart);
      const snappedEnd = snapSegmentTime(nextEnd);
      const startDelta = Math.abs(snappedStart - nextStart);
      const endDelta = Math.abs(snappedEnd - nextEnd);
      if (endDelta > 0 && endDelta < startDelta) {
        nextEnd = snappedEnd;
        nextStart = Math.max(0, nextEnd - durationSpan);
      } else if (snappedStart !== nextStart) {
        nextStart = snappedStart;
        nextEnd = Math.min(trackDuration, nextStart + durationSpan);
      }
    }

    if (mode === "resize-start") {
      nextStart = originStart + timeDelta;
      nextStart = snapSegmentTime(nextStart);
      nextStart = Math.min(nextStart, nextEnd - MIN_SEGMENT_DURATION);
      nextStart = Math.max(0, nextStart);
    }

    if (mode === "resize-end") {
      nextEnd = originEnd + timeDelta;
      nextEnd = snapSegmentTime(nextEnd);
      nextEnd = Math.max(nextEnd, originStart + MIN_SEGMENT_DURATION);
      nextEnd = Math.min(trackDuration, nextEnd);
    }

    let nextTrack = originTrack;
    const trackRect = tracksRef.current.getBoundingClientRect();
    const relativeY = event.clientY - trackRect.top;
    if (Math.abs(deltaY) > TRACK_HEIGHT / 3) {
      nextTrack = Math.max(0, Math.min(trackCount - 1, Math.floor(relativeY / TRACK_HEIGHT)));
    }

    updateSegment(segmentId, { start: nextStart, end: nextEnd, track: nextTrack });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
    setDraggingSegmentId(null);
    window.removeEventListener("pointermove", handlePointerMove);
  };

  const startDrag = (segment: TimelineSegment, mode: DragMode, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(segment, event.metaKey || event.ctrlKey);
    dragRef.current = {
      segmentId: segment.id,
      mode,
      originStart: segment.start,
      originEnd: segment.end,
      originTrack: segment.track ?? 0,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
    };
    setDraggingSegmentId(segment.id);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const seekFromEvent = (event: React.PointerEvent | PointerEvent) => {
    if (!tracksRef.current) {
      return;
    }
    const rect = tracksRef.current.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
    const time = x / pixelsPerSecond;
    const snapped = snapPlayheadTime(time);
    onSeek(Math.min(Math.max(snapped, 0), trackDuration));
  };

  const beginScrub = (event: React.PointerEvent | PointerEvent) => {
    if ("button" in event && event.button !== 0) {
      return;
    }
    seekFromEvent(event);
    const handleMove = (moveEvent: PointerEvent) => {
      if (!playheadDragRef.current) {
        return;
      }
      seekFromEvent(moveEvent);
    };
    const handleUp = () => {
      playheadDragRef.current = false;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    playheadDragRef.current = true;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };

  const handleTimelinePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    beginScrub(event);
  };

  const handlePlayheadPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    beginScrub(event);
  };

  const tracks = useMemo(() => {
    const arranged: TimelineSegment[][] = Array.from({ length: trackCount }, () => []);
    segments.forEach((segment) => {
      const track = Math.max(0, Math.min(trackCount - 1, segment.track ?? 0));
      arranged[track].push(segment);
    });
    arranged.forEach((trackSegments) => trackSegments.sort((a, b) => a.start - b.start));
    return arranged;
  }, [segments, trackCount]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Timeline</h3>
          <p className="text-xs text-slate-500">
            Click the timeline background to seek. Cmd/Ctrl+Click to multiselect segments for adjustment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <label className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Zoom</span>
            <input
              type="range"
              min={MIN_PIXELS_PER_SECOND}
              max={MAX_PIXELS_PER_SECOND}
              value={pixelsPerSecond}
              onChange={(event) => setPixelsPerSecond(Number(event.target.value))}
              className="h-1 w-24 accent-primary-400"
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(event) => setSnapEnabled(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-primary-400"
            />
            Snap to words
          </label>
          <button
            type="button"
            onClick={() => setTrackCount((prev) => prev + 1)}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-primary-500 hover:text-primary-200"
          >
            + Add track
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <div className="relative">
          <div
            ref={timelineScrollRef}
            className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/80"
          >
            <div
              ref={tracksRef}
              className="relative"
              style={{ width: `${trackWidthPx}px`, height: `${trackCount * TRACK_HEIGHT}px` }}
              onPointerDown={handleTimelinePointerDown}
            >
              {tracks.map((trackSegments, trackIndex) => (
                <div
                  key={`track-${trackIndex}`}
                  className="absolute left-0 w-full border-b border-slate-800/70"
                  style={{ top: `${trackIndex * TRACK_HEIGHT}px`, height: `${TRACK_HEIGHT}px` }}
                >
                  {trackSegments.map((segment) => {
                    const widthPx = Math.max((segment.end - segment.start) * pixelsPerSecond, 8);
                    const leftPx = segment.start * pixelsPerSecond;
                    const isActive = segment.id === activeSegmentId;
                    const isSelected = selectedSegmentIds.has(segment.id);
                    const isDragging = draggingSegmentId === segment.id;
                    return (
                      <div
                        key={segment.id}
                        className={clsx(
                          "absolute top-2 flex h-[calc(100%-16px)] items-center rounded-md border text-xs font-medium shadow-md transition",
                          isActive
                            ? "border-primary-300 bg-primary-500/80 text-slate-900 z-30"
                            : isSelected
                              ? "border-primary-400 bg-primary-500/60 text-slate-900 z-20"
                              : "border-primary-600 bg-primary-500/50 text-slate-900 hover:bg-primary-500/70 z-10",
                          isDragging ? "ring-2 ring-primary-200/60" : ""
                        )}
                        style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                        onPointerDown={(event) => startDrag(segment, "move", event)}
                        onClick={(event) => onSelect(segment, event.metaKey || event.ctrlKey)}
                      >
                        <div
                          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize rounded-l-md bg-black/20"
                          onPointerDown={(event) => startDrag(segment, "resize-start", event)}
                        />
                        <div className="flex-1 truncate px-3 py-1 text-center">
                          {segment.text || "(empty)"}
                        </div>
                        <div
                          className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r-md bg-black/20"
                          onPointerDown={(event) => startDrag(segment, "resize-end", event)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}

              <div className="pointer-events-none absolute bottom-1 left-0 text-[10px] text-slate-500">
                {timelineMarks.map((mark) => (
                  <span
                    key={mark}
                    className="absolute"
                    style={{
                      left: `${mark * pixelsPerSecond}px`,
                      transform: mark === 0 ? "translateX(0)" : "translateX(-50%)",
                    }}
                  >
                    {mark}s
                  </span>
                ))}
              </div>
              <div
                className="pointer-events-none absolute top-0 z-40 h-full w-px bg-rose-500/80"
                style={{ left: `${playheadLeft}px` }}
              />
              <div
                className="absolute -top-2 z-40 h-4 w-4 -translate-x-1/2 rounded-full border border-rose-300 bg-rose-500 shadow"
                style={{ left: `${playheadLeft}px` }}
                onPointerDown={handlePlayheadPointerDown}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
