"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "../components/VideoPlayer";
import { TimelineEditor, TimelineSegment, TimelineWord } from "../components/TimelineEditor";
import { SettingsPanel, RenderSettings } from "../components/SettingsPanel";
import { PreviewOverlay } from "../components/PreviewOverlay";

type Placement = { x: number; y: number };

const API_BASE = process.env.NEXT_PUBLIC_ONESUB_API ?? "http://localhost:8080";
const DEFAULT_PLACEMENT: Placement = { x: 0.5, y: 0.82 };

export default function Page() {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [placements, setPlacements] = useState<Record<number, Placement>>({});
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [settings, setSettings] = useState<RenderSettings>({
    sizeMin: 50,
    sizeMax: 90,
    revealMode: "per_word",
    mode: "fixed_count",
    wordsPerCaption: 6,
    intervalSeconds: 3,
    rollingWindow: 6,
    alignment: 7,
    defaultFont: "Arial",
    fontBands: [],
    outline: 2,
    shadow: 1,
    lineSpacing: 4,
    lineWordLimits: [3],
  });
  const [duration, setDuration] = useState<number>(0);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);

  const sizeOptions = useMemo(
    () => Array.from({ length: 101 }, (_, index) => 50 + index),
    []
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadFonts = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/fonts`);
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }
        const payload = await response.json();
        if (!cancelled && Array.isArray(payload.fonts)) {
          setAvailableFonts(payload.fonts as string[]);
        }
      } catch (err) {
        console.warn("Unable to load fonts, falling back to defaults", err);
      }
    };
    loadFonts();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyDisplayMode = useCallback(
    (inputSegments: TimelineSegment[]): TimelineSegment[] => {
      if (settings.mode === "fixed_count" && settings.wordsPerCaption > 0) {
        const groups: TimelineSegment[] = [];
        inputSegments.forEach((segment) => {
          const words = segment.words ?? [];
          if (words.length === 0) {
            groups.push(segment);
            return;
          }
          for (let i = 0; i < words.length; i += settings.wordsPerCaption) {
            const chunk = words.slice(i, i + settings.wordsPerCaption);
            const start = chunk[0]?.start ?? segment.start;
            const end = chunk[chunk.length - 1]?.end ?? segment.end;
            groups.push({
              id: segment.id * 1000 + i,
              start,
              end,
              text: chunk.map((word) => word.text).join(" "),
              words: chunk,
            });
          }
        });
        return groups;
      }

      if (settings.mode === "fixed_interval" && settings.intervalSeconds > 0.1) {
        const groups: TimelineSegment[] = [];
        type GroupState = { id: number; start: number; end: number };
        let currentGroup: GroupState | null = null;
        let currentWords: TimelineWord[] = [];
        inputSegments.forEach((segment) => {
          const words = segment.words ?? [];
          words.forEach((word) => {
            if (!currentGroup) {
              currentGroup = {
                id: segment.id * 1000 + word.id,
                start: word.start,
                end: word.end,
              };
              currentWords = [word];
              return;
            }
            if (word.start - currentGroup.start > settings.intervalSeconds) {
              const groupState = currentGroup as GroupState;
              groups.push({
                id: groupState.id,
                start: groupState.start,
                end: currentWords[currentWords.length - 1]?.end ?? groupState.end,
                text: currentWords.map((w) => w.text).join(" "),
                words: [...currentWords],
              });
              currentGroup = {
                id: segment.id * 1000 + word.id,
                start: word.start,
                end: word.end,
              };
              currentWords = [word];
              return;
            }
            currentWords.push(word);
            const groupState = currentGroup as GroupState;
            currentGroup = {
              id: groupState.id,
              start: groupState.start,
              end: word.end,
            };
          });
        });
        if (currentGroup) {
          const groupState = currentGroup as GroupState;
          groups.push({
            id: groupState.id,
            start: groupState.start,
            end: currentWords[currentWords.length - 1]?.end ?? groupState.end,
            text: currentWords.map((w) => w.text).join(" "),
            words: [...currentWords],
          });
        }
        return groups;
      }

      return inputSegments;
    },
    [settings.mode, settings.wordsPerCaption, settings.intervalSeconds]
  );

  const normaliseSegmentsAndPlacements = useCallback((nextSegments: TimelineSegment[]) => {
    setSegments(nextSegments);
    setPlacements((prev) => {
      const next: Record<number, Placement> = {};
      nextSegments.forEach((segment) => {
        next[segment.id] = prev[segment.id] ?? { ...DEFAULT_PLACEMENT };
      });
      return next;
    });
  }, []);

  const handleVideoUpload = useCallback(async (file: File) => {
    setStatus("Uploading and transcribing…");
    setError(null);
    setRenderUrl(null);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Upload failed");
      }

      const absoluteMediaUrl: string = typeof payload.mediaUrl === "string" && payload.mediaUrl.startsWith("http")
        ? payload.mediaUrl
        : `${API_BASE}${payload.mediaUrl}`;

      setMediaUrl(absoluteMediaUrl);
      setToken(payload.token);

      const mappedSegments: TimelineSegment[] = (payload.segments ?? []).map((segment: any) => ({
        id: segment.id ?? segment.index ?? Date.now(),
        start: segment.start ?? 0,
        end: segment.end ?? 0,
        text: segment.text ?? "",
        words: (segment.words ?? []).map((word: any) => ({
          id: word.id ?? word.index ?? Date.now(),
          text: word.text ?? "",
          start: word.start ?? 0,
          end: word.end ?? 0,
          rms: word.rms ?? 0,
        })),
      }));

      const regrouped = applyDisplayMode(mappedSegments);
      normaliseSegmentsAndPlacements(regrouped);

      const maxEnd = mappedSegments.length > 0 ? Math.max(...mappedSegments.map((segment) => segment.end)) : 0;
      const reportedDuration = typeof payload.duration === "number" ? payload.duration : 0;
      setDuration(Math.max(maxEnd, reportedDuration));
      setActiveSegmentId(regrouped[0]?.id ?? null);

      setStatus("Ready to review");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unexpected error");
      setStatus(null);
    }
  }, [applyDisplayMode, normaliseSegmentsAndPlacements]);

  const handleLoadedMetadata = useCallback((seconds: number) => {
    if (seconds > 0) {
      setDuration(seconds);
    }
  }, []);

  const handlePlacementChange = useCallback((segmentId: number, placement: Placement) => {
    setPlacements((prev) => ({ ...prev, [segmentId]: placement }));
  }, []);

  const handleTimelineSeek = useCallback(
    (segment: TimelineSegment) => {
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.currentTime = Math.max(0, Math.min(segment.start, Number.isFinite(videoEl.duration) ? videoEl.duration : segment.start));
      }
      setActiveSegmentId(segment.id);
    },
    []
  );

  const previewSegments = useMemo(
    () => segments.map((segment) => ({ ...segment, words: segment.words ?? [] })),
    [segments]
  );

  useEffect(() => {
    setSegments((previousSegments) => {
      const regrouped = applyDisplayMode(previousSegments);
      setPlacements((prevPlacements) => {
        const next: Record<number, Placement> = {};
        regrouped.forEach((segment) => {
          next[segment.id] = prevPlacements[segment.id] ?? { ...DEFAULT_PLACEMENT };
        });
        return next;
      });
      setActiveSegmentId((prevActive) => (regrouped.some((segment) => segment.id === prevActive)
        ? prevActive
        : regrouped[0]?.id ?? null));
      return regrouped;
    });
  }, [applyDisplayMode, settings.mode, settings.wordsPerCaption, settings.intervalSeconds, settings.rollingWindow]);

  const handleRender = useCallback(async () => {
    if (!token) {
      setError("Upload a video before rendering.");
      return;
    }
    setRendering(true);
    setError(null);
    setStatus("Rendering…");
    setRenderUrl(null);

    try {
      const response = await fetch(`${API_BASE}/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          settings,
          segments: segments.map(({ id, start, end, text }) => ({ id, start, end, text })),
          placements: segments.map((segment) => {
            const placement = placements[segment.id] ?? DEFAULT_PLACEMENT;
            return {
              segmentId: segment.id,
              start: segment.start,
              end: segment.end,
              width: Number(placement.x.toFixed(3)),
              height: Number(placement.y.toFixed(3)),
            };
          }),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Render failed");
      }
      const renderPath: unknown = payload.renderUrl;
      if (typeof renderPath === "string" && renderPath.length > 0) {
        const absoluteRenderUrl: string = renderPath.startsWith("http")
          ? renderPath
          : `${API_BASE}${renderPath}`;
        setRenderUrl(absoluteRenderUrl);
      }
      setStatus(typeof payload.message === "string" ? payload.message : "Render complete");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unexpected error during render");
      setStatus(null);
    } finally {
      setRendering(false);
    }
  }, [segments, placements, settings, token]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(280px,2fr)]">
        <div className="flex flex-col gap-6">
          <div className="space-y-4">
            <VideoPlayer
              videoRef={videoRef}
              src={mediaUrl}
              onUpload={handleVideoUpload}
              onLoadedMetadata={handleLoadedMetadata}
              overlay={
                <PreviewOverlay
                  videoRef={videoRef}
                  segments={previewSegments}
                  settings={settings}
                  placements={placements}
                  onPlacementChange={handlePlacementChange}
                  onActiveSegmentChange={setActiveSegmentId}
                />
              }
            />
            {status && <p className="text-sm text-slate-300">{status}</p>}
            {error && <p className="text-sm text-rose-400">{error}</p>}
            {renderUrl && (
              <p className="text-sm text-emerald-400">
                Render ready: <a className="underline" href={renderUrl} target="_blank" rel="noreferrer">Download video</a>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/20">
            <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Timeline &amp; Windows</h2>
                <p className="text-sm text-slate-400">
                  Click a caption below to move the playhead, then adjust placements directly on the preview.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRender}
                disabled={!token || rendering}
                className="self-start rounded-lg border border-primary-500/60 px-4 py-2 text-sm font-medium text-primary-100 hover:bg-primary-500/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500 lg:self-center"
              >
                {rendering ? "Rendering…" : "Render output"}
              </button>
            </div>
            <TimelineEditor
              segments={segments}
              duration={duration}
              activeSegmentId={activeSegmentId}
              onSeek={handleTimelineSeek}
            />
          </div>
        </div>

        <SettingsPanel settings={settings} onChange={setSettings} availableFonts={availableFonts} sizeOptions={sizeOptions} />
      </section>
    </div>
  );
}
