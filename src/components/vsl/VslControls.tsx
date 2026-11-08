"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

/**
 * Custom controls for the VSL video: play/pause, mute and fullscreen only.
 *
 * Native controls are off on purpose. Every browser draws its own elapsed time
 * and progress bar, and iOS Safari and Firefox offer no way to hide them, so
 * the only way to keep the video length hidden everywhere is to not use them.
 */

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => void };

/** How long the bar stays up after the last interaction while playing. */
const HIDE_AFTER_MS = 2500;

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}
function isFullscreen(): boolean {
  const doc = document as WebkitDocument;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}
const noopSubscribe = () => () => {};
/**
 * Element fullscreen. iPhone Safari has none (only the native video player,
 * which shows the time and progress bar), so there the button is not shown.
 */
function canFullscreen(): boolean {
  const doc = document as WebkitDocument;
  return Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function VslControls({
  videoRef,
  containerRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [active, setActive] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fullscreen = useSyncExternalStore(subscribeFullscreen, isFullscreen, () => false);
  const fullscreenSupported = useSyncExternalStore(noopSubscribe, canFullscreen, () => false);

  // Mirror the video's own state, whatever changed it (our buttons, the lock,
  // media keys, the unmute pill).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPlaying(!video.paused);
      setMuted(video.muted);
    };
    sync();
    const events = ["play", "pause", "ended", "volumechange"] as const;
    events.forEach((e) => video.addEventListener(e, sync));
    return () => events.forEach((e) => video.removeEventListener(e, sync));
  }, [videoRef]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  /** Shows the bar and schedules it to fade out again. */
  const poke = useCallback(() => {
    setActive(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), HIDE_AFTER_MS);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
    poke();
  }, [videoRef, poke]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    poke();
  }, [videoRef, poke]);

  const toggleFullscreen = useCallback(() => {
    const doc = document as WebkitDocument;
    if (isFullscreen()) {
      if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else {
      const el = containerRef.current as WebkitElement | null;
      if (!el) return;
      if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
      else el.webkitRequestFullscreen?.();
    }
    poke();
  }, [containerRef, poke]);

  // Always visible while paused; while playing, only right after interaction.
  const visible = !playing || active;

  return (
    <>
      {/* Tap / click anywhere on the picture to play or pause. */}
      <button
        type="button"
        aria-label={playing ? "Pausar vídeo" : "Reproduzir vídeo"}
        onClick={togglePlay}
        onPointerMove={poke}
        onKeyDown={(e) => {
          if (e.key === "k" || e.key === "K") {
            e.preventDefault();
            togglePlay();
          }
        }}
        className="absolute inset-0 z-[5] cursor-pointer focus-visible:outline-none"
      />

      <div
        onPointerMove={poke}
        className={`absolute inset-x-0 bottom-0 z-[6] flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pt-8 pb-1.5 transition-opacity duration-300 motion-reduce:transition-none sm:px-3 sm:pb-2 ${
          visible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <ControlButton label={playing ? "Pausar" : "Reproduzir"} onClick={togglePlay}>
          {playing ? (
            <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" className="fill-current" />
          ) : (
            <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5Z" className="fill-current" />
          )}
        </ControlButton>

        <div className="flex items-center">
          <ControlButton label={muted ? "Ativar som" : "Desativar som"} onClick={toggleMute}>
            <path d="M11 5 6 9H3v6h3l5 4V5Z" className="fill-current" />
            {muted ? (
              <path d="m16 9 5 6m0-6-5 6" className="fill-none stroke-current stroke-2" strokeLinecap="round" />
            ) : (
              <path
                d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
                className="fill-none stroke-current stroke-2"
                strokeLinecap="round"
              />
            )}
          </ControlButton>

          {fullscreenSupported ? (
            <ControlButton label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} onClick={toggleFullscreen}>
              <path
                d={
                  fullscreen
                    ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
                    : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                }
                className="fill-none stroke-current stroke-2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </ControlButton>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-full text-bone transition-colors hover:text-gold-soft focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-solid"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]">
        {children}
      </svg>
    </button>
  );
}
