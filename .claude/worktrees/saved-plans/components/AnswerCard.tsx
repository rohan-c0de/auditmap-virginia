// AnswerCard renders a structured Answer from /api/[state]/ask above the
// course search results. One card per query.
//
// Variant routing:
//   transfer     → TransferBody (status-driven: yes / partial / no / etc.)
//   prereqs      → PrereqsBody  (status-driven: found / no-prereqs / etc.)
//   eligibility  → EligibilityBody (per-college breakdown + state summary)
//   pathway      → PathwayBody  (found-degree / no-data / missing-entity)
//   none         → null (no card; UI just renders course search results)
//
// Every typed answer carries a SourceCitation; footer renders that as a
// trust signal so first-gen students can verify the underlying data.

"use client";

import type { Answer, SourceCitation } from "@/lib/search-intent/answer";

export interface ClassificationSummary {
  studentSummary: string;
  clarifyingQuestion: string | null;
  suggestedFollowups: string[];
}

interface AnswerCardProps {
  answer: Answer;
  state: string;
  classification?: ClassificationSummary | null;
  onFollowupClick?: (q: string) => void;
}

export default function AnswerCard({ answer, state, classification, onFollowupClick }: AnswerCardProps) {
  // `intent-not-supported` fires for course intents, where the course
  // search results below are the actual answer. We don't render the full
  // typed-answer card, but we DO surface the LLM's studentSummary so the
  // user sees what we understood ("You're asking about ENG 111") — without
  // it, a natural-language query like "is ENG 111 offered?" looks like it
  // was ignored. Every other NoAnswer carries a helpful message the user
  // should see — render those as a quieter info card.
  if (answer.type === "none") {
    if (answer.reason === "intent-not-supported") {
      if (classification?.studentSummary) {
        return (
          <CourseSummaryCard
            summary={classification.studentSummary}
            followups={classification.suggestedFollowups ?? []}
            onFollowupClick={onFollowupClick}
          />
        );
      }
      return null;
    }
    return (
      <NoAnswerCard
        answer={answer}
        classification={classification}
        onFollowupClick={onFollowupClick}
      />
    );
  }

  const followups = dedupeFollowups(
    answer.followups ?? [],
    classification?.suggestedFollowups ?? [],
  );

  return (
    <div
      className="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      data-testid="answer-card"
      role="region"
      aria-live="polite"
      aria-label="Answer to your question"
    >
      <div className="p-5 space-y-3">
        {classification?.studentSummary && (
          <p className="text-xs italic text-slate-500 dark:text-slate-400">
            {classification.studentSummary}
          </p>
        )}
        {answer.type === "transfer" && <TransferBody answer={answer} />}
        {answer.type === "prereqs" && <PrereqsBody answer={answer} state={state} />}
        {answer.type === "eligibility" && <EligibilityBody answer={answer} />}
        {answer.type === "pathway" && <PathwayBody answer={answer} state={state} />}
        {classification?.clarifyingQuestion && (
          <ClarifyingPrompt
            question={classification.clarifyingQuestion}
            onSearch={onFollowupClick}
          />
        )}
        {followups.length > 0 && (
          <FollowupPills followups={followups} onFollowupClick={onFollowupClick} />
        )}
      </div>
      <SourceFooter source={answer.source} />
    </div>
  );
}

// ─── Course confirmation (slim card for course intents) ────────────────
//
// When the LLM classifies a query as a course search, we don't render a
// typed answer (the course results below are the answer). But we do echo
// back what we understood so the user gets feedback on natural-language
// queries like "is ENG 111 offered this semester?" — without it, the
// studentSummary work would be invisible for the most common intent.

function CourseSummaryCard({
  summary,
  followups,
  onFollowupClick,
}: {
  summary: string;
  followups: string[];
  onFollowupClick?: (q: string) => void;
}) {
  return (
    <div
      className="mb-4 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-2"
      data-testid="answer-card"
      role="region"
      aria-live="polite"
      aria-label="What we understood"
    >
      <p className="text-sm italic text-slate-600 dark:text-slate-300">
        {summary}
      </p>
      {followups.length > 0 && (
        <FollowupPills followups={followups} onFollowupClick={onFollowupClick} />
      )}
    </div>
  );
}

// ─── NoAnswer (informational hint card) ─────────────────────────────────

