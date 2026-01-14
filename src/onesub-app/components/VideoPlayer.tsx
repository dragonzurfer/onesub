"use client";

import { ChangeEvent, MutableRefObject, ReactNode, useCallback, useEffect } from "react";

interface VideoPlayerProps {
  src: string | null;
  onUpload(file: File): void;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  overlay?: ReactNode;
  onLoadedMetadata?(duration: number, width: number, height: number): void;
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== " ") {
        return;
      }
      if (event.repeat) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const video = videoRef.current;
      if (!video) {
        return;
      }
      event.preventDefault();
      if (video.paused) {
        void video.play();
      } else {
        video.pause();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [videoRef]);

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
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onLoadedMetadata={(event) => {
              if (onLoadedMetadata) {
                const video = event.currentTarget;
                onLoadedMetadata(video.duration, video.videoWidth, video.videoHeight);
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
