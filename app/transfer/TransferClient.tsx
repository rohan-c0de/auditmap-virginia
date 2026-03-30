"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { TransferMapping } from "@/lib/types";

interface Props {
  universities: { slug: string; name: string }[];
  mappings: TransferMapping[];
  courseAvailability: Record<
    string,
    { colleges: string[]; totalSections: number }
  >;
  defaultUniversity: string;
}

export default function TransferClient({
  universities,
  mappings,
  courseAvailability,
  defaultUniversity,
}: Props) {
  const [selectedUniversity, setSelectedUniversity] = useState(defaultUniversity);
  const [subjectFilter, setSubjectFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<
    "" | "direct" | "elective" | "no-credit"
  >("");
  const [availableOnly, setAvailableOnly] = useState(false);

  // Filter mappings by selected university first
  const universityMappings = useMemo(() => {
    return mappings.filter((m) => m.university === selectedUniversity);
  }, [mappings, selectedUniversity]);

  // Get unique subjects from university-filtered mappings
  const subjects = useMemo(() => {
    const s = new Set(universityMappings.map((m) => m.vccs_prefix));
    return Array.from(s).sort();
  }, [universityMappings]);

  // Apply additional filters
  const filtered = useMemo(() => {
    return universityMappings.filter((m) => {
      if (subjectFilter && m.vccs_prefix !== subjectFilter) return false;
      if (typeFilter === "direct" && (m.no_credit || m.is_elective))
        return false;
      if (typeFilter === "elective" && (!m.is_elective || m.no_credit))
        return false;
      if (typeFilter === "no-credit" && !m.no_credit) return false;
      if (availableOnly) {
        const key = `${m.vccs_prefix}-${m.vccs_number}`;
        if (!courseAvailability[key]) return false;
      }
      return true;
    });
  }, [universityMappings, subjectFilter, typeFilter, availableOnly, courseAvailability]);

  // Group by subject prefix
  const grouped = useMemo(() => {
    const map = new Map<string, TransferMapping[]>();
    for (const m of filtered) {
      if (!map.has(m.vccs_prefix)) map.set(m.vccs_prefix, []);
      map.get(m.vccs_prefix)!.push(m);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  // Stats (based on selected university's mappings)
  const stats = useMemo(() => {
    const direct = universityMappings.filter((m) => !m.no_credit && !m.is_elective).length;
    const elective = universityMappings.filter((m) => m.is_elective && !m.no_credit).length;
    const noCredit = universityMappings.filter((m) => m.no_credit).length;
    const available = universityMappings.filter((m) => {
      const key = `${m.vccs_prefix}-${m.vccs_number}`;
      return courseAvailability[key] && !m.no_credit;
    }).length;
    return { direct, elective, noCredit, total: universityMappings.length, available };
  }, [universityMappings, courseAvailability]);

  const uniName =
    universities.find((u) => u.slug === selectedUniversity)?.name ||
    selectedUniversity;

  return (
    <div>
      {/* University selector */}
      <div className="mb-6">
        <label className="text-sm font-medium text-gray-700 mr-2">
          I want to transfer to:
        </label>
        <select
          value={selectedUniversity}
          onChange={(e) => {
            setSelectedUniversity(e.target.value);
            setSubjectFilter("");
            setTypeFilter("");
          }}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
        >
          {universities.map((u) => (
            <option key={u.slug} value={u.slug}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats banner */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-center">
          <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          <p className="text-xs text-gray-500">Total Mappings</p>
        </div>
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-4 text-center">
          <p className="text-2xl font-bold text-teal-700">{stats.direct}</p>
          <p className="text-xs text-teal-600">Direct Equivalencies</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{stats.elective}</p>
          <p className="text-xs text-blue-600">Elective Credit</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-700">
            {stats.available}
          </p>
          <p className="text-xs text-emerald-600">Available This Term</p>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="min-w-[140px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Subject
          </label>
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Subjects ({subjects.length})</option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Transfer Type
          </label>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(
                e.target.value as "" | "direct" | "elective" | "no-credit"
              )
            }
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-200"
          >
            <option value="">All Types</option>
            <option value="direct">Direct Equivalencies Only</option>
            <option value="elective">Elective Credit Only</option>
            <option value="no-credit">No Credit</option>
          </select>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm text-gray-700">
            Available this term only
          </span>
        </label>

        <span className="ml-auto text-sm text-gray-500">
          {filtered.length} courses
        </span>
      </div>

      {/* Results grouped by subject */}
      {grouped.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-gray-500">No courses match your filters.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([prefix, courses]) => (
            <div key={prefix}>
              {/* Subject header */}
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                <span>{prefix}</span>
                <span className="h-px flex-1 bg-gray-200" />
                <span className="font-normal text-gray-400">
                  {courses.length} courses
                </span>
              </h3>

              {/* Course rows */}
              <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
                {courses.map((m, i) => {
                  const key = `${m.vccs_prefix}-${m.vccs_number}`;
                  const availability = courseAvailability[key];

                  return (
                    <div
                      key={i}
                      className={`px-4 py-3 ${m.no_credit ? "bg-gray-50 opacity-60" : ""}`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        {/* Left: VCCS course → University course */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900">
                              {m.vccs_course}
                            </span>
                            {!m.no_credit && (
                              <>
                                <span className="text-gray-400">&rarr;</span>
                                <span
                                  className={`font-medium ${
                                    m.is_elective
                                      ? "text-blue-700"
                                      : "text-teal-700"
                                  }`}
                                >
                                  {m.univ_course}
                                </span>
                              </>
                            )}
                            {m.no_credit && (
                              <span className="text-xs text-red-500 font-medium">
                                No {uniName} credit
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            {m.vccs_title}
                            {!m.no_credit && m.univ_title && (
                              <span className="text-gray-400">
                                {" "}
                                &rarr; {m.univ_title}
                              </span>
                            )}
                          </div>
                          {m.notes && (
                            <p className="text-[10px] text-amber-600 mt-1">
                              {m.notes}
                            </p>
                          )}
                        </div>

                        {/* Right: credits + availability */}
                        <div className="flex items-center gap-3 shrink-0">
                          {!m.no_credit && (
                            <span className="text-xs text-gray-400">
                              {m.vccs_credits} cr &rarr; {m.univ_credits} cr
                            </span>
                          )}
                          {m.is_elective && !m.no_credit && (
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                              Elective
                            </span>
                          )}
                          {!m.is_elective && !m.no_credit && (
                            <span className="inline-flex items-center rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-inset ring-teal-200">
                              Direct
                            </span>
                          )}
                          {availability && !m.no_credit && (
                            <Link
                              href={`/courses?q=${m.vccs_prefix}+${m.vccs_number}`}
                              className="text-[10px] text-teal-600 hover:text-teal-800 hover:underline whitespace-nowrap"
                            >
                              {availability.totalSections} sections at{" "}
                              {availability.colleges.length}{" "}
                              {availability.colleges.length === 1
                                ? "college"
                                : "colleges"}{" "}
                              &rarr;
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
