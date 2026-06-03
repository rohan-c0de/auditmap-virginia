import type { ReactNode } from "react";

/**
 * A small, calm "where this data came from" caveat. Reusable across features
 * that surface auto-collected data (prereqs now; transfers/programs later).
 * Deliberately low-key — the north-star first-gen student should be informed,
 * not alarmed.
 */
export default function DataProvenanceNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-[10px] leading-snug text-slate-400 dark:text-slate-500">
      <svg
        className="mt-px h-3 w-3 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8h.01M11 12h1v4h1" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
