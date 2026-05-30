"use client";

import type { Institution, CourseSection } from "@/lib/types";
import { expandDays } from "@/lib/time-utils";

interface Props {
  institution: Institution;
  course?: CourseSection;
}

export default function PrintInstructions({ institution, course }: Props) {
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

  function handlePrint() {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const courseInfo = course
      ? `<div style="margin-bottom:20px;padding:12px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;">
           <strong>Course:</strong> ${course.course_prefix} ${course.course_number} — ${course.course_title}<br/>
           <strong>CRN:</strong> ${course.crn}<br/>
           <strong>Schedule:</strong> ${course.days ? expandDays(course.days) : "Online"} ${course.start_time && course.start_time !== "TBA" ? course.start_time + "–" + course.end_time : ""}<br/>
           <strong>Campus:</strong> ${course.campus || "Virtual"}
         </div>`
      : "";

    const stepsHtml = application_process.steps
      .map(
        (step, i) =>
          `<li style="margin-bottom:8px;"><strong>${i + 1}.</strong> ${step}</li>`
      )
      .join("");

    const restrictionsHtml =
      audit_policy.restrictions.length > 0
        ? `<div style="margin-top:20px;">
             <h3 style="margin-bottom:8px;">Restrictions</h3>
             <ul style="padding-left:20px;">${audit_policy.restrictions.map((r) => `<li style="margin-bottom:4px;">${r}</li>`).join("")}</ul>
           </div>`
        : "";

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Audit Instructions — ${institution.name}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    h2 { font-size: 16px; color: #0d9488; margin-top: 24px; margin-bottom: 8px; }
    h3 { font-size: 14px; color: #374151; }
    .subtitle { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
    .deadline { padding: 10px 14px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 6px; margin-bottom: 20px; font-size: 14px; }
    .email-box { padding: 14px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; font-style: italic; font-size: 14px; }
    .contact { font-size: 14px; }
    .footer { margin-top: 30px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    ol { padding-left: 0; list-style: none; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <h1>How to Audit a Course at ${institution.name}</h1>
  <p class="subtitle">${institution.campuses.map((c) => c.name).join(" · ")}</p>

  ${courseInfo}

  ${application_process.timing ? `<div class="deadline"><strong>Deadline:</strong> ${application_process.timing}</div>` : ""}

  <h2>Steps to Apply</h2>
  <ol>${stepsHtml}</ol>

  ${application_process.form_url ? `<p><strong>Audit Request Form:</strong> <a href="${application_process.form_url}">${application_process.form_url}</a></p>` : ""}

  <h2>Email Template</h2>
  <div class="email-box">
    <strong>To:</strong> ${application_process.contact_email}<br/>
    <strong>Subject:</strong> Course Audit Inquiry${course ? `: ${course.course_prefix} ${course.course_number} — ${term}` : ` — ${institution.name}`}<br/><br/>
    ${emailTemplate.replace(/\n/g, "<br/>")}
  </div>

  <h2>Contact</h2>
  <div class="contact">
    ${application_process.contact_email ? `<p>Email: ${application_process.contact_email}</p>` : ""}
    ${application_process.contact_phone ? `<p>Phone: ${application_process.contact_phone}</p>` : ""}
  </div>

  ${restrictionsHtml}

  <div class="footer">
    <p>Generated from Community College Path · Last verified: ${audit_policy.last_verified}</p>
    ${audit_policy.source_url ? `<p>Source: ${audit_policy.source_url}</p>` : ""}
    <p>Always confirm directly with the college before enrolling.</p>
  </div>

  <script>window.print();</script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-slate-300 transition hover:bg-gray-50 dark:hover:bg-slate-700"
    >
      <svg
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
        />
      </svg>
      Print instructions
    </button>
  );
}
