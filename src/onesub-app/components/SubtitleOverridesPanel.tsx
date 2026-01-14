"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { FontStyle, RenderSettings } from "./SettingsPanel";
import { TimelineSegment } from "./TimelineEditor";

export type WriteOnKeyframe = {
  time: number;
  value: number;
};

export type SubtitleOverride = {
  sizeMin?: number;
  sizeMax?: number;
  letterSpacing?: number;
  wordSpacing?: number;
  lineSpacing?: number;
  fontFamily?: string;
  fontStyle?: FontStyle;
  fontColor?: string;
  shadowColor?: string;
  writeOnKeyframes?: WriteOnKeyframe[];
};

interface SubtitleOverridesPanelProps {
  selectedSegments: TimelineSegment[];
  overrides: Record<number, SubtitleOverride>;
  settings: RenderSettings;
  availableFonts: string[];
  favoriteFonts: string[];
  onToggleFavoriteFont?: (font: string) => void;
  onChange(segmentIds: number[], updates: SubtitleOverride): void;
  onClear(segmentIds: number[]): void;
  onTextChange(segmentId: number, text: string): void;
  playheadTime: number;
  onSeek(time: number): void;
}

type SharedValue<T> = { value: T | undefined; isMixed: boolean };
type PaletteEntry = string | null;

const normalizeHexColor = (value: string | undefined, fallback: string) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  if (withHash.length !== 7) {
    return fallback;
  }
  const hex = withHash.slice(1);
  if (![...hex].every((char) => "0123456789abcdefABCDEF".includes(char))) {
    return fallback;
  }
  return withHash.toUpperCase();
};

const interpolateWriteOnValue = (frames: WriteOnKeyframe[], time: number) => {
  if (frames.length === 0) {
    return 0;
  }
  const sorted = [...frames].sort((a, b) => a.time - b.time);
  if (time <= sorted[0].time) {
    return sorted[0].value;
  }
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (time <= next.time) {
      const span = next.time - current.time;
      if (span <= 0) {
        return next.value;
      }
      const t = (time - current.time) / span;
      return current.value + t * (next.value - current.value);
    }
  }
  return sorted[sorted.length - 1].value;
};

const insertIntoPalette = (palette: PaletteEntry[], color: string) => {
  const next = [...palette];
  const emptyIndex = next.findIndex((entry) => !entry);
  const index = emptyIndex >= 0 ? emptyIndex : next.length - 1;
  if (index >= 0) {
    next[index] = color;
  }
  return next;
};

const resolveSharedValue = <T,>(
  segmentIds: number[],
  getValue: (segmentId: number) => T
): SharedValue<T> => {
  if (segmentIds.length === 0) {
    return { value: undefined, isMixed: false };
  }
  const first = getValue(segmentIds[0]);
  for (let i = 1; i < segmentIds.length; i += 1) {
    const current = getValue(segmentIds[i]);
    if (current !== first) {
      return { value: undefined, isMixed: true };
    }
  }
  return { value: first, isMixed: false };
};

