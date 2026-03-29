"use client";

import { useRouter } from "next/navigation";

interface TermOption {
  code: string;
  label: string;
}

interface Props {
  terms: TermOption[];
  currentTerm: string;
  collegeId: string;
}

export default function TermSelector({ terms, currentTerm, collegeId }: Props) {
  const router = useRouter();

  // Sort terms newest first
  const sorted = [...terms].sort((a, b) => b.code.localeCompare(a.code));

  return (
    <select
      value={currentTerm}
      onChange={(e) => {
        const term = e.target.value;
        router.push(`/college/${collegeId}?term=${term}`);
      }}
      className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 hover:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 cursor-pointer"
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
