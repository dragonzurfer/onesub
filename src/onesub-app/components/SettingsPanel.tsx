"use client";

import { Dispatch, SetStateAction, useEffect, useState } from "react";

type RevealMode = "block" | "per_word";
type DisplayMode = "segment" | "fixed_count" | "fixed_interval" | "rolling" | "manual_windows";
export type FontStyle = "regular" | "bold" | "italic" | "bold_italic";

export type FontBand = {
  minSize: number;
  maxSize: number;
  font: string;
};

export type RenderSettings = {
  sizeMin: number;
  sizeMax: number;
  revealMode: RevealMode;
  mode: DisplayMode;
  wordsPerCaption: number;
  intervalSeconds: number;
  rollingWindow: number;
  alignment: number;
  defaultFont: string;
  fontStyle: FontStyle;
  fontBands: FontBand[];
  outline: number;
  shadow: number;
  lineSpacing: number;
  letterSpacing: number;
  wordSpacing: number;
  defaultPositionX: number;
  defaultPositionY: number;
  fontColor: string;
  shadowColor: string;
  lineWordLimits: number[];
  videoWidth?: number;
  videoHeight?: number;
};

interface SettingsPanelProps {
  settings: RenderSettings;
  onChange: Dispatch<SetStateAction<RenderSettings>>;
  availableFonts: string[];
  sizeOptions: number[];
  favoriteFonts: string[];
  onToggleFavoriteFont?: (font: string) => void;
  onSaveDefaults?: (settings: RenderSettings) => void;
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <div className="group relative ml-1 inline-block align-middle">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 text-slate-500 hover:text-slate-300 cursor-help"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-48 -translate-x-1/2 rounded bg-slate-800 p-2 text-xs text-slate-200 shadow-lg group-hover:block z-50 text-center">
        {text}
        <div className="absolute top-full left-1/2 -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-800" />
      </div>
    </div>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  availableFonts,
  sizeOptions,
  favoriteFonts,
  onToggleFavoriteFont,
  onSaveDefaults,
}: SettingsPanelProps) {
  const [rawLineLimits, setRawLineLimits] = useState(settings.lineWordLimits.join(", "));

  useEffect(() => {
    // Only update raw state if the parent state differs from what our raw state parses to.
    // This allows the user to type "2," (which parses to [2]) without it being reset to "2" immediately.
    const currentParsed = rawLineLimits
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((num) => !Number.isNaN(num) && num > 0);
    
    // Simple array equality check
    const isDifferent =
      currentParsed.length !== settings.lineWordLimits.length ||
      currentParsed.some((val, i) => val !== settings.lineWordLimits[i]);

    if (isDifferent) {
      setRawLineLimits(settings.lineWordLimits.join(", "));
    }
  }, [settings.lineWordLimits, rawLineLimits]);

  const update = <K extends keyof RenderSettings>(key: K, value: RenderSettings[K]) => {
    onChange((prev) => ({ ...prev, [key]: value }));
  };

  const updateFontBand = <K extends keyof FontBand>(index: number, key: K, value: FontBand[K]) => {
    onChange((prev) => {
      const nextBands = prev.fontBands.map((band, i) =>
        i === index ? { ...band, [key]: value } : band
      );
      return { ...prev, fontBands: nextBands };
    });
  };

  const removeFontBand = (index: number) => {
    onChange((prev) => ({
      ...prev,
      fontBands: prev.fontBands.filter((_, i) => i !== index),
    }));
  };

  const addFontBand = () => {
    onChange((prev) => ({
      ...prev,
      fontBands: [
        ...prev.fontBands,
        {
          minSize: prev.sizeMin,
          maxSize: prev.sizeMax,
          font: prev.defaultFont || "Arial",
        },
      ],
    }));
  };

  const ensureSizeOption = (value: number) => {
    if (!sizeOptions.includes(value)) {
      return [...sizeOptions, value].sort((a, b) => a - b);
    }
    return sizeOptions;
  };

  const fallbackFonts = ["Arial", "Helvetica", "Verdana"];
  const baseChoices = availableFonts.length > 0 ? availableFonts : fallbackFonts;
  const cleanedFavorites = favoriteFonts
    .map((font) => font.trim())
    .filter((font) => font !== "");
  const favoriteOptions = Array.from(new Set(cleanedFavorites));
  const fontChoices = Array.from(new Set([...baseChoices, ...favoriteOptions]));
  const defaultFontOptions = settings.defaultFont && !fontChoices.includes(settings.defaultFont)
    ? [settings.defaultFont, ...fontChoices]
    : fontChoices;
  const defaultFontValue = settings.defaultFont || defaultFontOptions[0] || "Arial";
  const isDefaultFavorite = favoriteOptions.includes(defaultFontValue);
  const fontStyleOptions: { value: FontStyle; label: string }[] = [
    { value: "regular", label: "Regular" },
    { value: "bold", label: "Bold" },
    { value: "italic", label: "Italic" },
    { value: "bold_italic", label: "Bold Italic" },
  ];

  return (
    <aside className="space-y-6 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-inner shadow-black/40">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Style</h2>
          {onSaveDefaults && (
            <button
              type="button"
              onClick={() => onSaveDefaults(settings)}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-primary-400"
            >
              Save defaults
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Min size <InfoTooltip text="Smallest allowed font size for dynamic scaling." />
            </span>
            <select
              value={String(settings.sizeMin)}
              onChange={(event) => update("sizeMin", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            >
              {ensureSizeOption(settings.sizeMin).map((option) => (
                <option key={`min-${option}`} value={option}>
                  {option}px
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Max size <InfoTooltip text="Largest allowed font size for dynamic scaling." />
            </span>
            <select
              value={String(settings.sizeMax)}
              onChange={(event) => update("sizeMax", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            >
              {ensureSizeOption(settings.sizeMax)
                .filter((option) => option >= settings.sizeMin)
                .map((option) => (
                  <option key={`max-${option}`} value={option}>
                    {option}px
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Reveal <InfoTooltip text="How captions appear: all at once (Block) or timed with audio (Per word)." />
            </span>
            <select
              value={settings.revealMode}
              onChange={(event) => update("revealMode", event.target.value as RevealMode)}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            >
              <option value="block">Block</option>
              <option value="per_word">Per word</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Alignment <InfoTooltip text="Text alignment code (e.g., 2=Bottom Center, 7=Top Left)." />
            </span>
            <select
              value={settings.alignment}
              onChange={(event) => update("alignment", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((code) => (
                <option key={code} value={code}>
                  \an{code}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Default font <InfoTooltip text="Primary font family used for all captions." />
              </span>
              {onToggleFavoriteFont && (
                <button
                  type="button"
                  onClick={() => onToggleFavoriteFont(defaultFontValue)}
                  disabled={!defaultFontValue}
                  className="text-[10px] uppercase text-slate-400 hover:text-primary-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDefaultFavorite ? "Remove favorite" : "Add favorite"}
                </button>
              )}
            </div>
            <select
              value={defaultFontValue}
              onChange={(event) => update("defaultFont", event.target.value)}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            >
              {defaultFontOptions.map((font) => (
                <option key={font} value={font}>
                  {font}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Font style <InfoTooltip text="Choose regular, bold, italic, or bold italic styling." />
            </span>
            <select
              value={settings.fontStyle}
              onChange={(event) => update("fontStyle", event.target.value as FontStyle)}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            >
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
                value={favoriteOptions.includes(defaultFontValue) ? defaultFontValue : ""}
                onChange={(event) => {
                  if (event.target.value) {
                    update("defaultFont", event.target.value);
                  }
                }}
                className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
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
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Line spacing <InfoTooltip text="Vertical space between lines of text in pixels." />
            </span>
            <input
              type="number"
              min={0}
              max={20}
              value={settings.lineSpacing}
              onChange={(event) => update("lineSpacing", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Letter spacing <InfoTooltip text="Extra spacing between characters in pixels." />
            </span>
            <input
              type="number"
              min={-100}
              max={40}
              value={settings.letterSpacing}
              onChange={(event) => update("letterSpacing", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Default X <InfoTooltip text="Horizontal anchor position (0 = left, 1 = right)." />
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={settings.defaultPositionX}
              onChange={(event) => update("defaultPositionX", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Default Y <InfoTooltip text="Vertical anchor position (0 = top, 1 = bottom)." />
            </span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={settings.defaultPositionY}
              onChange={(event) => update("defaultPositionY", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Outline <InfoTooltip text="Thickness of the text stroke/outline in pixels." />
            </span>
            <input
              type="number"
              min={0}
              max={10}
              value={settings.outline}
              onChange={(event) => update("outline", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Shadow <InfoTooltip text="Size and offset of the drop shadow in pixels." />
            </span>
            <input
              type="number"
              min={0}
              max={10}
              value={settings.shadow}
              onChange={(event) => update("shadow", Number(event.target.value))}
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
        </div>
        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Font bands</h3>
            <button
              type="button"
              onClick={addFontBand}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:border-primary-500 hover:text-primary-200"
            >
              + Add band
            </button>
          </div>
          {settings.fontBands.length === 0 && (
            <p className="text-xs text-slate-500">No overrides yet — captions use the default font.</p>
          )}
          {settings.fontBands.map((band, index) => {
            const bandFontOptions =
              band.font && !fontChoices.includes(band.font)
                ? [band.font, ...fontChoices.filter((font) => font !== band.font)]
                : fontChoices;
            return (
              <div
                key={`${band.font}-${index}-${band.minSize}-${band.maxSize}`}
                className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] gap-2 rounded border border-slate-800 bg-slate-950/60 p-2"
              >
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Min
                  <select
                    value={String(band.minSize)}
                    onChange={(event) => updateFontBand(index, "minSize", Number(event.target.value))}
                    className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200"
                  >
                    {ensureSizeOption(band.minSize)
                      .filter((option) => option >= settings.sizeMin && option <= settings.sizeMax)
                      .map((option) => (
                        <option key={`band-${index}-min-${option}`} value={option}>
                          {option}px
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Max
                  <select
                    value={String(band.maxSize)}
                    onChange={(event) => updateFontBand(index, "maxSize", Number(event.target.value))}
                    className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200"
                  >
                    {ensureSizeOption(band.maxSize)
                      .filter((option) => option >= band.minSize && option >= settings.sizeMin && option <= settings.sizeMax)
                      .map((option) => (
                        <option key={`band-${index}-max-${option}`} value={option}>
                          {option}px
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Font
                  <select
                    value={band.font || bandFontOptions[0]}
                    onChange={(event) => updateFontBand(index, "font", event.target.value)}
                    className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-200"
                  >
                    {bandFontOptions.map((font) => (
                      <option key={`band-${index}-font-${font}`} value={font}>
                        {font}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => removeFontBand(index)}
                  className="self-end rounded border border-rose-600 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Display Mode</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Mode <InfoTooltip text="Strategy for grouping words into captions." />
            </span>
          </div>
          <select
            value={settings.mode}
            onChange={(event) => update("mode", event.target.value as DisplayMode)}
            className="w-full rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
          >
            <option value="segment">Segments (Whisper)</option>
            <option value="fixed_count">Fixed count</option>
            <option value="fixed_interval">Fixed interval</option>
            <option value="rolling">Rolling</option>
            <option value="manual_windows">Manual windows</option>
          </select>
          {settings.mode === "fixed_count" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Words per caption <InfoTooltip text="Maximum number of words to show in a single caption group." />
              </span>
              <input
                type="number"
                min={1}
                max={12}
                value={settings.wordsPerCaption}
                onChange={(event) => update("wordsPerCaption", Number(event.target.value))}
                className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
              />
            </label>
          )}
          {settings.mode === "fixed_interval" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Interval (seconds) <InfoTooltip text="Target duration for each caption group." />
              </span>
              <input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={settings.intervalSeconds}
                onChange={(event) => update("intervalSeconds", Number(event.target.value))}
                className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
              />
            </label>
          )}
          {settings.mode === "rolling" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-400">
                Rolling window <InfoTooltip text="Number of words visible at once in rolling mode." />
              </span>
              <input
                type="number"
                min={1}
                max={20}
                value={settings.rollingWindow}
                onChange={(event) => update("rollingWindow", Number(event.target.value))}
                className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
              />
            </label>
          )}
          {settings.mode === "manual_windows" && (
            <p className="rounded-md border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
              Manual windows are edited directly in the timeline. Export the resulting JSON to reuse with the CLI.
            </p>
          )}
          <label className="flex flex-col gap-1 pt-2">
            <span className="text-xs uppercase tracking-wide text-slate-400">
              Line word limits <InfoTooltip text="Controls how many words flow onto each line when rendering multi-line captions." />
            </span>
            <input
              type="text"
              value={rawLineLimits}
              onChange={(event) => {
                setRawLineLimits(event.target.value);
                const values = event.target.value
                  .split(",")
                  .map((entry) => Number(entry.trim()))
                  .filter((num) => !Number.isNaN(num) && num > 0);
                update("lineWordLimits", values);
              }}
              placeholder="e.g. 2,3,3"
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
          </label>
        </div>
      </section>
    </aside>
  );
}
