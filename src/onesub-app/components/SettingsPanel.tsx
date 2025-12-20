"use client";

import { Dispatch, SetStateAction } from "react";

type RevealMode = "block" | "per_word";
type DisplayMode = "segment" | "fixed_count" | "fixed_interval" | "rolling" | "manual_windows";

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
  fontBands: FontBand[];
  outline: number;
  shadow: number;
  lineSpacing: number;
  lineWordLimits: number[];
};

interface SettingsPanelProps {
  settings: RenderSettings;
  onChange: Dispatch<SetStateAction<RenderSettings>>;
  availableFonts: string[];
  sizeOptions: number[];
}

export function SettingsPanel({ settings, onChange, availableFonts, sizeOptions }: SettingsPanelProps) {
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
  const fontChoices = (availableFonts.length > 0 ? availableFonts : fallbackFonts).filter((font, index, array) => array.indexOf(font) === index);
  const defaultFontOptions = settings.defaultFont && !fontChoices.includes(settings.defaultFont)
    ? [settings.defaultFont, ...fontChoices]
    : fontChoices;

  return (
    <aside className="space-y-6 rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-inner shadow-black/40">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Style</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-400">Min size</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Max size</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Reveal</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Alignment</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Default font</span>
            <select
              value={settings.defaultFont || defaultFontOptions[0]}
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Line spacing</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Outline</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Shadow</span>
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
              <span className="text-xs uppercase tracking-wide text-slate-400">Words per caption</span>
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
              <span className="text-xs uppercase tracking-wide text-slate-400">Interval (seconds)</span>
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
              <span className="text-xs uppercase tracking-wide text-slate-400">Rolling window</span>
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
            <span className="text-xs uppercase tracking-wide text-slate-400">Line word limits</span>
            <input
              type="text"
              value={settings.lineWordLimits.join(", ")}
              onChange={(event) => {
                const values = event.target.value
                  .split(",")
                  .map((entry) => Number(entry.trim()))
                  .filter((num) => !Number.isNaN(num) && num > 0);
                update("lineWordLimits", values);
              }}
              placeholder="e.g. 2,3,3"
              className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1"
            />
            <span className="text-xs text-slate-500">
              Controls how many words flow onto each line when rendering multi-line captions.
            </span>
          </label>
        </div>
      </section>
    </aside>
  );
}
