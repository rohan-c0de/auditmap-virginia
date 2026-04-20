"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import CourseTable from "@/components/CourseTableDynamic";
import type { Institution, CourseSection } from "@/lib/types";

// Dynamic imports keep the heavy interactive components out of the college
// page's initial JS bundle. Lighthouse mobile identified college as the
// worst-performing page (TBT 1.1 s post-#15, score 59) because these three
// client chunks load + parse + execute synchronously with first paint even
// though they only become useful after user interaction:
//
//   - ScheduleBuilder (302 lines)  — used once the user pins ≥2 courses;
//                                    below the course table on every render.
//   - AuditInstructions (277 lines) — only shown inside the "How to audit"
//                                    modal.
//   - PrintInstructions (140 lines) — only shown inside the same modal.
//
// `ssr: false` because none of these contribute to SEO content; the
// course table + static audit badges on the page handle that. The
// placeholder is a 200 px skeleton that reserves the ScheduleBuilder's
// layout slot so there's no CLS when it swaps in.

const ScheduleBuilder = dynamic(
  () => import("@/components/ScheduleBuilder"),
  {
    ssr: false,
    loading: () => (
      <div className="mt-6 h-[200px] w-full animate-pulse rounded-lg bg-gray-100 dark:bg-slate-800" />
    ),
  }
);

const AuditInstructions = dynamic(
  () => import("@/components/AuditInstructions"),
  { ssr: false }
);

const PrintInstructions = dynamic(
  () => import("@/components/PrintInstructions"),
  { ssr: false }
);

type TransferLookup = Record<
  string,
  { university: string; type: "direct" | "elective" | "no-credit"; course: string }[]
>;

interface Props {
  courses: CourseSection[];
  institution: Institution;
  collegeSlug: string;
  transferLookup?: TransferLookup;
  systemName?: string;
  courseListingUrl?: string;
  state?: string;
}

export default function CollegeDetailClient({
  courses,
  institution,
  collegeSlug,
  systemName,
  transferLookup,
  courseListingUrl,
  state,
}: Props) {
  const [selectedCourse, setSelectedCourse] = useState<CourseSection | null>(
    null
  );
  const [showInstructions, setShowInstructions] = useState(false);
  const [pinnedCRNs, setPinnedCRNs] = useState<Set<string>>(new Set());

  // Lock body scroll when modal is open
  useEffect(() => {
    if (showInstructions) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [showInstructions]);

  function togglePin(crn: string) {
    setPinnedCRNs((prev) => {
      const next = new Set(prev);
      if (next.has(crn)) next.delete(crn);
      else next.add(crn);
      return next;
    });
  }

  return (
    <div>
      <CourseTable
        courses={courses}
        collegeSlug={collegeSlug}
        systemName={systemName}
        courseListingUrl={courseListingUrl}
        onAuditClick={(course) => {
          setSelectedCourse(course);
          setShowInstructions(true);
        }}
        pinnedCRNs={pinnedCRNs}
        onTogglePin={togglePin}
        transferLookup={transferLookup}
        state={state}
      />

      <ScheduleBuilder
        courses={courses}
        pinnedCRNs={pinnedCRNs}
        onTogglePin={togglePin}
      />

      {/* Audit instructions modal */}
      {showInstructions && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setShowInstructions(false); }}
          onKeyDown={(e) => { if (e.key === "Escape") setShowInstructions(false); }}
        >
          <div className="bg-white dark:bg-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 relative">
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <PrintInstructions
                institution={institution}
                course={selectedCourse || undefined}
              />
              <button
                type="button"
                onClick={() => setShowInstructions(false)}
                aria-label="Close dialog"
                className="text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 text-2xl leading-none"
              >
                &times;
              </button>
            </div>
            <AuditInstructions
              institution={institution}
              course={selectedCourse || undefined}
              defaultOpen={true}
            />
          </div>
        </div>
      )}
    </div>
  );
}
