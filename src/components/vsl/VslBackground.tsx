import Image from "next/image";
import { ASSETS, hasPublicAsset } from "@/lib/assets";

/**
 * Fixed, full-viewport cinematic backdrop:
 * grayscale photo → wine-tinted vertical gradient → warm radial glow → grain.
 * The gradient layers alone look intentional if the photo fails to load.
 */
export function VslBackground() {
  const hasImage = hasPublicAsset(ASSETS.background);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-ink">
      {hasImage ? (
        <Image
          src={ASSETS.background}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[32%_58%] grayscale"
        />
      ) : null /* TODO(asset): public/assets/vsl-background.jpg */}

      {/* Vertical darkening: near-black → warm wine tint → near-black */}
      <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--ink)_88%,transparent)_0%,color-mix(in_srgb,var(--ink)_55%,transparent)_30%,color-mix(in_srgb,var(--wine)_30%,color-mix(in_srgb,var(--ink)_25%,transparent))_55%,color-mix(in_srgb,var(--ink)_70%,transparent)_80%,var(--ink)_100%)]" />

      {/* Warm glow behind the headline area */}
      <div className="absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(ellipse_60%_55%_at_50%_28%,color-mix(in_srgb,var(--wine-bright)_32%,transparent)_0%,transparent_70%)]" />

      {/* Film grain */}
      <div className="film-grain absolute inset-0 opacity-[0.07] mix-blend-overlay" />
    </div>
  );
}
