"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VideoPlayer } from "../components/VideoPlayer";
import { TimelineEditor, TimelineSegment, TimelineWord } from "../components/TimelineEditor";
import { SettingsPanel, RenderSettings } from "../components/SettingsPanel";
import { PreviewOverlay } from "../components/PreviewOverlay";
import { SubtitleOverridesPanel, SubtitleOverride } from "../components/SubtitleOverridesPanel";

type Placement = { x: number; y: number };

const API_BASE = process.env.NEXT_PUBLIC_ONESUB_API ?? "http://localhost:8080";
const DEFAULT_PLACEMENT: Placement = { x: 0.5, y: 0.82 };
const SETTINGS_STORAGE_KEY = "onesub.defaultSettings";
const FAVORITES_STORAGE_KEY = "onesub.favoriteFonts";

const REVEAL_MODES = new Set(["block", "per_word"]);
const DISPLAY_MODES = new Set(["segment", "fixed_count", "fixed_interval", "rolling", "manual_windows"]);
const FONT_STYLES = new Set(["regular", "bold", "italic", "bold_italic"]);

const parseNumber = (value: unknown) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const parseString = (value: unknown) => (typeof value === "string" ? value : undefined);

const sanitizeFontBands = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const band = entry as Record<string, unknown>;
      const minSize = parseNumber(band.minSize);
      const maxSize = parseNumber(band.maxSize);
      const font = parseString(band.font)?.trim();
      if (minSize === undefined || maxSize === undefined || !font) {
        return null;
      }
      return { minSize, maxSize, font };
    })
    .filter((band): band is { minSize: number; maxSize: number; font: string } => band !== null);
};

const sanitizeLineWordLimits = (value: unknown, fallback: number[]) => {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const parsed = value
    .map((entry) => parseNumber(entry))
    .filter((num): num is number => num !== undefined && num > 0)
    .map((num) => Math.round(num));
  return parsed.length > 0 ? parsed : fallback;
};

const sanitizeSettings = (value: unknown, fallback: RenderSettings): RenderSettings => {
  if (!value || typeof value !== "object") {
    return fallback;
  }
  const payload = value as Record<string, unknown>;
  const next: RenderSettings = { ...fallback };

  const sizeMin = parseNumber(payload.sizeMin);
  const sizeMax = parseNumber(payload.sizeMax);
  if (sizeMin !== undefined) next.sizeMin = sizeMin;
  if (sizeMax !== undefined) next.sizeMax = sizeMax;
  const revealMode = parseString(payload.revealMode);
  if (revealMode && REVEAL_MODES.has(revealMode)) {
    next.revealMode = revealMode as RenderSettings["revealMode"];
  }
  const mode = parseString(payload.mode);
  if (mode && DISPLAY_MODES.has(mode)) {
    next.mode = mode as RenderSettings["mode"];
  }
  const wordsPerCaption = parseNumber(payload.wordsPerCaption);
  if (wordsPerCaption !== undefined) next.wordsPerCaption = Math.round(wordsPerCaption);
  const intervalSeconds = parseNumber(payload.intervalSeconds);
  if (intervalSeconds !== undefined) next.intervalSeconds = intervalSeconds;
  const rollingWindow = parseNumber(payload.rollingWindow);
  if (rollingWindow !== undefined) next.rollingWindow = Math.round(rollingWindow);
  const alignment = parseNumber(payload.alignment);
  if (alignment !== undefined) next.alignment = Math.round(alignment);
  const defaultFont = parseString(payload.defaultFont);
  if (defaultFont) next.defaultFont = defaultFont;
  const fontStyle = parseString(payload.fontStyle);
  if (fontStyle && FONT_STYLES.has(fontStyle)) {
    next.fontStyle = fontStyle as RenderSettings["fontStyle"];
  }
  const outline = parseNumber(payload.outline);
  if (outline !== undefined) next.outline = outline;
  const shadow = parseNumber(payload.shadow);
  if (shadow !== undefined) next.shadow = shadow;
  const lineSpacing = parseNumber(payload.lineSpacing);
  if (lineSpacing !== undefined) next.lineSpacing = lineSpacing;
  const letterSpacing = parseNumber(payload.letterSpacing);
  if (letterSpacing !== undefined) next.letterSpacing = letterSpacing;
  const wordSpacing = parseNumber(payload.wordSpacing);
  if (wordSpacing !== undefined) next.wordSpacing = wordSpacing;
  const defaultPositionX = parseNumber(payload.defaultPositionX);
  if (defaultPositionX !== undefined) next.defaultPositionX = defaultPositionX;
  const defaultPositionY = parseNumber(payload.defaultPositionY);
  if (defaultPositionY !== undefined) next.defaultPositionY = defaultPositionY;
  const fontColor = parseString(payload.fontColor);
  if (fontColor) next.fontColor = fontColor;
  const shadowColor = parseString(payload.shadowColor);
  if (shadowColor) next.shadowColor = shadowColor;

  next.fontBands = sanitizeFontBands(payload.fontBands);
  next.lineWordLimits = sanitizeLineWordLimits(payload.lineWordLimits, next.lineWordLimits);

  if (next.sizeMax < next.sizeMin) {
    next.sizeMax = next.sizeMin;
  }

  return next;
};

