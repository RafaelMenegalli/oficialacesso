"use client";

import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import { LeadCaptureModal, type LeadCaptureData } from "@/components/LeadCaptureModal";
import type { LeadResponse } from "@/lib/validation";
import { VslControls } from "./VslControls";
import { VslCover, type VslCoverStatus } from "./VslCover";

/**
 * Lead-capture lock. Playback time (in seconds) at which the video pauses and
 * the page is locked behind <LeadCaptureModal />. `null` disables the lock.
 *
 * The lock is intentionally NOT persisted: a reload starts from zero, plays
 * up to this point again and locks again. See docs/FUNNEL.md.
 */
export const VSL_LOCK_AT_SECONDS: number | null = 10;

export interface VslPlaybackState {
  /** Current playback position in seconds. */
  currentTime: number;
  /** Total duration in seconds (NaN until metadata has loaded). */
  duration: number;
  paused: boolean;
}

export interface VslPlayerProps {
  /** Video URL. Resolved server-side (env var first, then local file). */
  src: string;
  /**
   * Cover image shown under the play button before the first play
   * (the poster when provided, otherwise the background photo).
   * When absent the cover is a CSS gradient.
   */
  coverImage?: string;
  /** Accessible name for the video element. */
  title: string;
  /**
   * Hook point: called on every native `timeupdate` (~4x per second) with the
   * current playback state. Use it for analytics.
   */
  onTimeUpdate?: (state: VslPlaybackState, video: HTMLVideoElement) => void;
  /**
   * Seconds at which playback locks behind the lead-capture modal. Defaults to
   * VSL_LOCK_AT_SECONDS; pass `null` for a free player with no modal at all.
   */
  lockAtSeconds?: number | null;
}

type WebkitVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitExitFullscreen?: () => void;
};

/** Leaves any fullscreen / picture-in-picture mode so the modal is visible. */
function exitImmersiveModes(video: HTMLVideoElement) {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  const webkit = video as WebkitVideo;
  if (webkit.webkitDisplayingFullscreen) webkit.webkitExitFullscreen?.(); // iOS Safari
  if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
}

function isPastLock(video: HTMLVideoElement, lockAt: number | null): boolean {
  return lockAt !== null && video.currentTime >= lockAt;
}

const UNEXPECTED_RESPONSE: LeadResponse = {
  status: "failed",
  message: "Algo deu errado do nosso lado. Tente novamente em instantes.",
};

/** Rejects only on network failure; every HTTP answer becomes a LeadResponse. */
async function submitLead(data: LeadCaptureData): Promise<LeadResponse> {
  const response = await fetch("/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  try {
    const body = (await response.json()) as LeadResponse;
    return body && (body.status === "sent" || body.status === "failed") ? body : UNEXPECTED_RESPONSE;
  } catch {
    return UNEXPECTED_RESPONSE;
  }
}

