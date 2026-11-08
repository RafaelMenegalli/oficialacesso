"use client";

import { useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Testimonial } from "@/data/testimonials";
import { TestimonialCard } from "./TestimonialCard";

/**
 * Comments the visitor writes themselves. They live only in this browser's
 * localStorage: nothing is sent to a server, so only the author ever sees them.
 */

const STORAGE_KEY = "sencitiva:my-comments";
const CHANGE_EVENT = "sencitiva:my-comments-change";
const MAX_NAME = 60;
const MAX_TEXT = 1000;

interface StoredComment {
  id: string;
  name: string;
  text: string;
  createdAt: number;
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): StoredComment[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (c): c is StoredComment =>
        typeof c === "object" &&
        c !== null &&
        typeof c.id === "string" &&
        typeof c.name === "string" &&
        typeof c.text === "string" &&
        typeof c.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function write(comments: StoredComment[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(comments));
  } catch {
    // Storage blocked or full: the comment just won't persist.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function LocalComments() {
  // Server snapshot is null, so the server render and first client render
  // match (no comments); the stored ones appear right after hydration.
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const comments = useMemo(() => parse(raw), [raw]);

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const nameId = useId();
  const textId = useId();

  const canSubmit = name.trim().length > 0 && text.trim().length > 0;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    const comment: StoredComment = {
      id: newId(),
      name: name.trim().slice(0, MAX_NAME),
      text: text.trim().slice(0, MAX_TEXT),
      createdAt: Date.now(),
    };
    // Oldest first: the list reads as a continuation of the public thread,
    // with the newest comment right above the form.
    write([...parse(readRaw()), comment]);
    setText("");
  }

  function handleDelete(id: string) {
    write(parse(readRaw()).filter((c) => c.id !== id));
  }

  return (
    <div>
      {comments.length > 0 ? (
        <ol aria-label="Seus comentários" className="space-y-5 border-t border-gold/10 py-5">
          {comments.map((c) => {
            const testimonial: Testimonial = {
              id: c.id,
              name: c.name,
              text: c.text,
              likes: 0,
              postedAgo: "",
            };
            return (
              <li key={c.id}>
                <TestimonialCard testimonial={testimonial} showLikes={false} />
                <div className="mt-1 ml-[60px] flex gap-3 text-sm sm:ml-[62px]">
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="text-muted underline-offset-2 hover:text-bone hover:underline"
                  >
                    Excluir
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3 border-t border-gold/10 pt-5">
        <div>
          <label htmlFor={nameId} className="sr-only">
            Seu nome
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME}
            autoComplete="given-name"
            placeholder="Seu nome"
            className="w-full rounded-md border border-gold/25 bg-black/30 px-3 py-2 text-base text-bone placeholder:text-muted focus:border-gold/60 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor={textId} className="sr-only">
            Seu comentário
          </label>
          <textarea
            id={textId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={MAX_TEXT}
            rows={3}
            placeholder="Escreva um comentário..."
            className="w-full resize-y rounded-md border border-gold/25 bg-black/30 px-3 py-2 text-base leading-relaxed text-bone placeholder:text-muted focus:border-gold/60 focus:outline-none"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-gold px-5 py-2 text-sm font-semibold tracking-wide text-ink uppercase transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            Comentar
          </button>
        </div>
      </form>
    </div>
  );
}
