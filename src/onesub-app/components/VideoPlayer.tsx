"use client";

import { ChangeEvent, MutableRefObject, ReactNode, useCallback } from "react";

interface VideoPlayerProps {
  src: string | null;
  onUpload(file: File): void;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  overlay?: ReactNode;
  onLoadedMetadata?(duration: number): void;
}

export function VideoPlayer({ src, onUpload, videoRef, overlay, onLoadedMetadata }: VideoPlayerProps) {
  const handleFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        onUpload(file);
      }
    },
    [onUpload]
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-inner shadow-black/40">
      <label className="mb-3 flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-4 py-3 text-sm text-slate-400 hover:border-primary-500">
        <input type="file" accept="video/*,audio/*" onChange={handleFile} className="hidden" />
        <span>{src ? "Change source" : "Upload video or audio"}</span>
      </label>
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-800 bg-black">
        {src ? (
          <video
            ref={videoRef}
            src={src}
            controls
            className="h-full w-full object-contain"
            preload="metadata"
            onLoadedMetadata={(event) => {
              if (onLoadedMetadata) {
                onLoadedMetadata(event.currentTarget.duration);
              }
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No media loaded yet
          </div>
        )}
        {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
      </div>
    </div>
  );
}
