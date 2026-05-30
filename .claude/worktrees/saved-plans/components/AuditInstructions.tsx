"use client";

import { useState } from "react";
import type { Institution, CourseSection } from "@/lib/types";

interface AuditInstructionsProps {
  institution: Institution;
  course?: CourseSection;
  defaultOpen?: boolean;
}

export default function AuditInstructions({
  institution,
  course,
  defaultOpen = false,
}: AuditInstructionsProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [emailCopied, setEmailCopied] = useState(false);

  const { audit_policy } = institution;
  const { application_process } = audit_policy;

  // Convert term code like "2026SU" to "Summer 2026"
  function formatTerm(code?: string): string {
    if (!code) return "this term";
    const match = code.match(/^(\d{4})(SP|SU|FA)$/);
    if (!match) return code;
    const season = match[2] === "SP" ? "Spring" : match[2] === "SU" ? "Summer" : "Fall";
    return `${season} ${match[1]}`;
  }

  const term = course ? formatTerm(course.term) : "this term";

  const emailTemplate = course
    ? `Hello,\n\nI would like to audit the following course:\n\nCourse: ${course.course_prefix} ${course.course_number} — ${course.course_title}\nCRN: ${course.crn}\nTerm: ${term}\n\nCould you let me know the process to register as an auditor and confirm that this course is available for auditing?\n\nThank you,\n[Your Name]`
    : `Hello,\n\nI am interested in auditing a course at ${institution.name} ${term === "this term" ? "this term" : `for ${term}`}. Could you let me know the process to register as an auditor?\n\nThank you,\n[Your Name]`;

  const emailSubject = course
    ? `Course Audit Inquiry: ${course.course_prefix} ${course.course_number} — ${term}`
    : `Course Audit Inquiry — ${institution.name}`;

  const mailtoHref = `mailto:${application_process.contact_email}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailTemplate)}`;

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(emailTemplate);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement("textarea");
      textarea.value = emailTemplate;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition hover:bg-gray-50 dark:hover:bg-slate-800 sm:px-6"
        aria-expanded={isOpen}
      >
        <div>
          <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">
            How to Audit a Course
          </h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Step-by-step instructions for {institution.name}
          </p>
        </div>
        <svg
          className={`h-5 w-5 shrink-0 text-gray-400 dark:text-slate-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expandable content */}
      {isOpen && (
        <div className="border-t border-gray-200 dark:border-slate-700 px-5 py-5 sm:px-6">
          {/* Deadline callout */}
          {application_process.timing && (
            <div className="mb-5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                <svg
                  className="mr-1.5 inline h-4 w-4 text-amber-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Timing: {application_process.timing}
              </p>
            </div>
          )}

          {/* Steps */}
          <div className="mb-5">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Steps
            </h4>
            <ol className="space-y-3">
              {application_process.steps.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30 text-xs font-bold text-teal-700 dark:text-teal-400">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-sm text-gray-700 dark:text-slate-300">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Audit form link */}
          {application_process.form_url && (
            <div className="mb-5">
              <a
                href={application_process.form_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
              >
                Open Audit Request Form
                <svg
                  className="ml-2 h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
              </a>
            </div>
          )}

          {/* Email template */}
          <div className="mb-5">
            <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Email Template
            </h4>
            <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-4">
              <p className="text-sm italic text-gray-700 dark:text-slate-300 whitespace-pre-line">{emailTemplate}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyEmail}
                  className="inline-flex items-center rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 transition hover:bg-gray-50 dark:hover:bg-slate-700"
                >
                  {emailCopied ? (
                    <>
                      <svg className="mr-1.5 h-3.5 w-3.5 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="mr-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                      </svg>
                      Copy email
                    </>
                  )}
                </button>
                <a
                  href={mailtoHref}
                  className="inline-flex items-center rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/30 px-3 py-1.5 text-xs font-medium text-teal-700 dark:text-teal-400 transition hover:bg-teal-100 dark:hover:bg-teal-900/50"
                >
                  <svg className="mr-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Open in email app
                </a>
              </div>
            </div>
          </div>

          {/* What to expect */}
          <div className="mb-5 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/30 px-4 py-3">
            <p className="text-sm text-blue-800 dark:text-blue-300">
              <span className="font-semibold">What to expect: </span>The college
              may ask for additional information such as your name, student ID,
              unofficial transcript, or instructor approval. Response times
              vary — follow up if you don&apos;t hear back within a week.
            </p>
          </div>

          {/* Contact info */}
          <div className="mb-5">
            <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Contact
            </h4>
            <div className="space-y-1 text-sm text-gray-700 dark:text-slate-300">
              {application_process.contact_email && (
                <p>
                  Email:{" "}
                  <a
                    href={`mailto:${application_process.contact_email}`}
                    className="font-medium text-teal-600 hover:underline"
                  >
                    {application_process.contact_email}
                  </a>
                </p>
              )}
              {application_process.contact_phone && (
                <p>
                  Phone:{" "}
                  <a
                    href={`tel:${application_process.contact_phone}`}
                    className="font-medium text-teal-600 hover:underline"
                  >
                    {application_process.contact_phone}
                  </a>
                </p>
              )}
            </div>
          </div>

          {/* Restrictions */}
          {audit_policy.restrictions.length > 0 && (
            <div className="mb-5">
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400">
                Restrictions
              </h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-gray-600 dark:text-slate-400">
                {audit_policy.restrictions.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Verification footer */}
          <div className="rounded-lg bg-gray-50 dark:bg-slate-800 px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
            Last verified: {audit_policy.last_verified}
            {audit_policy.source_url && (
              <>
                {" "}&middot;{" "}
                <a
                  href={audit_policy.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 hover:underline"
                >
                  View source
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
