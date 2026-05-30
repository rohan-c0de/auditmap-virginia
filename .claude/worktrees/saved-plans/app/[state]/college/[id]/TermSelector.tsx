"use client";

interface TermOption {
  code: string;
  label: string;
}

interface Props {
  terms: TermOption[];
  currentTerm: string;
  onTermChange: (term: string) => void;
}

export default function TermSelector({ terms, currentTerm, onTermChange }: Props) {
  // Sort terms newest first
  const sorted = [...terms].sort((a, b) => b.code.localeCompare(a.code));

  return (
    <select
      value={currentTerm}
      onChange={(e) => onTermChange(e.target.value)}
      className="text-sm border border-gray-300 dark:border-slate-600 rounded-lg px-3 py-1.5 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 cursor-pointer"
      aria-label="Select term"
    >
      {sorted.map((t) => (
        <option key={t.code} value={t.code}>
          {t.label}
        </option>
      ))}
    </select>
  );
}
