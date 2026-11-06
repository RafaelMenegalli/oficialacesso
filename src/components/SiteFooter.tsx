import { CurrentYear } from "./CurrentYear";

export const PRODUCT_NAME = "Sensitiva";

export function SiteFooter() {
  return (
    <footer className="border-t border-gold/10 px-4 py-6 text-center text-sm text-muted">
      © <CurrentYear /> {PRODUCT_NAME}. Todos os direitos reservados.
    </footer>
  );
}
