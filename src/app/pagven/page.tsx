import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sensitiva — Em breve",
};

/** Placeholder so /pagven resolves. The real sales page is a separate task. */
export default function PagvenPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_center,var(--wine)_0%,var(--ink)_65%)] px-4">
      <h1 className="font-display text-4xl font-bold text-bone sm:text-5xl">Em breve</h1>
    </main>
  );
}