export function SubtitleOverridesPanel({
  selectedSegments,
  overrides,
  settings,
  availableFonts,
  favoriteFonts,
  onToggleFavoriteFont,
  onChange,
  onClear,
  onTextChange,
  playheadTime,
  onSeek,
}: SubtitleOverridesPanelProps) {
  const segmentIds = selectedSegments.map((segment) => segment.id);
  const hasSelection = segmentIds.length > 0;
  const singleSelection = selectedSegments.length === 1 ? selectedSegments[0] : null;
  const isMultiSelect = selectedSegments.length > 1;

  const sizeMin = resolveSharedValue(segmentIds, (id) => overrides[id]?.sizeMin ?? settings.sizeMin);
  const sizeMax = resolveSharedValue(segmentIds, (id) => overrides[id]?.sizeMax ?? settings.sizeMax);
  const letterSpacing = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.letterSpacing ?? settings.letterSpacing
  );
  const wordSpacing = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.wordSpacing ?? settings.wordSpacing
  );
  const lineSpacing = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.lineSpacing ?? settings.lineSpacing
  );
  const fontFamily = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.fontFamily ?? settings.defaultFont
  );
  const fontStyle = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.fontStyle ?? settings.fontStyle
  );
  const fontColor = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.fontColor ?? settings.fontColor
  );
  const shadowColor = resolveSharedValue(
    segmentIds,
    (id) => overrides[id]?.shadowColor ?? settings.shadowColor
  );
  const writeOnKeyframes = useMemo(
    () => (singleSelection ? overrides[singleSelection.id]?.writeOnKeyframes ?? [] : []),
    [singleSelection, overrides]
  );
  const sortedWriteOn = useMemo(
    () => [...writeOnKeyframes].sort((a, b) => a.time - b.time),
    [writeOnKeyframes]
  );
  const [writeOnValue, setWriteOnValue] = useState(0);
  const keyframeTolerance = 0.05;
  const [textPalette, setTextPalette] = useState<PaletteEntry[]>(() => Array.from({ length: 8 }, () => null));
  const [shadowPalette, setShadowPalette] = useState<PaletteEntry[]>(() => Array.from({ length: 8 }, () => null));

  useEffect(() => {
    if (!singleSelection) {
      setWriteOnValue(0);
      return;
    }
    setWriteOnValue(0);
  }, [singleSelection?.id]);

  useEffect(() => {
    if (!singleSelection) {
      return;
    }
    if (sortedWriteOn.length === 0) {
      setWriteOnValue(0);
      return;
    }
    const interpolated = interpolateWriteOnValue(sortedWriteOn, playheadTime);
    setWriteOnValue(interpolated);
  }, [singleSelection, playheadTime, sortedWriteOn]);

  const handleNumberChange = (
    key: keyof SubtitleOverride,
    min: number,
    max: number
  ) => (event: ChangeEvent<HTMLInputElement>) => {
    if (!hasSelection) {
      return;
    }
    const raw = event.target.value;
    if (raw.trim() === "") {
      onChange(segmentIds, { [key]: undefined });
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(segmentIds, { [key]: clamped });
  };

  const handleColorTextChange = (key: keyof SubtitleOverride) => (event: ChangeEvent<HTMLInputElement>) => {
    if (!hasSelection) {
      return;
    }
    const raw = event.target.value.trim();
    if (raw === "") {
      onChange(segmentIds, { [key]: undefined });
      return;
    }
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    onChange(segmentIds, { [key]: normalized.toUpperCase() });
  };

  const handleColorPickerChange = (key: keyof SubtitleOverride) => (event: ChangeEvent<HTMLInputElement>) => {
    if (!hasSelection) {
      return;
    }
    const value = normalizeHexColor(event.target.value, event.target.value);
    onChange(segmentIds, { [key]: value });
  };

  const renderPalette = (
    palette: PaletteEntry[],
    onPick: (color: string) => void,
    onRemove: (index: number) => void,
    disabled: boolean
  ) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(24px,1fr))] gap-2">
      {palette.map((entry, index) => (
        <div key={`${entry ?? "empty"}-${index}`} className="relative">
          <button
            type="button"
            disabled={disabled || !entry}
            onClick={() => {
              if (entry) {
                onPick(entry);
              }
            }}
            className={`h-7 w-7 rounded border ${entry ? "border-slate-600" : "border-dashed border-slate-700"} ${
              disabled ? "opacity-60" : "hover:border-primary-400"
            }`}
            style={{ backgroundColor: entry ?? "transparent" }}
          />
          {entry && !disabled && (
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label="Remove palette color"
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-[10px] text-slate-200 hover:border-rose-500 hover:text-rose-200"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );

  const clampWriteOnValue = (value: number) => Math.min(1, Math.max(0, value));

  const handleWriteOnValueChange = (value: number) => {
    setWriteOnValue(clampWriteOnValue(value));
  };

  const fontOptions = useMemo(() => {
    const base = settings.defaultFont?.trim() || "Arial";
    const choices = availableFonts.length > 0 ? availableFonts : [base];
    const favorites = favoriteFonts.map((font) => font.trim()).filter((font) => font !== "");
    return Array.from(new Set([base, ...choices, ...favorites]));
  }, [availableFonts, favoriteFonts, settings.defaultFont]);
  const favoriteOptions = useMemo(
    () => Array.from(new Set(favoriteFonts.map((font) => font.trim()).filter((font) => font !== ""))),
    [favoriteFonts]
  );
  const fontStyleOptions: { value: FontStyle; label: string }[] = [
    { value: "regular", label: "Regular" },
    { value: "bold", label: "Bold" },
    { value: "italic", label: "Italic" },
    { value: "bold_italic", label: "Bold Italic" },
  ];

  const defaultFontColor = normalizeHexColor(settings.fontColor, "#FFFFFF");
  const defaultShadowColor = normalizeHexColor(settings.shadowColor, "#000000");
  const fontColorValue = fontColor.isMixed
    ? ""
    : normalizeHexColor(fontColor.value, defaultFontColor);
  const shadowColorValue = shadowColor.isMixed
    ? ""
    : normalizeHexColor(shadowColor.value, defaultShadowColor);
  const fontColorPickerValue = normalizeHexColor(fontColor.value ?? defaultFontColor, defaultFontColor);
  const shadowColorPickerValue = normalizeHexColor(shadowColor.value ?? defaultShadowColor, defaultShadowColor);

  const applyWriteOnKeyframes = (nextFrames: WriteOnKeyframe[]) => {
    if (!singleSelection) {
      return;
    }
    const cleaned = nextFrames
      .map((frame) => ({
        time: Math.min(Math.max(frame.time, singleSelection.start), singleSelection.end),
        value: clampWriteOnValue(frame.value),
      }))
      .sort((a, b) => a.time - b.time);
    onChange([singleSelection.id], { writeOnKeyframes: cleaned });
  };

  const handleSetKeyframe = () => {
    if (!singleSelection) {
      return;
    }
    const time = Math.min(Math.max(playheadTime, singleSelection.start), singleSelection.end);
    const next = [...writeOnKeyframes];
    const existingIndex = next.findIndex((frame) => Math.abs(frame.time - time) <= keyframeTolerance);
    const frame = { time, value: clampWriteOnValue(writeOnValue) };
    if (existingIndex >= 0) {
      next[existingIndex] = frame;
    } else {
      next.push(frame);
    }
    applyWriteOnKeyframes(next);
  };

  const handleRemoveKeyframe = (time: number) => {
    if (!singleSelection) {
      return;
    }
    const next = writeOnKeyframes.filter((frame) => Math.abs(frame.time - time) > keyframeTolerance);
    applyWriteOnKeyframes(next);
  };

  return (
    <aside className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-inner shadow-black/40">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Selected Caption</h2>
          <p className="text-xs text-slate-400">
            {hasSelection ? `${segmentIds.length} selected` : "Select a caption to edit overrides."}
          </p>
        </div>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={() => onClear(segmentIds)}
          className="rounded border border-rose-600 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Clear overrides
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs uppercase tracking-wide text-slate-400">Subtitle text</span>
        <textarea
          rows={3}
          value={singleSelection?.text ?? ""}
          placeholder={
            hasSelection ? (isMultiSelect ? "Multiple selected" : "Enter caption text") : "Select a caption to edit"
          }
          onChange={(event) => {
            if (singleSelection) {
              onTextChange(singleSelection.id, event.target.value);
            }
          }}
          disabled={!singleSelection}
          className="resize-none rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
        />
        {isMultiSelect && (
          <span className="text-xs text-slate-500">Edit text with a single caption selected.</span>
        )}
      </label>

      <section className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Write On</h3>
            <p className="text-xs text-slate-500">
              Add keyframes at the playhead time. Values run 0 → 1 across the caption.
            </p>
          </div>
          <button
            type="button"
            disabled={!singleSelection || writeOnKeyframes.length === 0}
            onClick={() => applyWriteOnKeyframes([])}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-rose-500 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear write on
          </button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="col-span-2 flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
            Value
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={writeOnValue}
              onChange={(event) => handleWriteOnValueChange(Number(event.target.value))}
              disabled={!singleSelection}
              className="h-2 w-full accent-primary-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400">
            Number
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={writeOnValue}
              onChange={(event) => handleWriteOnValueChange(Number(event.target.value))}
              disabled={!singleSelection}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm disabled:opacity-60"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <button
            type="button"
            onClick={handleSetKeyframe}
            disabled={!singleSelection}
            className="rounded border border-primary-500/60 px-3 py-1 text-xs text-primary-100 hover:bg-primary-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Set keyframe at {playheadTime.toFixed(2)}s
          </button>
          {singleSelection && (
            <span>
              Caption window: {singleSelection.start.toFixed(2)}s → {singleSelection.end.toFixed(2)}s
            </span>
          )}
        </div>
        {sortedWriteOn.length > 0 && (
          <div className="space-y-2">
            {sortedWriteOn.map((frame) => (
              <div
                key={`${frame.time}-${frame.value}`}
                className="flex items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-300"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSeek(frame.time)}
                    className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:border-primary-500 hover:text-primary-200"
                  >
                    {frame.time.toFixed(2)}s
                  </button>
                  <span>→ {frame.value.toFixed(2)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveKeyframe(frame.time)}
                  className="text-rose-400 hover:text-rose-200"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Min size</span>
          <input
            type="number"
            min={10}
            max={300}
            value={sizeMin.isMixed ? "" : sizeMin.value ?? ""}
            placeholder={sizeMin.isMixed ? "Mixed" : ""}
            onChange={handleNumberChange("sizeMin", 10, 300)}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Max size</span>
          <input
            type="number"
            min={10}
            max={300}
            value={sizeMax.isMixed ? "" : sizeMax.value ?? ""}
            placeholder={sizeMax.isMixed ? "Mixed" : ""}
            onChange={handleNumberChange("sizeMax", 10, 300)}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-slate-400">Font</span>
            {onToggleFavoriteFont && (
              <button
                type="button"
                onClick={() => {
                  const activeFont = fontFamily.isMixed ? "" : (fontFamily.value ?? settings.defaultFont);
                  if (activeFont) {
                    onToggleFavoriteFont(activeFont);
                  }
                }}
                disabled={fontFamily.isMixed}
                className="text-[10px] uppercase text-slate-400 hover:text-primary-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fontFamily.isMixed
                  ? "Mixed"
                  : favoriteOptions.includes(fontFamily.value ?? settings.defaultFont)
                    ? "Remove favorite"
                    : "Add favorite"}
              </button>
            )}
          </div>
          <select
            value={fontFamily.isMixed ? "__mixed__" : fontFamily.value ?? settings.defaultFont}
            onChange={(event) => {
              if (!hasSelection) {
                return;
              }
              const value = event.target.value;
              if (value === "__mixed__") {
                return;
              }
              onChange(segmentIds, { fontFamily: value === settings.defaultFont ? undefined : value });
            }}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          >
            {fontFamily.isMixed && <option value="__mixed__" disabled>Mixed</option>}
            {fontOptions.map((font) => (
              <option key={font} value={font}>
                {font}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Font style</span>
          <select
            value={fontStyle.isMixed ? "__mixed__" : fontStyle.value ?? settings.fontStyle}
            onChange={(event) => {
              if (!hasSelection) {
                return;
              }
              const value = event.target.value;
              if (value === "__mixed__") {
                return;
              }
              onChange(segmentIds, {
                fontStyle: value === settings.fontStyle ? undefined : (value as FontStyle),
              });
            }}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          >
            {fontStyle.isMixed && <option value="__mixed__" disabled>Mixed</option>}
            {fontStyleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {favoriteOptions.length > 0 && (
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">Favorite font</span>
            <select
              value={
                fontFamily.isMixed
                  ? ""
                  : favoriteOptions.includes(fontFamily.value ?? settings.defaultFont)
                    ? fontFamily.value ?? settings.defaultFont
                    : ""
              }
              onChange={(event) => {
                if (!hasSelection) {
                  return;
                }
                const value = event.target.value;
                if (!value) {
                  return;
                }
                onChange(segmentIds, { fontFamily: value === settings.defaultFont ? undefined : value });
              }}
              disabled={!hasSelection || fontFamily.isMixed}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
            >
              <option value="" disabled>Select favorite</option>
              {favoriteOptions.map((font) => (
                <option key={`favorite-${font}`} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Letter spacing</span>
          <input
            type="number"
            min={-100}
            max={40}
            value={letterSpacing.isMixed ? "" : letterSpacing.value ?? ""}
            placeholder={letterSpacing.isMixed ? "Mixed" : ""}
            onChange={handleNumberChange("letterSpacing", -100, 40)}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Word spacing</span>
          <input
            type="number"
            min={0}
            max={80}
            value={wordSpacing.isMixed ? "" : wordSpacing.value ?? ""}
            placeholder={wordSpacing.isMixed ? "Mixed" : ""}
            onChange={handleNumberChange("wordSpacing", 0, 80)}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Line spacing</span>
          <input
            type="number"
            min={0}
            max={80}
            value={lineSpacing.isMixed ? "" : lineSpacing.value ?? ""}
            placeholder={lineSpacing.isMixed ? "Mixed" : ""}
            onChange={handleNumberChange("lineSpacing", 0, 80)}
            disabled={!hasSelection}
            className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 disabled:opacity-60"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Text color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={fontColorPickerValue}
              onChange={handleColorPickerChange("fontColor")}
              disabled={!hasSelection}
              className="h-10 w-12 shrink-0 cursor-pointer rounded border border-slate-700 bg-slate-950/60 p-0 disabled:cursor-not-allowed"
            />
            <input
              type="text"
              value={fontColorValue}
              placeholder={fontColor.isMixed ? "Mixed" : defaultFontColor}
              onChange={handleColorTextChange("fontColor")}
              disabled={!hasSelection}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950/60 px-2 py-1 uppercase disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() =>
                setTextPalette((prev) =>
                  insertIntoPalette(prev, normalizeHexColor(fontColor.value ?? defaultFontColor, defaultFontColor))
                )
              }
              className="w-full rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to palette
            </button>
          </div>
          {renderPalette(
            textPalette,
            (color) => onChange(segmentIds, { fontColor: color }),
            (index) => setTextPalette((prev) => prev.map((entry, i) => (i === index ? null : entry))),
            !hasSelection
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-slate-400">Shadow color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={shadowColorPickerValue}
              onChange={handleColorPickerChange("shadowColor")}
              disabled={!hasSelection}
              className="h-10 w-12 shrink-0 cursor-pointer rounded border border-slate-700 bg-slate-950/60 p-0 disabled:cursor-not-allowed"
            />
            <input
              type="text"
              value={shadowColorValue}
              placeholder={shadowColor.isMixed ? "Mixed" : defaultShadowColor}
              onChange={handleColorTextChange("shadowColor")}
              disabled={!hasSelection}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950/60 px-2 py-1 uppercase disabled:opacity-60"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() =>
                setShadowPalette((prev) =>
                  insertIntoPalette(prev, normalizeHexColor(shadowColor.value ?? defaultShadowColor, defaultShadowColor))
                )
              }
              className="w-full rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add to palette
            </button>
          </div>
          {renderPalette(
            shadowPalette,
            (color) => onChange(segmentIds, { shadowColor: color }),
            (index) => setShadowPalette((prev) => prev.map((entry, i) => (i === index ? null : entry))),
            !hasSelection
          )}
        </label>
      </div>
    </aside>
  );
}
