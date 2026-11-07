"use client";

/**
 * Blocking lead-capture modal, opened by <VslPlayer /> when the video reaches
 * VSL_LOCK_AT_SECONDS. It cannot be dismissed: no close button, Escape is
 * ignored, and if the browser force-closes it anyway it reopens. It only
 * closes itself after the WhatsApp message was sent (onSuccess).
 * See docs/FUNNEL.md and docs/WHATSAPP.md.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { LeadResponse } from "@/lib/validation";

export interface LeadCaptureData {
  name: string;
  /** Digits as typed (formatting stripped); the server normalises to E.164. */
  phone: string;
  consent: boolean;
}

export interface LeadCaptureModalProps {
  open: boolean;
  /** Calls the API. Resolves with its response; rejects only on network failure. */
  onSubmit: (data: LeadCaptureData) => Promise<LeadResponse>;
  /** Called after the success message has been shown. */
  onSuccess: () => void;
}

type View =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string; fallbackUrl?: string };

const SUCCESS_CLOSE_DELAY_MS = 3500;
const NETWORK_ERROR = "Sem conexão com a internet no momento. Verifique sua rede e tente novamente.";

/** Formats raw digits as a Brazilian phone number: (11) 98765-4321. */
function formatPhone(digits: string): string {
  const d = digits.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const inputClass =
  "w-full rounded-lg border border-gold/25 bg-wine/20 px-4 py-3 text-base text-bone placeholder:text-muted/60 focus:border-gold disabled:opacity-60";

export function LeadCaptureModal({ open, onSubmit, onSuccess }: LeadCaptureModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openRef = useRef(open);
  const titleId = useId();
  const descId = useId();
  const nameId = useId();
  const phoneId = useId();
  const consentId = useId();
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [consent, setConsent] = useState(false);
  const [view, setView] = useState<View>({ kind: "idle" });

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();

    // Stop the page behind the modal from scrolling.
    const root = document.documentElement;
    root.style.overflow = open ? "hidden" : "";
    return () => {
      root.style.overflow = "";
    };
  }, [open]);

  // Close shortly after a successful send.
  useEffect(() => {
    if (view.kind !== "success") return;
    const timer = window.setTimeout(onSuccess, SUCCESS_CLOSE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [view.kind, onSuccess]);

  const submitting = view.kind === "submitting";
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length >= 2 && phoneDigits.length >= 10 && consent && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setView({ kind: "submitting" });
    try {
      const result = await onSubmit({ name: trimmedName, phone: phoneDigits, consent });
      if (result.status === "sent") setView({ kind: "success" });
      else setView({ kind: "error", message: result.message, fallbackUrl: result.fallbackUrl });
    } catch {
      setView({ kind: "error", message: NETWORK_ERROR });
    }
  }

  const firstName = trimmedName.split(/\s+/)[0] ?? "";

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      // Escape must not dismiss the lock.
      onCancel={(event) => event.preventDefault()}
      // Some browsers (e.g. Chrome after repeated Escape presses) close a
      // modal even when `cancel` is prevented. Reopen it while still locked.
      onClose={(event) => {
        if (openRef.current) event.currentTarget.showModal();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),28rem)] overflow-y-auto rounded-2xl border border-gold/30 bg-ink p-0 text-bone shadow-[0_0_80px_-10px_color-mix(in_srgb,var(--wine-bright)_70%,transparent)] backdrop:bg-ink/90 backdrop:backdrop-blur-md"
    >
      {view.kind === "success" ? (
        <div className="flex flex-col items-center gap-4 p-6 text-center sm:p-8" role="status">
          <div
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-full border border-gold/40 bg-wine/40"
          >
            <svg viewBox="0 0 24 24" className="size-7 fill-none stroke-gold-soft stroke-[2.5]">
              <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 id={titleId} className="font-display text-2xl font-bold sm:text-3xl">
            Pronto{firstName ? `, ${firstName}` : ""}!
          </h2>
          <p id={descId} className="text-base text-bone/85">
            Enviamos o acesso ao vídeo completo para o seu WhatsApp{" "}
            <span className="whitespace-nowrap text-gold-soft">{formatPhone(phoneDigits)}</span>.
          </p>
          <p className="text-sm text-muted">Abra a conversa e toque em “Assistir agora”.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate aria-busy={submitting} className="flex flex-col gap-5 p-6 sm:p-8">
          <div className="text-center">
            <h2
              id={titleId}
              className="font-display text-xl leading-snug font-bold text-balance sm:text-2xl"
            >
              Ops, o conteúdo desse vídeo é sigiloso, por isso vários Homens estão tentando retirar
              essa página do ar.
            </h2>
            <p id={descId} className="mt-4 text-base text-bone/85">
              Receba o vídeo completo agora pelo seu{" "}
              <strong className="font-semibold text-gold-soft">WhatsApp</strong>:
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-sm font-medium">
              Seu nome
            </label>
            <input
              id={nameId}
              name="name"
              type="text"
              autoComplete="given-name"
              autoCapitalize="words"
              maxLength={80}
              required
              disabled={submitting}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Como você se chama?"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={phoneId} className="text-sm font-medium">
              Seu WhatsApp (com DDD)
            </label>
            <input
              id={phoneId}
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              required
              disabled={submitting}
              value={formatPhone(phoneDigits)}
              onChange={(e) => setPhoneDigits(e.target.value.replace(/\D/g, "").slice(0, 11))}
              className={inputClass}
              placeholder="DDD + WhatsApp"
            />
          </div>

          {/* Required opt-in before any WhatsApp message (LGPD consent). */}
          <label htmlFor={consentId} className="flex cursor-pointer items-start gap-3 text-sm leading-snug text-bone/85">
            <input
              id={consentId}
              name="consent"
              type="checkbox"
              required
              disabled={submitting}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 cursor-pointer accent-wine-bright"
            />
            <span>Concordo em receber mensagens sobre esta oferta no meu WhatsApp.</span>
          </label>

          {view.kind === "error" ? (
            <div role="alert" className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-gold-soft">{view.message}</p>
              {view.fallbackUrl ? (
                <a
                  href={view.fallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-bone underline decoration-gold/60 underline-offset-4 hover:decoration-gold"
                >
                  Alternativa: chamar a Sensitiva no WhatsApp
                </a>
              ) : null}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-wine-bright to-wine px-6 py-3.5 text-base font-semibold text-bone ring-1 ring-gold/40 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <>
                <span
                  aria-hidden="true"
                  className="size-4 animate-spin rounded-full border-2 border-bone/30 border-t-bone motion-reduce:animate-none"
                />
                Enviando…
              </>
            ) : (
              "Receber o vídeo pelo WhatsApp"
            )}
          </button>
        </form>
      )}
    </dialog>
  );
}
