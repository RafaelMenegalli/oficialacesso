import Image from "next/image";
import type { Testimonial } from "@/data/testimonials";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function HeartIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-[18px] shrink-0">
      <circle cx="8" cy="8" r="8" className="fill-wine-bright" />
      <path
        d="M8 11.6 4.9 8.7a1.9 1.9 0 0 1 2.7-2.7l.4.4.4-.4a1.9 1.9 0 0 1 2.7 2.7Z"
        className="fill-gold-soft"
      />
    </svg>
  );
}

/**
 * One comment, laid out like the reference: avatar on the left; name,
 * text and a meta row (like count) stacked on the right.
 */
export function TestimonialCard({
  testimonial,
  size = "lg",
  showLikes = true,
}: {
  testimonial: Testimonial;
  size?: "lg" | "sm";
  showLikes?: boolean;
}) {
  const avatarPx = size === "lg" ? 48 : 40;
  const avatarSize = size === "lg" ? "size-12" : "size-10";

  return (
    <figure className="flex gap-3 sm:gap-3.5">
      {/* Decorative avatar: profile photo when available, else initials. */}
      {testimonial.avatar ? (
        <Image
          src={testimonial.avatar}
          alt=""
          width={avatarPx}
          height={avatarPx}
          // 48px sources: nothing for the optimizer to gain.
          unoptimized
          className={`${avatarSize} shrink-0 rounded-md border border-gold/30 object-cover`}
        />
      ) : (
        <div
          aria-hidden="true"
          className={`${avatarSize} flex shrink-0 items-center justify-center rounded-md border border-gold/30 bg-gradient-to-br from-wine-bright to-wine font-display text-base font-bold text-gold-soft`}
        >
          {initials(testimonial.name)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <figcaption className="font-sans text-base leading-tight font-semibold text-gold-soft">
          {testimonial.name}
        </figcaption>
        <blockquote className="mt-1 text-base leading-relaxed break-words text-bone/90">
          <p>{testimonial.text}</p>
        </blockquote>
        {showLikes ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted">
            <HeartIcon />
            <span aria-label={`${testimonial.likes} curtidas`}>{testimonial.likes}</span>
          </p>
        ) : null}
      </div>
    </figure>
  );
}