const serializeSettings = (settings: RenderSettings) => {
  const { videoWidth, videoHeight, ...rest } = settings;
  return rest;
};

function formatSRTTime(seconds: number): string {
  const date = new Date(0);
  date.setMilliseconds(seconds * 1000);
  const hh = date.getUTCHours().toString().padStart(2, "0");
  const mm = date.getUTCMinutes().toString().padStart(2, "0");
  const ss = date.getUTCSeconds().toString().padStart(2, "0");
  const ms = date.getUTCMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

const tokenizeCaption = (text: string): string[] => {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split(/\s+/);
};

const applyTextToSegmentWords = (segment: TimelineSegment, text: string): TimelineSegment => {
  if (!segment.words || segment.words.length === 0) {
    return { ...segment, text };
  }
  const tokens = tokenizeCaption(text);
  const words = segment.words.map((word) => ({ ...word }));
  if (tokens.length === 0) {
    return { ...segment, text, words: words.map((word) => ({ ...word, text: "" })) };
  }
  if (tokens.length >= words.length) {
    const lastIndex = words.length - 1;
    for (let i = 0; i < lastIndex; i += 1) {
      words[i].text = tokens[i] ?? "";
    }
    words[lastIndex].text = tokens.slice(lastIndex).join(" ");
    return { ...segment, text, words };
  }
  for (let i = 0; i < words.length; i += 1) {
    words[i].text = tokens[i] ?? "";
  }
  return { ...segment, text, words };
};

const isSafeId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;

const resolveGroupId = (
  candidate: number | undefined,
  fallback: number | undefined,
  used: Set<number>,
  nextId: () => number
) => {
  if (isSafeId(candidate) && !used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  if (isSafeId(fallback) && !used.has(fallback)) {
    used.add(fallback);
    return fallback;
  }
  let generated = nextId();
  while (used.has(generated)) {
    generated = nextId();
  }
  used.add(generated);
  return generated;
};

export default function Page() {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<TimelineSegment[]>([]);
  const [placements, setPlacements] = useState<Record<number, Placement>>({});
  const [segmentOverrides, setSegmentOverrides] = useState<Record<number, SubtitleOverride>>({});
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [settings, setSettings] = useState<RenderSettings>({
    sizeMin: 50,
    sizeMax: 90,
    revealMode: "per_word",
    mode: "fixed_count",
    wordsPerCaption: 6,
    intervalSeconds: 3,
    rollingWindow: 6,
    alignment: 5,
    defaultFont: "Arial",
    fontStyle: "bold",
    fontBands: [],
    outline: 2,
    shadow: 1,
    lineSpacing: 4,
    letterSpacing: 0,
    wordSpacing: 0,
    defaultPositionX: DEFAULT_PLACEMENT.x,
    defaultPositionY: DEFAULT_PLACEMENT.y,
    fontColor: "#FFFFFF",
    shadowColor: "#000000",
    lineWordLimits: [3],
    videoWidth: 1920,
    videoHeight: 1080,
  });
  const [duration, setDuration] = useState<number>(0);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderUrl, setRenderUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);
  const [availableFonts, setAvailableFonts] = useState<string[]>([]);
  const [favoriteFonts, setFavoriteFonts] = useState<string[]>([]);
  const [favoritesLoaded, setFavoritesLoaded] = useState(false);

  const sizeOptions = useMemo(
    () => Array.from({ length: 291 }, (_, index) => 10 + index),
    []
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const defaultPlacement = useMemo(
    () => ({
      x: Math.min(1, Math.max(0, settings.defaultPositionX)),
      y: Math.min(1, Math.max(0, settings.defaultPositionY)),
    }),
    [settings.defaultPositionX, settings.defaultPositionY]
  );
  const previousDefaultRef = useRef(defaultPlacement);
  const previousSizeRef = useRef({ sizeMin: settings.sizeMin, sizeMax: settings.sizeMax });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const handleTimeUpdate = () => setPlayheadTime(video.currentTime);
    video.addEventListener("timeupdate", handleTimeUpdate);
    handleTimeUpdate();
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [mediaUrl]);

  useEffect(() => {
    const previous = previousDefaultRef.current;
    if (previous.x === defaultPlacement.x && previous.y === defaultPlacement.y) {
      return;
    }
    setPlacements((prev) => {
      const next: Record<number, Placement> = { ...prev };
      segments.forEach((segment) => {
        const current = prev[segment.id];
        if (!current) {
          next[segment.id] = { ...defaultPlacement };
          return;
        }
        if (Math.abs(current.x - previous.x) < 0.001 && Math.abs(current.y - previous.y) < 0.001) {
          next[segment.id] = { ...defaultPlacement };
        }
      });
      return next;
    });
    previousDefaultRef.current = defaultPlacement;
  }, [defaultPlacement, segments]);

  useEffect(() => {
    const previous = previousSizeRef.current;
    if (previous.sizeMin === settings.sizeMin && previous.sizeMax === settings.sizeMax) {
      return;
    }
    const nextMin = Math.min(settings.sizeMin, settings.sizeMax);
    const nextMax = Math.max(settings.sizeMin, settings.sizeMax);
    setSegmentOverrides((prev) => {
      let changed = false;
      const next: Record<number, SubtitleOverride> = { ...prev };
      Object.entries(prev).forEach(([key, override]) => {
        let updated = { ...override };
        let mutated = false;
        const matchesPrevMin =
          override.sizeMin !== undefined && Math.abs(override.sizeMin - previous.sizeMin) < 0.001;
        const matchesPrevMax =
          override.sizeMax !== undefined && Math.abs(override.sizeMax - previous.sizeMax) < 0.001;
        if (matchesPrevMin) {
          delete updated.sizeMin;
          mutated = true;
        }
        if (matchesPrevMax) {
          delete updated.sizeMax;
          mutated = true;
        }

        if (updated.sizeMin !== undefined) {
          if (updated.sizeMin < nextMin) {
            updated.sizeMin = nextMin;
            mutated = true;
          }
          if (updated.sizeMin > nextMax) {
            updated.sizeMin = nextMax;
            mutated = true;
          }
        }
        if (updated.sizeMax !== undefined) {
          if (updated.sizeMax > nextMax) {
            updated.sizeMax = nextMax;
            mutated = true;
          }
          if (updated.sizeMax < nextMin) {
            updated.sizeMax = nextMin;
            mutated = true;
          }
        }
        if (
          updated.sizeMin !== undefined &&
          updated.sizeMax !== undefined &&
          updated.sizeMax < updated.sizeMin
        ) {
          updated.sizeMax = updated.sizeMin;
          mutated = true;
        }

        if (updated.sizeMin !== undefined && Math.abs(updated.sizeMin - nextMin) < 0.001) {
          delete updated.sizeMin;
          mutated = true;
        }
        if (updated.sizeMax !== undefined && Math.abs(updated.sizeMax - nextMax) < 0.001) {
          delete updated.sizeMax;
          mutated = true;
        }

        if (!mutated) {
          return;
        }
        changed = true;
        if (Object.keys(updated).length === 0) {
          delete next[Number(key)];
        } else {
          next[Number(key)] = updated;
        }
      });
      return changed ? next : prev;
    });
    previousSizeRef.current = { sizeMin: settings.sizeMin, sizeMax: settings.sizeMax };
  }, [settings.sizeMax, settings.sizeMin]);

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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (storedSettings) {
      try {
        const parsed = JSON.parse(storedSettings);
        setSettings((prev) => sanitizeSettings(parsed, prev));
      } catch {
        // ignore invalid stored data
      }
    }
    const storedFavorites = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (storedFavorites) {
      try {
        const parsed = JSON.parse(storedFavorites);
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .filter((entry) => typeof entry === "string")
            .map((entry: string) => entry.trim())
            .filter((entry) => entry !== "");
          setFavoriteFonts(Array.from(new Set(cleaned)));
        }
      } catch {
        // ignore invalid stored data
      }
    }
    setFavoritesLoaded(true);
  }, []);

  useEffect(() => {
    if (!favoritesLoaded || typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteFonts));
  }, [favoriteFonts, favoritesLoaded]);

  const handleDownloadSRT = useCallback(() => {
    if (segments.length === 0) return;

    let srtContent = "";
    segments.forEach((segment, index) => {
      const start = formatSRTTime(segment.start);
      const end = formatSRTTime(segment.end);
      srtContent += `${index + 1}\n${start} --> ${end}\n${segment.text}\n\n`;
    });

    const blob = new Blob([srtContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "captions.srt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [segments]);

  const applyDisplayMode = useCallback(
    (inputSegments: TimelineSegment[]): TimelineSegment[] => {
      const usedIds = new Set<number>();
      let nextGeneratedId = 1;
      const nextId = () => {
        const id = nextGeneratedId;
        nextGeneratedId += 1;
        return id;
      };

      if (settings.mode === "fixed_count" && settings.wordsPerCaption > 0) {
        const groups: TimelineSegment[] = [];
        inputSegments.forEach((segment) => {
          const words = segment.words ?? [];
          if (words.length === 0) {
            const fallbackId = resolveGroupId(undefined, segment.id, usedIds, nextId);
            groups.push({ ...segment, id: fallbackId });
            return;
          }
          for (let i = 0; i < words.length; i += settings.wordsPerCaption) {
            const chunk = words.slice(i, i + settings.wordsPerCaption);
            const start = chunk[0]?.start ?? segment.start;
            const end = chunk[chunk.length - 1]?.end ?? segment.end;
            const groupId = resolveGroupId(chunk[0]?.id, segment.id, usedIds, nextId);
            groups.push({
              id: groupId,
              start,
              end,
              text: chunk.map((word) => word.text).join(" "),
              words: chunk,
              track: 0,
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
              const groupId = resolveGroupId(word.id, segment.id, usedIds, nextId);
              currentGroup = {
                id: groupId,
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
                track: 0,
              });
              const groupId = resolveGroupId(word.id, segment.id, usedIds, nextId);
              currentGroup = {
                id: groupId,
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
            track: 0,
          });
        }
        return groups;
      }

      return inputSegments;
    },
    [settings.mode, settings.wordsPerCaption, settings.intervalSeconds]
  );

  const normaliseSegmentsAndPlacements = useCallback((nextSegments: TimelineSegment[]) => {
    setSegments(nextSegments.map((segment) => ({ ...segment, track: segment.track ?? 0 })));
    setSelectedSegmentIds(new Set());
    setSegmentOverrides({});
    setPlacements((prev) => {
      const next: Record<number, Placement> = {};
      nextSegments.forEach((segment) => {
        next[segment.id] = prev[segment.id] ?? { ...defaultPlacement };
      });
      return next;
    });
  }, [defaultPlacement]);

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
        track: 0,
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

  const handleLoadedMetadata = useCallback((seconds: number, width: number, height: number) => {
    if (seconds > 0) {
      setDuration(seconds);
    }
    if (width > 0 && height > 0) {
      setSettings((prev) => ({
        ...prev,
        videoWidth: width,
        videoHeight: height,
      }));
    }
  }, []);

  const handlePlacementChange = useCallback((segmentId: number, placement: Placement) => {
    setPlacements((prev) => {
      const next = { ...prev };
      if (selectedSegmentIds.has(segmentId)) {
        selectedSegmentIds.forEach((id) => {
          next[id] = placement;
        });
      } else {
        next[segmentId] = placement;
      }
      return next;
    });
  }, [selectedSegmentIds]);

  const handleSegmentSizeChange = useCallback(
    (segmentId: number, sizeMin: number, sizeMax: number) => {
      setSegmentOverrides((prev) => {
        const next = { ...prev };
        const targetIds = selectedSegmentIds.has(segmentId)
          ? Array.from(selectedSegmentIds)
          : [segmentId];
        targetIds.forEach((id) => {
          const current = next[id] ?? {};
          next[id] = {
            ...current,
            sizeMin,
            sizeMax,
          };
        });
        return next;
      });
    },
    [selectedSegmentIds]
  );

  const handleSegmentsChange = useCallback((nextSegments: TimelineSegment[]) => {
    setSegments(nextSegments.map((segment) => ({ ...segment, track: segment.track ?? 0 })));
    setPlacements((prev) => {
      const next = { ...prev };
      nextSegments.forEach((segment) => {
        if (!next[segment.id]) {
          next[segment.id] = { ...defaultPlacement };
        }
      });
      return next;
    });
    setSelectedSegmentIds((prev) => {
      const next = new Set<number>();
      prev.forEach((id) => {
        if (nextSegments.some((segment) => segment.id === id)) {
          next.add(id);
        }
      });
      return next;
    });
    setActiveSegmentId((prev) =>
      nextSegments.some((segment) => segment.id === prev) ? prev : nextSegments[0]?.id ?? null
    );
  }, [defaultPlacement]);

  const handleSegmentSelect = useCallback(
    (segment: TimelineSegment, isMulti: boolean) => {
      const videoEl = videoRef.current;
      if (videoEl) {
        videoEl.currentTime = Math.max(0, Math.min(segment.start, Number.isFinite(videoEl.duration) ? videoEl.duration : segment.start));
      }
      setActiveSegmentId(segment.id);
      setSelectedSegmentIds((prev) => {
        if (!isMulti) {
          return new Set([segment.id]);
        }
        const next = new Set(prev);
        if (next.has(segment.id)) {
          next.delete(segment.id);
        } else {
          next.add(segment.id);
        }
        return next;
      });
    },
    []
  );

  const handleSegmentTextChange = useCallback((segmentId: number, text: string) => {
    setSegments((prev) =>
      prev.map((segment) => (segment.id === segmentId ? applyTextToSegmentWords(segment, text) : segment))
    );
  }, []);

  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const duration = Number.isFinite(video.duration) ? video.duration : time;
    video.currentTime = Math.max(0, Math.min(time, duration));
  }, []);

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
          next[segment.id] = prevPlacements[segment.id] ?? { ...defaultPlacement };
        });
        return next;
      });
      setActiveSegmentId((prevActive) => (regrouped.some((segment) => segment.id === prevActive)
        ? prevActive
        : regrouped[0]?.id ?? null));
      setSelectedSegmentIds(new Set());
      setSegmentOverrides({});
      return regrouped;
    });
  }, [applyDisplayMode, settings.mode, settings.wordsPerCaption, settings.intervalSeconds, settings.rollingWindow, defaultPlacement]);

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
      const reverseIdMap = new Map<number, number>();
      const renderSegments = segments.map((segment, index) => {
        const safeId = isSafeId(segment.id)
          ? segment.id
          : (segment.words?.[0]?.id ?? index + 1);
        reverseIdMap.set(safeId, segment.id);
        return { ...segment, id: safeId };
      });
      const originalIdFor = (safeId: number) => reverseIdMap.get(safeId) ?? safeId;
      const response = await fetch(`${API_BASE}/api/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          settings,
          segments: renderSegments.map(({ id, start, end, text, words }) => ({
            id,
            start,
            end,
            text,
            wordIds: (words ?? []).map((word) => word.id),
          })),
          segmentStyles: renderSegments
            .map((segment) => {
              const originalId = originalIdFor(segment.id);
              const override = segmentOverrides[originalId];
              if (!override) {
                return null;
              }
              return {
                id: segment.id,
                start: segment.start,
                end: segment.end,
                sizeMin: override.sizeMin,
                sizeMax: override.sizeMax,
                letterSpacing: override.letterSpacing,
                wordSpacing: override.wordSpacing,
                lineSpacing: override.lineSpacing,
                font: override.fontFamily,
                fontStyle: override.fontStyle,
                fontColor: override.fontColor,
                shadowColor: override.shadowColor,
                writeOn: override.writeOnKeyframes?.map((frame) => ({
                  time: Number(frame.time.toFixed(3)),
                  value: Number(frame.value.toFixed(3)),
                })),
              };
            })
            .filter(Boolean),
          placements: renderSegments.map((segment) => {
            const originalId = originalIdFor(segment.id);
            const placement = placements[originalId] ?? defaultPlacement;
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
        const cacheBusted = `${absoluteRenderUrl}${absoluteRenderUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;
        setRenderUrl(cacheBusted);
      }
      setStatus(typeof payload.message === "string" ? payload.message : "Render complete");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Unexpected error during render");
      setStatus(null);
    } finally {
      setRendering(false);
    }
  }, [segments, placements, settings, token, segmentOverrides]);

  const handleToggleFavoriteFont = useCallback((font: string) => {
    const trimmed = font.trim();
    if (!trimmed) {
      return;
    }
    setFavoriteFonts((prev) => {
      const normalized = prev.map((entry) => entry.trim()).filter((entry) => entry !== "");
      const set = new Set(normalized);
      if (set.has(trimmed)) {
        set.delete(trimmed);
      } else {
        set.add(trimmed);
      }
      return Array.from(set);
    });
  }, []);

  const handleSaveDefaults = useCallback((current: RenderSettings) => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(serializeSettings(current)));
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-4 py-6 lg:px-6">
      <section className="grid gap-6 lg:grid-cols-[minmax(260px,1fr)_minmax(0,3fr)_minmax(320px,1.4fr)]">
        <SubtitleOverridesPanel
          selectedSegments={segments.filter((segment) => selectedSegmentIds.has(segment.id))}
          overrides={segmentOverrides}
          settings={settings}
          availableFonts={availableFonts}
          favoriteFonts={favoriteFonts}
          onToggleFavoriteFont={handleToggleFavoriteFont}
          onTextChange={handleSegmentTextChange}
          playheadTime={playheadTime}
          onSeek={handleSeek}
          onChange={(segmentIds, updates) => {
            setSegmentOverrides((prev) => {
              const next = { ...prev };
              segmentIds.forEach((segmentId) => {
                const current = next[segmentId] ?? {};
                const merged = { ...current, ...updates };
                const cleaned = Object.fromEntries(
                  Object.entries(merged).filter(([, value]) => {
                    if (value === undefined || value === "") {
                      return false;
                    }
                    if (Array.isArray(value)) {
                      return value.length > 0;
                    }
                    return true;
                  })
                ) as SubtitleOverride;
                if (Object.keys(cleaned).length === 0) {
                  delete next[segmentId];
                } else {
                  next[segmentId] = cleaned;
                }
              });
              return next;
            });
          }}
          onClear={(segmentIds) => {
            setSegmentOverrides((prev) => {
              const next = { ...prev };
              segmentIds.forEach((segmentId) => {
                delete next[segmentId];
              });
              return next;
            });
          }}
        />

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
                  segmentOverrides={segmentOverrides}
                  onPlacementChange={handlePlacementChange}
                  onSizeChange={handleSegmentSizeChange}
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
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Timeline &amp; Windows</h2>
              <p className="text-sm text-slate-400">
                Click a caption below to move the playhead, then adjust placements directly on the preview.
              </p>
            </div>
            <TimelineEditor
              segments={segments}
              duration={duration}
              activeSegmentId={activeSegmentId}
              selectedSegmentIds={selectedSegmentIds}
              onSelect={handleSegmentSelect}
              onSegmentsChange={handleSegmentsChange}
              playheadTime={playheadTime}
              onSeek={handleSeek}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadSRT}
                disabled={!token || segments.length === 0}
                className="rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download SRT
              </button>
              <button
                type="button"
                onClick={handleRender}
                disabled={!token || rendering}
                className="rounded-lg border border-primary-500/60 px-4 py-2 text-sm font-medium text-primary-100 hover:bg-primary-500/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-500"
              >
                {rendering ? "Rendering…" : "Render output"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            availableFonts={availableFonts}
            sizeOptions={sizeOptions}
            favoriteFonts={favoriteFonts}
            onToggleFavoriteFont={handleToggleFavoriteFont}
            onSaveDefaults={handleSaveDefaults}
          />
        </div>
      </section>
    </div>
  );
}
