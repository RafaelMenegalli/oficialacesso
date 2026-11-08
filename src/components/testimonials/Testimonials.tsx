import type { Testimonial } from "@/data/testimonials";
import { LocalComments } from "./LocalComments";
import { Reveal } from "./Reveal";
import { TestimonialCard } from "./TestimonialCard";

/**
 * Testimonials section, recreated in code from design/testimonials-reference.png
 * (a threaded comment list): top-level comments separated by spacing, replies
 * indented with a thin vertical rail on the left.
 */
export function Testimonials({ items }: { items: Testimonial[] }) {
  const headingId = "depoimentos-titulo";

  return (
    <section aria-labelledby={headingId} className="mx-auto w-full max-w-3xl px-4 pt-20 pb-16 sm:pt-28">
      <div className="mb-8 text-center sm:mb-10">
        <p className="mb-3 text-sm font-medium tracking-[0.25em] text-gold uppercase">Depoimentos</p>
        <h2 id={headingId} className="font-display text-3xl font-bold text-bone sm:text-4xl">
          Quem já fez, conta
        </h2>
      </div>

      <Reveal>
        <div className="rounded-2xl border border-gold/20 bg-ink/80 p-4 shadow-[0_20px_60px_-25px_rgb(0_0_0/0.9)] backdrop-blur-sm sm:p-6">
          <p className="mb-4 text-sm font-medium text-muted">Últimos comentários</p>
          <ol className="divide-y divide-gold/10">
            {items.map((item) => (
              <li key={item.id} className="py-5 first:pt-1">
                <TestimonialCard testimonial={item} />

                {item.replies && item.replies.length > 0 ? (
                  <ol
                    aria-label={`Respostas a ${item.name}`}
                    className="mt-4 ml-5 space-y-4 border-l border-gold/20 pl-3 sm:ml-6 sm:pl-5"
                  >
                    {item.replies.map((reply) => (
                      <li key={reply.id}>
                        <TestimonialCard testimonial={reply} size="sm" />
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
          <LocalComments />
        </div>
      </Reveal>
    </section>
  );
}
