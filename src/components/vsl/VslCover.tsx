import Image from "next/image";

export type VslCoverStatus = "idle" | "starting" | "failed";

export interface VslCoverProps {
  /** Cover image URL. When absent a CSS-only cinematic gradient is used. */
  image?: string;
  /** True once playback has started: fades out and becomes inert for good. */
  dismissed: boolean;
  status: VslCoverStatus;
  onActivate: () => void;
}

/**
 * Film-poster cover for the VSL: duotone photo, vignette, scrim and a glass
 * play button with a breathing gold glow and one slowly orbiting ring.
 * The whole cover is a single <button>.
 */
export function VslCover({ image, dismissed, status, onActivate }: VslCoverProps) {
  const isBackgroundPhoto = image?.endsWith("/vsl-background.jpg") ?? false;

  return (
    <button
      type="button"
      onClick={onActivate}
      disabled={status === "starting"}
      aria-label="Assistir ao vídeo"
      aria-hidden={dismissed || undefined}
      inert={dismissed}
      tabIndex={dismissed ? -1 : 0}
      className={`group absolute inset-0 z-10 flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-ink transition-opacity duration-[250ms] ease-out focus-visible:outline-none motion-reduce:transition-none disabled:cursor-progress ${
        dismissed ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {image ? (
        <Image
          src={image}
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 960px, 100vw"
          // The portrait background photo is zoomed onto the couple so the
          // subject sits behind the button; dedicated 16:9 covers are shown as-is.
          className={`object-cover ${
            isBackgroundPhoto
              ? "origin-[30%_57%] scale-[1.7] object-[30%_57%] brightness-[1.35] contrast-[1.1] grayscale"
              : "object-center"
          }`}
        />
      ) : (
        // TODO(asset): public/assets/vsl-cover.jpg (or vsl-poster.jpg / vsl-background.jpg)
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(ellipse_45%_60%_at_50%_45%,color-mix(in_srgb,var(--gold)_22%,transparent)_0%,transparent_70%),linear-gradient(160deg,var(--ink)_0%,var(--wine)_50%,var(--ink)_100%)]"
        />
      )}

      {/* Duotone for the grayscale fallback photo only; a dedicated cover keeps its own colours. */}
      {isBackgroundPhoto ? (
        <span aria-hidden="true" className="absolute inset-0 bg-wine opacity-45 mix-blend-multiply" />
      ) : null}
      {/* Vignette */}
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_75%_75%_at_50%_45%,transparent_35%,color-mix(in_srgb,var(--ink)_85%,transparent)_100%)]"
      />
      {/* Bottom-up scrim for the microcopy */}
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-ink/85 to-transparent" />

      {/* Play button */}
      <span
        aria-hidden="true"
        className="relative flex size-22 items-center justify-center transition-transform duration-200 ease-out group-hover:scale-105 group-active:scale-[0.97] motion-reduce:transition-none sm:size-28"
      >
        {/* Breathing glow */}
        <span className="vsl-breathe absolute -inset-5 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--gold)_45%,transparent)_0%,transparent_68%)] transition-opacity duration-200 group-hover:opacity-100" />
        {/* Orbiting ring */}
        <span className="vsl-orbit absolute -inset-2.5 rounded-full border border-gold/15 border-t-gold/70 border-r-gold/35 opacity-70 transition-opacity duration-200 group-hover:opacity-100 sm:-inset-3" />
        {/* Glass disc */}
        <span className="relative flex size-full items-center justify-center rounded-full border border-gold bg-[color-mix(in_srgb,var(--wine)_35%,color-mix(in_srgb,var(--bone)_8%,transparent))] shadow-[0_0_28px_-4px_color-mix(in_srgb,var(--gold)_55%,transparent)] backdrop-blur-md transition-shadow duration-200 group-hover:shadow-[0_0_44px_-2px_color-mix(in_srgb,var(--gold)_75%,transparent)] group-focus-visible:outline-2 group-focus-visible:outline-offset-4 group-focus-visible:outline-gold group-focus-visible:outline-solid">
          {/* Nudged right: a geometrically centred triangle reads left-heavy. */}
          <svg viewBox="0 0 24 24" className="ml-[3px] size-9 fill-gold-soft sm:size-11">
            <path d="M7 4.2v15.6a.9.9 0 0 0 1.38.76l12.2-7.8a.9.9 0 0 0 0-1.52L8.38 3.44A.9.9 0 0 0 7 4.2Z" />
          </svg>
        </span>
      </span>

      <span aria-hidden="true" className="relative mt-6 flex flex-col items-center gap-1 sm:mt-8">
        <span className="text-xs font-semibold tracking-[0.3em] text-bone/90 uppercase sm:text-sm">
          Assistir agora
        </span>
        <span className="text-xs text-bone/55">
          {status === "failed" ? "Toque novamente para assistir" : "Ative o som"}
        </span>
      </span>
    </button>
  );
}
