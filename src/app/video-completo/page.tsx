import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { Testimonials } from "@/components/testimonials/Testimonials";
import { VslBackground } from "@/components/vsl/VslBackground";
import { VslHeadline } from "@/components/vsl/VslHeadline";
import { VslPlayer } from "@/components/vsl/VslPlayer";
import { testimonials } from "@/data/testimonials";
import { resolveCoverImage, resolveVideoSrc } from "@/lib/assets";

export const metadata: Metadata = {
  title: "Sensitiva — Assista ao vídeo",
};

export default function VideoCompletoPage() {
  const coverImage = resolveCoverImage();

  return (
    <>
      <VslBackground />

      <main className="relative">
        <section aria-labelledby="vsl-titulo">
          <VslHeadline id="vsl-titulo" />

          <div className="mx-auto w-full max-w-[960px] px-4">
            <VslPlayer
              src={resolveVideoSrc()}
              coverImage={coverImage}
              title="Vídeo: Sensitiva faz poderosa simpatia para trazer seu amor de volta"
              // Full video: no lead-capture lock and no modals.
              lockAtSeconds={null}
            />
            <p className="mt-4 text-center text-sm text-muted/80">
              <span aria-hidden="true">🔊 </span>Ative o som para assistir
            </p>
          </div>
        </section>

        <Testimonials items={testimonials} />
      </main>

      <SiteFooter />
    </>
  );
}
