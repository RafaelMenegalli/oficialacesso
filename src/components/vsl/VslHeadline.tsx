/**
 * The page's only <h1>. Exact copy:
 * "SENSITIVA FAZ PODEROSA SIMPATIA PARA TRAZER SEU AMOR DE VOLTA DE UMA VEZ POR TODAS"
 *
 * Always exactly 3 lines, at every width:
 *   SENSITIVA FAZ PODEROSA SIMPATIA   (longest line ≈ 18.24em in Playfair 900)
 *   PARA TRAZER SEU AMOR DE VOLTA
 *   DE UMA VEZ POR TODAS
 *
 * The font size scales with the header's own content width (container query
 * units), not the viewport: `100vw` includes the scrollbar and has no floor
 * guarantee, which clipped the line edges on very small screens.
 * 100cqi / 19.5 leaves ~6% slack for fallback-font metrics; capped at 4.5rem.
 *
 * Each <br> is preceded by a real space, so the accessible text and
 * textContent stay identical to the required string.
 */
export function VslHeadline({ id }: { id: string }) {
  return (
    <header className="@container mx-auto flex w-full max-w-[86rem] flex-col items-center px-4 pt-14 pb-10 text-center sm:pt-20 lg:pt-24 lg:pb-14">
      {/* Single restrained accent: thin gold rule with a small diamond. */}
      <div aria-hidden="true" className="mb-7 flex items-center gap-3 lg:mb-9">
        <span className="h-px w-10 bg-gradient-to-r from-transparent to-gold sm:w-16" />
        <span className="size-1.5 rotate-45 bg-gold" />
        <span className="h-px w-10 bg-gradient-to-l from-transparent to-gold sm:w-16" />
      </div>

      <h1
        id={id}
        className="font-display text-[min(calc(100cqi/19.5),4.5rem)] leading-[1.12] font-black tracking-[-0.015em] whitespace-nowrap text-bone uppercase [text-shadow:0_2px_24px_rgb(0_0_0/0.55)] lg:leading-[1.06]"
      >
        SENSITIVA FAZ{" "}
        <span className="text-gold-gradient [text-shadow:none]">PODEROSA SIMPATIA</span> <br />
        PARA TRAZER SEU AMOR DE VOLTA <br />
        DE UMA VEZ POR TODAS
      </h1>
    </header>
  );
}