function NoAnswerCard({
  answer,
  classification,
  onFollowupClick,
}: {
  answer: Extract<Answer, { type: "none" }>;
  classification?: ClassificationSummary | null;
  onFollowupClick?: (q: string) => void;
}) {
  const followups = dedupeFollowups(
    answer.followups ?? [],
    classification?.suggestedFollowups ?? [],
  );

  // No source citation (NoAnswer has no SourceCitation). Visually softer
  // than typed answers — slate background, no colored accent — to signal
  // "this is a hint, not an authoritative answer."
  return (
    <div
      className="mb-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-4"
      data-testid="answer-card"
      role="region"
      aria-live="polite"
      aria-label="Hint about your question"
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 text-slate-500 dark:text-slate-400"
          aria-hidden="true"
        >
          💭
        </span>
        <div className="flex-1">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {answer.message}
          </p>
          {answer.suggestions && answer.suggestions.length > 0 && (
            <ul className="mt-2 text-sm text-slate-600 dark:text-slate-300 space-y-0.5">
              {answer.suggestions.map((s) => (
                <li key={s}>• {s}</li>
              ))}
            </ul>
          )}
          {followups.length > 0 && (
            <div className="mt-3">
              <FollowupPills followups={followups} onFollowupClick={onFollowupClick} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Transfer ───────────────────────────────────────────────────────────

function TransferBody({
  answer,
}: {
  answer: Extract<Answer, { type: "transfer" }>;
}) {
  const courseLabel = `${answer.course.prefix} ${answer.course.number}`;

  switch (answer.status) {
    case "yes": {
      const eq = answer.equivalency!;
      return (
        <>
          <Headline tone="success" icon="✓">
            Yes — {courseLabel} transfers to {answer.university!.name} as{" "}
            <strong>{eq.univ_course}</strong>
            {eq.univ_credits ? ` (${eq.univ_credits} credits)` : ""}
          </Headline>
          {eq.univ_title && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {eq.univ_title}
            </p>
          )}
          {eq.notes && <Note>{eq.notes}</Note>}
        </>
      );
    }
    case "partial": {
      const eq = answer.equivalency!;
      const reason = eq.no_credit
        ? "but receives no credit at the university"
        : "as elective credit only";
      return (
        <>
          <Headline tone="warning" icon="⚠">
            {courseLabel} transfers to {answer.university!.name} as{" "}
            <strong>{eq.univ_course || "(elective)"}</strong>, {reason}.
          </Headline>
          {eq.notes && <Note>{eq.notes}</Note>}
        </>
      );
    }
    case "no": {
      return (
        <>
          <Headline tone="neutral" icon="✗">
            We don&apos;t have a transfer agreement on file for {courseLabel} →{" "}
            {answer.university!.name}.
          </Headline>
          {answer.alternatives && answer.alternatives.length > 0 && (
            <AlternativesList
              label={`${courseLabel} does transfer to:`}
              items={answer.alternatives}
            />
          )}
        </>
      );
    }
    case "no-destination": {
      return (
        <>
          <Headline tone="info" icon="↪">
            {courseLabel} transfers to several universities:
          </Headline>
          {answer.alternatives && (
            <AlternativesList items={answer.alternatives} />
          )}
        </>
      );
    }
    case "unknown-course":
      return (
        <Headline tone="neutral" icon="?">
          We couldn&apos;t find {courseLabel} in this state&apos;s catalog. Try
          a course code from the search below.
        </Headline>
      );
    case "unknown-university":
      return (
        <>
          <Headline tone="neutral" icon="?">
            We don&apos;t have transfer data for that university.
          </Headline>
          {answer.suggestions && answer.suggestions.length > 0 && (
            <SuggestionList
              label="Did you mean:"
              items={answer.suggestions.map((s) => s.name)}
            />
          )}
        </>
      );
    case "no-data":
      return (
        <Headline tone="neutral" icon="—">
          Transfer data isn&apos;t available for this state yet.
        </Headline>
      );
  }
}

// ─── Prereqs ────────────────────────────────────────────────────────────

function PrereqsBody({
  answer,
  state,
}: {
  answer: Extract<Answer, { type: "prereqs" }>;
  state: string;
}) {
  if (answer.status === "no-course-named") {
    return (
      <Headline tone="neutral" icon="?">
        Which course&apos;s prerequisites are you asking about? Try &ldquo;prereqs for BIO 256&rdquo;.
      </Headline>
    );
  }

  const courseLabel = answer.course
    ? `${answer.course.prefix} ${answer.course.number}`
    : "this course";

  switch (answer.status) {
    case "found": {
      // Top-level prereq courses from the chain (one level deep).
      // Multi-level rendering is intentionally deferred; the deepest
      // info isn't usually what the user wants on the answer card.
      const chain = answer.chain;
      const topLevel = chain?.children ?? [];
      const groups = chain?.groups;
      return (
        <>
          <Headline tone="info" icon="📋">
            To take <strong>{courseLabel}</strong>, you need:
          </Headline>
          {chain?.text && (
            <p className="text-sm text-slate-700 dark:text-slate-200">
              {chain.text}
            </p>
          )}
          {groups && groups.length > 0 ? (
            <div className="space-y-1.5">
              {groups.map((group, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  {i > 0 && (
                    <span className="text-xs font-medium uppercase text-slate-400">
                      and
                    </span>
                  )}
                  {group.map((c, j) => (
                    <span key={c.course} className="flex items-center gap-1.5">
                      {j > 0 && (
                        <span className="text-xs uppercase text-slate-400">
                          or
                        </span>
                      )}
                      <CoursePill course={c.course} state={state} />
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            topLevel.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {topLevel.map((c) => (
                  <CoursePill key={c.course} course={c.course} state={state} />
                ))}
              </div>
            )
          )}
        </>
      );
    }
    case "unlocks": {
      const courses = answer.unlocks ?? [];
      return (
        <>
          <Headline tone="success" icon="🔓">
            Completing <strong>{courseLabel}</strong> unlocks{" "}
            {courses.length} {courses.length === 1 ? "course" : "courses"}:
          </Headline>
          <div className="flex flex-wrap gap-1.5">
            {courses.map((c) => (
              <CoursePill key={c} course={c} state={state} />
            ))}
          </div>
        </>
      );
    }
    case "no-unlocks":
      return (
        <Headline tone="neutral" icon="—">
          No courses in this state&apos;s catalog list {courseLabel} as a prerequisite.
        </Headline>
      );
    case "no-prereqs":
      return (
        <Headline tone="success" icon="✓">
          {courseLabel} has no prerequisites — you can take it directly.
        </Headline>
      );
    case "unknown-course":
      return (
        <Headline tone="neutral" icon="?">
          We couldn&apos;t find {courseLabel} in this state&apos;s catalog.
        </Headline>
      );
    case "no-data":
      return (
        <Headline tone="neutral" icon="—">
          Prerequisite data isn&apos;t available for this state yet.
        </Headline>
      );
  }
}

// ─── Eligibility ────────────────────────────────────────────────────────

function EligibilityBody({
  answer,
}: {
  answer: Extract<Answer, { type: "eligibility" }>;
}) {
  // Cap to first 5 colleges to keep the card from dominating the page.
  const visible = answer.colleges.slice(0, 5);
  const remaining = answer.colleges.length - visible.length;

  return (
    <>
      <Headline tone="info" icon="🎓">
        {answer.summary}
      </Headline>
      {visible.length > 0 && (
        <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {visible.map((c) => (
              <li
                key={c.slug}
                className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                    {c.name}
                  </div>
                  {c.notes && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {c.notes}
                    </div>
                  )}
                </div>
                <div className="text-right whitespace-nowrap">
                  <span
                    className={`text-xs font-medium ${
                      c.eligible
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {c.eligible ? "Eligible" : "Not available"}
                  </span>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    {c.cost}
                    {c.ageThreshold ? ` · ${c.ageThreshold}+` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {remaining > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          + {remaining} more college{remaining === 1 ? "" : "s"} not shown.
        </p>
      )}
    </>
  );
}

// ─── Pathway (degree requirements) ──────────────────────────────────────

function PathwayBody({
  answer,
  state,
}: {
  answer: Extract<Answer, { type: "pathway" }>;
  state: string;
}) {
  if (
    (answer.status === "found-degree" || answer.status === "found-related") &&
    answer.degreeRequirements?.length
  ) {
    const isRelated = answer.status === "found-related";
    const majorLabel = answer.major?.replace(/-/g, " ") ?? null;
    return (
      <>
        <Headline tone={isRelated ? "info" : "success"} icon="📋">
          {isRelated
            ? `No standalone ${majorLabel ?? "matching"} degree found${
                answer.college ? ` at ${answer.college.name}` : ""
              } — here ${
                answer.degreeRequirements.length === 1 ? "is" : "are"
              } ${answer.degreeRequirements.length} related program${
                answer.degreeRequirements.length === 1 ? "" : "s"
              } that include${
                answer.degreeRequirements.length === 1 ? "s" : ""
              } ${majorLabel ?? "this"} coursework:`
            : answer.degreeRequirements.length === 1
              ? `Found degree requirements${answer.college ? ` at ${answer.college.name}` : ""}`
              : `Found ${answer.degreeRequirements.length} matching programs${answer.college ? ` at ${answer.college.name}` : ""}`}
        </Headline>
        <div className="space-y-3">
          {answer.degreeRequirements.map((req, i) => (
            <div
              key={i}
              className="border border-slate-200 dark:border-slate-700 rounded-md px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {req.title}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {req.credential.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                {req.total_credits != null && (
                  <span>{req.total_credits} credits</span>
                )}
                {req.gpa_minimum != null && (
                  <span>{req.gpa_minimum} GPA min</span>
                )}
                {req.groups.length > 0 && (
                  <span>
                    {req.groups.length}{" "}
                    {req.groups.length === 1
                      ? "requirement group"
                      : "requirement groups"}
                  </span>
                )}
              </div>
              {req.groups.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {req.groups.slice(0, 6).map((g, gi) => (
                    <li
                      key={gi}
                      className="text-xs text-slate-600 dark:text-slate-300 flex items-baseline gap-1.5"
                    >
                      <span className="text-slate-400 dark:text-slate-500">
                        •
                      </span>
                      {g.name}
                      {g.credits_required != null && (
                        <span className="text-slate-400 dark:text-slate-500">
                          ({g.credits_required} cr)
                        </span>
                      )}
                      {g.course_count > 0 && (
                        <span className="text-slate-400 dark:text-slate-500">
                          · {g.course_count}{" "}
                          {g.course_count === 1 ? "course" : "courses"}
                        </span>
                      )}
                    </li>
                  ))}
                  {req.groups.length > 6 && (
                    <li className="text-xs text-slate-400 dark:text-slate-500 italic">
                      + {req.groups.length - 6} more groups
                    </li>
                  )}
                </ul>
              )}
              {req.catalog_url && (
                <a
                  href={req.catalog_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-teal-600 dark:text-teal-400 hover:underline mt-1 inline-block"
                >
                  View in catalog →
                </a>
              )}
            </div>
          ))}
        </div>
        {answer.college && (
          <Note>
            <a
              href={`/${state}/college/${answer.college.slug}/programs`}
              className="text-teal-600 dark:text-teal-400 hover:underline"
            >
              Browse all programs at {answer.college.name} →
            </a>
          </Note>
        )}
        {answer.relatedSubjects && answer.relatedSubjects.length > 0 && (
          <RelatedSubjectsPanel
            subjects={answer.relatedSubjects}
            // For found-related we add it as a "you can also" extension; for
            // found-degree it would be unusual but harmless.
            label={
              answer.status === "found-related"
                ? "Related courses you could take in this state"
                : "Related courses"
            }
          />
        )}
      </>
    );
  }

  if (
    answer.status === "found-courses-only" &&
    answer.relatedSubjects?.length
  ) {
    const majorLabel = answer.major?.replace(/-/g, " ") ?? null;
    return (
      <>
        <Headline tone="info" icon="📚">
          {majorLabel
            ? `No standalone ${majorLabel} associate degree found in this state, but ${answer.relatedSubjects.length === 1 ? "this subject is" : "these subjects are"} taught in the catalog:`
            : `No matching degree found, but related subjects are taught in the catalog:`}
        </Headline>
        <RelatedSubjectsPanel subjects={answer.relatedSubjects} />
      </>
    );
  }

  if (answer.status === "no-data") {
    const entity = answer.college?.name ?? answer.university?.name ?? "this college";
    return (
      <Headline tone="info" icon="📋">
        Degree requirement data isn&apos;t available yet for {entity}. Check
        back soon — we&apos;re adding more colleges regularly.
      </Headline>
    );
  }

  if (answer.status === "unknown-university") {
    return (
      <Headline tone="info" icon="🔍">
        We couldn&apos;t find that university in our data. Try a different
        spelling or check the transfer equivalency tool.
      </Headline>
    );
  }

  return (
    <Headline tone="info" icon="📋">
      Tell us which college or university you&apos;re interested in so we can
      look up requirements.
    </Headline>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────

function Headline({
  tone,
  icon,
  children,
}: {
  tone: "success" | "warning" | "neutral" | "info";
  icon: string;
  children: React.ReactNode;
}) {
  const toneClass = {
    success: "text-emerald-700 dark:text-emerald-400",
    warning: "text-amber-700 dark:text-amber-400",
    neutral: "text-slate-700 dark:text-slate-300",
    info: "text-teal-700 dark:text-teal-400",
  }[tone];
  return (
    <div className="flex items-start gap-2">
      <span className={`mt-0.5 ${toneClass}`} aria-hidden="true">
        {icon}
      </span>
      <p className={`text-base font-medium ${toneClass}`}>{children}</p>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400 italic">
      {children}
    </p>
  );
}

function RelatedSubjectsPanel({
  subjects,
  label,
}: {
  subjects: Array<{
    prefix: string;
    name: string;
    course_count: number;
    section_count: number;
    college_count: number;
    search_url: string;
  }>;
  label?: string;
}) {
  return (
    <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
      {label && (
        <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
        </p>
      )}
      <ul className="space-y-1">
        {subjects.map((s) => (
          <li
            key={s.prefix}
            className="text-sm text-slate-700 dark:text-slate-300"
          >
            <a
              href={s.search_url}
              className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
            >
              {s.name} ({s.prefix})
            </a>
            <span className="text-xs text-slate-500 dark:text-slate-400 ml-2">
              {s.course_count}{" "}
              {s.course_count === 1 ? "course" : "courses"}
              {s.college_count > 0 &&
                ` across ${s.college_count} ${s.college_count === 1 ? "college" : "colleges"}`}
              {s.section_count > 0 && ` · ${s.section_count} sections`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlternativesList({
  label,
  items,
}: {
  label?: string;
  items: Array<{
    slug: string;
    name: string;
    univ_course: string;
    is_elective: boolean;
    no_credit: boolean;
  }>;
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <p className="text-sm text-slate-600 dark:text-slate-300">{label}</p>
      )}
      <ul className="space-y-1 text-sm">
        {items.map((m) => (
          <li
            key={m.slug}
            className="flex items-baseline justify-between gap-3 border-b border-slate-100 dark:border-slate-800 last:border-0 pb-1 last:pb-0"
          >
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {m.name}
            </span>
            <span className="text-slate-600 dark:text-slate-300 text-xs">
              {m.univ_course || "—"}
              {m.is_elective ? " (elective)" : ""}
              {m.no_credit ? " (no credit)" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SuggestionList({
  label,
  items,
}: {
  label: string;
  items: string[];
}) {
  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-1">{label}</p>
      <ul className="text-sm text-slate-700 dark:text-slate-200">
        {items.map((s) => (
          <li key={s}>• {s}</li>
        ))}
      </ul>
    </div>
  );
}

function CoursePill({ course, state }: { course: string; state: string }) {
  // Course code format: "PREFIX NUMBER". Encode for URL safety.
  const q = encodeURIComponent(course);
  return (
    <a
      href={`/${state}/courses?q=${q}`}
      className="inline-flex items-center rounded-md border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-xs font-mono text-slate-800 dark:text-slate-200 hover:border-teal-500 hover:text-teal-700 transition-colors"
    >
      {course}
    </a>
  );
}

function dedupeFollowups(deterministic: string[], llmSuggested: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const q of [...deterministic, ...llmSuggested]) {
    const key = q.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(q);
    }
  }
  return result;
}

function ClarifyingPrompt({
  question,
  onSearch,
}: {
  question: string;
  onSearch?: (q: string) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
      <span className="mt-0.5 text-amber-600 dark:text-amber-400 text-sm" aria-hidden="true">
        ?
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-amber-800 dark:text-amber-200">{question}</p>
        {onSearch && (
          <button
            onClick={() => onSearch(question)}
            className="mt-1 text-xs text-amber-700 dark:text-amber-300 underline hover:no-underline"
          >
            Search this
          </button>
        )}
      </div>
    </div>
  );
}

function FollowupPills({
  followups,
  onFollowupClick,
}: {
  followups: string[];
  onFollowupClick?: (q: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {followups.map((q) =>
        onFollowupClick ? (
          <button
            key={q}
            onClick={() => onFollowupClick(q)}
            className="rounded-full border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-700 dark:text-slate-200 hover:border-teal-500 hover:text-teal-700 dark:hover:text-teal-400 transition-colors"
          >
            {q}
          </button>
        ) : (
          <span
            key={q}
            className="rounded-full border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs text-slate-600 dark:text-slate-300"
          >
            {q}
          </span>
        ),
      )}
    </div>
  );
}

function SourceFooter({ source }: { source: SourceCitation }) {
  const SOURCE_LABEL: Record<SourceCitation["source"], string> = {
    "transfer-equiv": "transfer agreements",
    prereqs: "prerequisite catalog",
    institutions: "audit policies",
    "supabase-courses": "course catalog",
  };
  const label = SOURCE_LABEL[source.source];
  return (
    <div className="px-5 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        Based on {label} for{" "}
        <span className="font-mono uppercase">{source.state}</span>
        {source.lastUpdated ? ` · last verified ${source.lastUpdated}` : ""}
        {source.upstreamUrl ? (
          <>
            {" "}·{" "}
            <a
              href={source.upstreamUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-teal-700"
            >
              source
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
