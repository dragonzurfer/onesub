"use client";

import { useMemo, useRef } from "react";
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
};

interface TimelineEditorProps {
  segments: TimelineSegment[];
  duration: number;
  activeSegmentId?: number | null;
  onSeek(segment: TimelineSegment): void;
}

const TIMELINE_MIN_WIDTH = 600;
const TIMELINE_PIXELS_PER_SECOND = 80;

export function TimelineEditor({ segments, duration, activeSegmentId, onSeek }: TimelineEditorProps) {
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const trackDuration = Math.max(duration || 0, 0.5);
  const trackWidthPx = Math.max(trackDuration * TIMELINE_PIXELS_PER_SECOND, TIMELINE_MIN_WIDTH);

  const timelineMarks = useMemo(() => {
    const marks: number[] = [];
    const limit = Math.ceil(trackDuration);
    const step = limit > 30 ? 5 : 1;
    for (let i = 0; i <= limit; i += step) {
      marks.push(i);
    }
    return marks;
  }, [trackDuration]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">Timeline</h3>
        <p className="text-xs text-slate-500">
          Click a caption to jump the playhead and adjust placements in the preview.
        </p>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4">
        <div className="relative">
          <div
            ref={timelineScrollRef}
            className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/80"
          >
            <div className="relative h-20" style={{ width: `${trackWidthPx}px` }}>
              {segments.map((segment) => {
                const widthPx = Math.max((segment.end - segment.start) * TIMELINE_PIXELS_PER_SECOND, 4);
                const leftPx = segment.start * TIMELINE_PIXELS_PER_SECOND;
                const isActive = segment.id === activeSegmentId;
                return (
                  <button
                    key={segment.id}
                    type="button"
                    className={clsx(
                      "absolute flex h-full items-center justify-center truncate rounded-md border px-3 py-2 text-xs font-medium shadow-md transition",
                      isActive
                        ? "border-primary-300 bg-primary-500/80 text-slate-900"
                        : "border-primary-600 bg-primary-500/50 text-slate-900 hover:bg-primary-500/70"
                    )}
                    style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                    onClick={() => onSeek(segment)}
                  >
                    {segment.text || "(empty)"}
                  </button>
                );
              })}

              <div className="pointer-events-none absolute bottom-1 left-0 text-[10px] text-slate-500">
                {timelineMarks.map((mark) => (
                  <span
                    key={mark}
                    className="absolute"
                    style={{
                      left: `${mark * TIMELINE_PIXELS_PER_SECOND}px`,
                      transform: mark === 0 ? "translateX(0)" : "translateX(-50%)",
                    }}
                  >
                    {mark}s
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
