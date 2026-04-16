"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { TransferMapping } from "@/lib/types";

type Props = {
  mappings: TransferMapping[];
  state: string;
  universityName: string;
};

type SortKey = "cc" | "univ" | "type";
type TypeFilter = "all" | "direct" | "elective";

export default function TransferHubClient({
  mappings,
  state,
}: Props) {
  const [query, setQuery] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortKey>("cc");

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const m of mappings) set.add(m.cc_prefix);
    return Array.from(set).sort();
  }, [mappings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = mappings.filter((m) => {
      if (subjectFilter !== "all" && m.cc_prefix !== subjectFilter) return false;
      if (typeFilter === "direct" && m.is_elective) return false;
      if (typeFilter === "elective" && !m.is_elective) return false;
      if (q) {
        const hay =
          `${m.cc_prefix} ${m.cc_number} ${m.cc_title} ${m.univ_course} ${m.univ_title}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sort === "cc") {
        const ak = `${a.cc_prefix} ${a.cc_number}`;
        const bk = `${b.cc_prefix} ${b.cc_number}`;
        return ak.localeCompare(bk);
      }
      if (sort === "univ") {
        return (a.univ_course || "").localeCompare(b.univ_course || "");
      }
      // type: direct before elective, then alpha
      if (a.is_elective !== b.is_elective) return a.is_elective ? 1 : -1;
      return `${a.cc_prefix} ${a.cc_number}`.localeCompare(
        `${b.cc_prefix} ${b.cc_number}`
      );
    });

    return list;
  }, [mappings, query, subjectFilter, typeFilter, sort]);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
        <input
          type="search"
          placeholder="Search course code or title..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[180px] rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <select
          value={subjectFilter}
          onChange={(e) => setSubjectFilter(e.target.value)}
          className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All transfer types</option>
          <option value="direct">Direct equivalent</option>
          <option value="elective">Elective credit</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="cc">Sort: Community college course</option>
          <option value="univ">Sort: University course</option>
          <option value="type">Sort: Transfer type</option>
        </select>
      </div>

      {/* Results count */}
      <div className="px-4 py-2 text-xs text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-700">
        Showing {filtered.length} of {mappings.length} courses
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-slate-400">
          No courses match your filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2.5 font-medium">Community College Course</th>
                <th className="px-4 py-2.5 font-medium">Credits</th>
                <th className="px-4 py-2.5 font-medium">Transfers As</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {filtered.map((m, i) => {
                const code = `${m.cc_prefix}-${m.cc_number}`.toLowerCase();
                return (
                  <tr
                    key={`${m.cc_prefix}-${m.cc_number}-${m.univ_course}-${i}`}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/${state}/course/${code}`}
                        className="font-medium text-teal-700 dark:text-teal-400 hover:underline"
                      >
                        {m.cc_prefix} {m.cc_number}
                      </Link>
                      {m.cc_title && (
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                          {m.cc_title}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">
                      {m.cc_credits || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900 dark:text-slate-100">
                        {m.univ_course || "—"}
                      </div>
                      {m.univ_title && (
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                          {m.univ_title}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {m.is_elective ? (
                        <span className="inline-block rounded-full bg-amber-50 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                          Elective
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                          Direct
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400 max-w-xs">
                      {m.notes ? m.notes : <span className="text-gray-300 dark:text-slate-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