export function VslPlayer({
  src,
  coverImage,
  title,
  onTimeUpdate,
  lockAtSeconds = VSL_LOCK_AT_SECONDS,
}: VslPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Single source of truth for cover visibility, native controls and pointer-events. */
  const [hasStarted, setHasStarted] = useState(false);
  const [coverStatus, setCoverStatus] = useState<VslCoverStatus>("idle");
  /** True when playback only succeeded muted (in-app browser fallback). */
  const [needsUnmute, setNeedsUnmute] = useState(false);
  /** Once locked, the modal stays open for good — including after a successful send. */
  const [locked, setLocked] = useState(false);
  // Mirrors `locked` synchronously so media event handlers never see stale state.
  const lockedRef = useRef(false);

  /** Pauses at the lock point and opens the modal. Idempotent. */
  const enforceLock = useCallback((video: HTMLVideoElement) => {
    if (lockAtSeconds === null) return;
    if (video.currentTime > lockAtSeconds) video.currentTime = lockAtSeconds;
    video.pause();
    exitImmersiveModes(video);
    if (!lockedRef.current) {
      lockedRef.current = true;
      setLocked(true);
    }
  }, [lockAtSeconds]);

  const handleTimeUpdate = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      onTimeUpdate?.(
        { currentTime: video.currentTime, duration: video.duration, paused: video.paused },
        video,
      );
      if (lockedRef.current || isPastLock(video, lockAtSeconds)) enforceLock(video);
    },
    [onTimeUpdate, enforceLock, lockAtSeconds],
  );

  // Dragging the progress bar past the lock point locks immediately.
  const handleSeeking = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      const video = event.currentTarget;
      if (lockedRef.current || isPastLock(video, lockAtSeconds)) enforceLock(video);
    },
    [enforceLock, lockAtSeconds],
  );

  // Any attempt to resume playback while locked (media keys, headset button,
  // lock-screen controls) is undone straight away.
  const handlePlay = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      if (lockedRef.current) enforceLock(event.currentTarget);
    },
    [enforceLock],
  );

  /**
   * Cover activation. play() is called synchronously inside the click so the
   * user gesture allows sound. Some in-app browsers (Instagram / WhatsApp
   * WebViews) still reject it: then retry once muted and offer an unmute pill.
   * If that also fails the cover stays, with a "tap again" hint.
   */
  const handleStart = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    setCoverStatus("starting");

    const markStarted = (muted: boolean) => {
      setHasStarted(true);
      setNeedsUnmute(muted);
      video.focus({ preventScroll: true });
    };

    video.muted = false;
    try {
      await video.play();
      markStarted(false);
      return;
    } catch {
      // Fall through to the muted retry.
    }

    video.muted = true;
    try {
      await video.play();
      markStarted(true);
    } catch {
      video.muted = false;
      setCoverStatus("failed");
    }
  }, []);

  const handleUnmute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setNeedsUnmute(false);
  }, []);

  // Hide the unmute pill if the visitor unmutes via the controls' sound button.
  const handleVolumeChange = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!event.currentTarget.muted) setNeedsUnmute(false);
  }, []);

  return (
    <>
      <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-xl border border-gold/35 bg-ink shadow-[0_0_0_1px_color-mix(in_srgb,var(--wine-bright)_45%,transparent),0_0_60px_-10px_color-mix(in_srgb,var(--wine-bright)_65%,transparent),0_30px_80px_-20px_rgb(0_0_0/0.9)] sm:rounded-2xl">
        <video
          ref={videoRef}
          className="vsl-video absolute inset-0 size-full bg-ink object-cover"
          src={src}
          // Never native controls: they show the time and progress bar, which
          // iOS Safari and Firefox won't let us hide. <VslControls /> replaces them.
          controls={false}
          playsInline
          preload="metadata"
          controlsList="nodownload noplaybackrate"
          disablePictureInPicture
          disableRemotePlayback
          aria-label={title}
          tabIndex={-1}
          onTimeUpdate={handleTimeUpdate}
          onSeeking={handleSeeking}
          onPlay={handlePlay}
          onVolumeChange={handleVolumeChange}
        >
          Seu navegador não suporta vídeo.
        </video>

        {hasStarted ? <VslControls videoRef={videoRef} containerRef={containerRef} /> : null}

        <VslCover
          image={coverImage}
          dismissed={hasStarted}
          status={coverStatus}
          onActivate={() => void handleStart()}
        />

        {needsUnmute ? (
          <button
            type="button"
            onClick={handleUnmute}
            className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gold/50 bg-ink/75 px-4 py-2 text-sm font-medium text-bone backdrop-blur-md"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-gold-soft stroke-2">
              <path d="M11 5 6 9H3v6h3l5 4V5Z" strokeLinejoin="round" />
              <path d="m16 9 5 6m0-6-5 6" strokeLinecap="round" />
            </svg>
            Toque para ativar o som
          </button>
        ) : null}

        <p role="status" className="sr-only">
          {coverStatus === "failed" ? "Não foi possível iniciar o vídeo. Toque novamente para assistir." : ""}
        </p>
      </div>

      {lockAtSeconds !== null ? <LeadCaptureModal open={locked} onSubmit={submitLead} /> : null}
    </>
  );
}
