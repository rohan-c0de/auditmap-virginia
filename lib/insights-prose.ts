/**
 * Insights → prose renderer. Turns the structured fact bags from
 * `college-insights.ts` and `state-insights.ts` into 2–4 paragraphs of
 * editorial text per page.
 *
 * Design goals:
 *
 *  - **Never look AI-generic.** Every sentence cites a specific number
 *    pulled from real data. Swapping the entity name makes the paragraph
 *    factually wrong (which means search engines see genuinely unique
 *    content across the corpus).
 *  - **Variant pool.** Each fact has 3 sentence variants; the picker uses a
 *    deterministic hash so the same page always renders the same sentence
 *    (stable for indexing) but different pages spread across all variants.
 *  - **Skip-when-unremarkable.** If a metric is missing OR within 5 percentage
 *    points of the state median, the sentence is omitted. Median colleges
 *    naturally render shorter content — the correct outcome.
 *  - **Cite source inline.** Every sentence is prefixed with where its
 *    numbers come from ("Federal College Scorecard data shows…",
 *    "Across [college]'s catalog this term…", "According to state transfer
 *    records…"). Reads like reporting, not assertion.
 *  - **No banned words.** A test suite enforces a list of evaluative
 *    adjectives that flag AI-generated prose ("robust", "diverse",
 *    "comprehensive", "wide range of", "various", "many", etc.).
 */

import type { CollegeInsights } from "@/lib/college-insights";
import type { StateInsights } from "@/lib/state-insights";
import { subjectName } from "@/lib/subjects";
import { communityCollegesLabel } from "@/lib/states/registry";

// ---------------------------------------------------------------------------
// Banned-phrase list (enforced at test time)
// ---------------------------------------------------------------------------

export const BANNED_PHRASES = [
  "robust",
  "diverse",
  "comprehensive",
  "wide range of",
  "various",
  "numerous",
  "extensive",
  "state-of-the-art",
  "cutting-edge",
  "world-class",
  "top-notch",
  "best-in-class",
  "vibrant",
  "rich array",
];

// ---------------------------------------------------------------------------
// Deterministic variant picker
// ---------------------------------------------------------------------------

/**
 * djb2 hash of a string → non-negative 32-bit int. Cheap and stable across
 * runs (no Math.random, no Date.now).
 */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/** Pick one of `n` variants deterministically based on a stable key. */
export function pickVariant(key: string, n: number): number {
  if (n <= 0) return 0;
  return hash(key) % n;
}

// ---------------------------------------------------------------------------
// Number formatters
// ---------------------------------------------------------------------------

function roundToNearest(n: number, step: number): number {
  return Math.round(n / step) * step;
}

function approxCount(n: number): string {
  if (n < 50) return n.toLocaleString("en-US");
  if (n < 200) return `around ${roundToNearest(n, 10).toLocaleString("en-US")}`;
  if (n < 1000) return `around ${roundToNearest(n, 25).toLocaleString("en-US")}`;
  if (n < 5000) return `around ${roundToNearest(n, 100).toLocaleString("en-US")}`;
  return `around ${roundToNearest(n, 500).toLocaleString("en-US")}`;
}

function pct(n: number): string {
  return `${Math.round(n)}%`;
}

function dollar(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function ordinal(n: number): string {
  // 1st, 2nd, 3rd, 4th… handling teens correctly.
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

// ---------------------------------------------------------------------------
// Helper: list-join with Oxford comma
// ---------------------------------------------------------------------------

function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function subjectLabel(prefix: string): string {
  // `subjectName` returns the prefix itself if no display name is known.
  const name = subjectName(prefix);
  return name === prefix ? prefix : `${name} (${prefix})`;
}

/**
 * Form a noun phrase like "23 California community colleges" from the state
 * slug (via communityCollegesLabel), so it reads naturally for every system
 * and avoids the doubled "Colleges colleges" / awkward "CCs colleges" the old
 * systemName-based version produced.
 */
function systemColleges(state: string, count: number): string {
  return `${count} ${communityCollegesLabel(state)}`;
}

// ---------------------------------------------------------------------------
// COLLEGE PROSE
// ---------------------------------------------------------------------------

/**
 * Render the college insight bundle to 2–4 paragraphs. Returns an empty
 * array when fewer than 2 sentences qualify — the caller should not render
 * the section in that case.
 */
export function renderCollegeProse(insights: CollegeInsights): string[] {
  const sentences: string[] = [];

  // --- Catalog scale + state rank ---
  if (insights.termSectionCount && insights.sectionRank) {
    const sr = insights.sectionRank;
    const key = `${insights.collegeId}:catalog`;
    const variants = [
      `Across ${insights.collegeName}'s catalog this term, ${approxCount(insights.termSectionCount)} course sections are listed — the ${ordinal(sr.position)}-largest catalog among the ${systemColleges(insights.state, sr.outOf)} with current data.`,
      `${insights.collegeName} lists ${approxCount(insights.termSectionCount)} sections this term, putting it ${ordinal(sr.position)} of ${systemColleges(insights.state, sr.outOf)} by catalog size.`,
      `Among ${systemColleges(insights.state, sr.outOf)} with current course data, ${insights.collegeName} ranks ${ordinal(sr.position)} by section count, with ${approxCount(insights.termSectionCount)} sections this term.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  } else if (insights.termSectionCount) {
    // No rank context, but at least the section count is real.
    const key = `${insights.collegeId}:catalog-norank`;
    const variants = [
      `${insights.collegeName} lists ${approxCount(insights.termSectionCount)} course sections this term.`,
      `Across ${insights.collegeName}'s catalog this term, ${approxCount(insights.termSectionCount)} sections are scheduled.`,
      `${approxCount(insights.termSectionCount)} sections appear on ${insights.collegeName}'s current schedule.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Top subjects ---
  if (insights.topSubjects.length >= 2) {
    const labels = insights.topSubjects.slice(0, 3).map((s) => subjectLabel(s.prefix));
    const lead = insights.topSubjects[0];
    const key = `${insights.collegeId}:subjects`;
    const variants = [
      `The largest department this term is ${subjectLabel(lead.prefix)} with ${approxCount(lead.sections)} sections, followed by ${joinList(labels.slice(1))}.`,
      `By section count, ${insights.collegeName}'s top subjects this term are ${joinList(labels)} — with ${subjectLabel(lead.prefix)} leading at ${approxCount(lead.sections)} sections.`,
      `${joinList(labels)} are the most-offered subjects at ${insights.collegeName} this term, with ${subjectLabel(lead.prefix)} the largest at ${approxCount(lead.sections)} sections.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Online mode share (only when notably above or below state median) ---
  const online = insights.modeShares.online;
  if (online && Math.abs(online.delta) >= 5) {
    const key = `${insights.collegeId}:online`;
    const direction = online.delta > 0 ? "above" : "below";
    const variants = [
      `Across the catalog, ${pct(online.pct)} of sections are online — ${direction} the ${insights.systemName} median of ${pct(online.statePct)}.`,
      `${pct(online.pct)} of ${insights.collegeName}'s sections this term run online, ${direction} the state-system median of ${pct(online.statePct)}.`,
      `Online sections make up ${pct(online.pct)} of the schedule at ${insights.collegeName}, ${direction} the ${insights.systemName} median (${pct(online.statePct)}).`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Late-start density ---
  if (
    insights.lateStartCount != null &&
    insights.lateStartCount >= 5 &&
    insights.lateStartRank &&
    insights.lateStartRank.position <= Math.ceil(insights.lateStartRank.outOf * 0.5)
  ) {
    const lsr = insights.lateStartRank;
    const key = `${insights.collegeId}:latestart`;
    const variants = [
      `Late-start sections — those beginning more than two weeks after the term's earliest start date — number ${approxCount(insights.lateStartCount)} at ${insights.collegeName}, placing it ${ordinal(lsr.position)} of ${systemColleges(insights.state, lsr.outOf)} for late-start availability this term.`,
      `${insights.collegeName} has ${approxCount(insights.lateStartCount)} late-start sections (more than two weeks past the earliest term start), ranking ${ordinal(lsr.position)} among ${systemColleges(insights.state, lsr.outOf)} for that availability.`,
      `For students who missed the main registration window, ${insights.collegeName} offers ${approxCount(insights.lateStartCount)} late-start sections this term — ${ordinal(lsr.position)} of ${lsr.outOf} in the ${insights.systemName}.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Transfer destinations ---
  if (insights.topTransferDestinations.length >= 2) {
    const uniNames = insights.topTransferDestinations
      .slice(0, 3)
      .map((d) => d.university);
    const lead = insights.topTransferDestinations[0];
    const key = `${insights.collegeId}:transfer`;
    const variants = [
      `According to state transfer records, the receiving universities with the most course equivalencies from ${insights.collegeName} are ${joinList(uniNames)} — ${lead.university} alone accepts ${lead.mappingCount.toLocaleString("en-US")} of ${insights.collegeName}'s courses for credit.`,
      `State transfer records show ${insights.collegeName}'s coursework articulates most often with ${joinList(uniNames)}, with ${lead.university} accepting ${lead.mappingCount.toLocaleString("en-US")} courses.`,
      `For students planning to transfer, ${joinList(uniNames)} hold the most course equivalencies with ${insights.collegeName} per the state transfer registry — ${lead.university} leads with ${lead.mappingCount.toLocaleString("en-US")} accepted courses.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- ASSIST (CA only) ---
  if (
    insights.assistAgreementCount &&
    insights.assistAgreementCount >= 3 &&
    insights.assistTopUniversities.length >= 1
  ) {
    const lead = insights.assistTopUniversities[0];
    const others = insights.assistTopUniversities
      .slice(1)
      .map((u) => `${u.name} (${u.count})`);
    const key = `${insights.collegeId}:assist`;
    const variants = [
      `Per the California ASSIST registry, ${insights.collegeName} maintains ${insights.assistAgreementCount} major-specific articulation agreements with UC and CSU campuses — most with ${lead.name} (${lead.count})${others.length ? `, followed by ${joinList(others)}` : ""}.`,
      `${insights.collegeName} has ${insights.assistAgreementCount} per-major articulation agreements on file with the California ASSIST registry; the deepest pipeline runs to ${lead.name} with ${lead.count} majors${others.length ? ` (${joinList(others)} round out the top three)` : ""}.`,
      `Across the California ASSIST registry, ${insights.collegeName} maps to ${insights.assistAgreementCount} receiving-school majors — ${lead.name} accounts for ${lead.count}${others.length ? ` and ${joinList(others)} follow` : ""}.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Scorecard cost vs state median ---
  const sc = insights.scorecard;
  if (sc && sc.tuition != null && sc.tuitionStateMedian != null) {
    const diff = sc.tuition - sc.tuitionStateMedian;
    if (Math.abs(diff) >= 250) {
      const direction = diff > 0 ? "above" : "below";
      const key = `${insights.collegeId}:cost`;
      const variants = [
        `Federal College Scorecard data shows ${insights.collegeName}'s in-state tuition at ${dollar(sc.tuition)} per year — ${dollar(Math.abs(diff))} ${direction} the ${insights.systemName} median.`,
        `In-state tuition at ${insights.collegeName} runs ${dollar(sc.tuition)} per year per federal College Scorecard data, ${direction} the ${insights.systemName} median by ${dollar(Math.abs(diff))}.`,
        `According to the federal College Scorecard, ${insights.collegeName} charges in-state students ${dollar(sc.tuition)} a year — ${dollar(Math.abs(diff))} ${direction} the ${insights.systemName} median.`,
      ];
      sentences.push(variants[pickVariant(key, variants.length)]);
    }
  }

  // --- Scorecard earnings ---
  if (sc && sc.earnings10yr != null && sc.earningsStateMedian != null) {
    const diff = sc.earnings10yr - sc.earningsStateMedian;
    if (Math.abs(diff) >= 1500) {
      const direction = diff > 0 ? "above" : "below";
      const key = `${insights.collegeId}:earnings`;
      const variants = [
        `Federal data tracks former ${insights.collegeName} students earning a median of ${dollar(sc.earnings10yr)} ten years after enrollment — ${dollar(Math.abs(diff))} ${direction} the ${insights.systemName} median for that cohort window.`,
        `Ten years after entry, former ${insights.collegeName} students earn a median of ${dollar(sc.earnings10yr)} per federal College Scorecard tracking — ${direction} the ${insights.systemName} median by ${dollar(Math.abs(diff))}.`,
        `Per the federal College Scorecard, the ten-year-after-entry median earnings for ${insights.collegeName} alumni is ${dollar(sc.earnings10yr)}, ${dollar(Math.abs(diff))} ${direction} the ${insights.systemName} median.`,
      ];
      sentences.push(variants[pickVariant(key, variants.length)]);
    }
  }

  // --- Senior waiver applicability ---
  if (insights.seniorWaiver) {
    const sw = insights.seniorWaiver;
    const key = `${insights.collegeId}:senior`;
    const variants = [
      `Residents ${sw.ageThreshold} and older may attend ${insights.collegeName} tuition-free under ${sw.legalCitation}.`,
      `Under ${sw.legalCitation}, ${insights.collegeName} waives tuition for in-state residents ${sw.ageThreshold} and older.`,
      `${insights.collegeName} participates in the state senior tuition waiver — residents ${sw.ageThreshold}+ enroll without paying tuition, per ${sw.legalCitation}.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // Skip-when-thin: fewer than 2 sentences → caller should not render.
  if (sentences.length < 2) return [];

  // Pack into 2–3 paragraphs (3 sentences per paragraph max).
  return groupIntoParagraphs(sentences, 3);
}

// ---------------------------------------------------------------------------
// STATE PROSE
// ---------------------------------------------------------------------------

export function renderStateProse(insights: StateInsights): string[] {
  const sentences: string[] = [];

  // --- System scale ---
  if (insights.totalSections != null && insights.collegesWithData > 0) {
    const key = `${insights.state}:scale`;
    const isPlural = insights.collegesWithData !== 1;
    const variants = [
      `Across the ${insights.systemName}, ${insights.collegesWithData} ${isPlural ? "colleges report" : "college reports"} ${approxCount(insights.totalSections)} course sections in the current term.`,
      `The ${insights.systemName} runs ${approxCount(insights.totalSections)} course sections across ${insights.collegesWithData} ${isPlural ? "colleges" : "college"} this term.`,
      `${systemColleges(insights.state, insights.collegesWithData)} ${isPlural ? "list" : "lists"} ${approxCount(insights.totalSections)} sections this term across their combined catalogs.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Largest/smallest ---
  if (insights.largestCollege && insights.smallestCollege) {
    const lg = insights.largestCollege;
    const sm = insights.smallestCollege;
    const key = `${insights.state}:range`;
    const variants = [
      `${lg.collegeName} runs the largest catalog this term at ${approxCount(lg.sectionCount)} sections, while ${sm.collegeName} runs the smallest at ${approxCount(sm.sectionCount)}.`,
      `By section count, ${lg.collegeName} (${approxCount(lg.sectionCount)}) and ${sm.collegeName} (${approxCount(sm.sectionCount)}) anchor the size range across the ${insights.systemName} this term.`,
      `Catalog sizes in the ${insights.systemName} range from ${approxCount(sm.sectionCount)} sections at ${sm.collegeName} to ${approxCount(lg.sectionCount)} at ${lg.collegeName}.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  } else if (insights.largestCollege) {
    const lg = insights.largestCollege;
    const key = `${insights.state}:largest`;
    const variants = [
      `${lg.collegeName} runs the largest catalog in the ${insights.systemName} this term at ${approxCount(lg.sectionCount)} sections.`,
      `The largest catalog in the ${insights.systemName} this term belongs to ${lg.collegeName}, with ${approxCount(lg.sectionCount)} sections.`,
      `By section count, ${lg.collegeName} leads the ${insights.systemName} this term with ${approxCount(lg.sectionCount)} sections.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Top subjects ---
  if (insights.topSubjects.length >= 2) {
    const labels = insights.topSubjects.map((s) => subjectLabel(s.prefix));
    const lead = insights.topSubjects[0];
    const key = `${insights.state}:subjects`;
    const variants = [
      `The most-offered subjects statewide are ${joinList(labels)} — ${subjectLabel(lead.prefix)} leads with ${approxCount(lead.sectionCount)} sections across ${lead.collegesOffering} colleges.`,
      `${joinList(labels)} are the top subjects by section count across the ${insights.systemName}, with ${subjectLabel(lead.prefix)} the largest at ${approxCount(lead.sectionCount)} sections.`,
      `By statewide section count, ${joinList(labels)} top the list — ${subjectLabel(lead.prefix)} alone runs ${approxCount(lead.sectionCount)} sections across ${lead.collegesOffering} colleges.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Transfer destinations ---
  if (insights.topTransferDestinations.length >= 2) {
    const uniNames = insights.topTransferDestinations.map((d) => d.university);
    const lead = insights.topTransferDestinations[0];
    const key = `${insights.state}:transfer`;
    const variants = [
      `According to state transfer records, the universities accepting the most ${insights.systemName} coursework are ${joinList(uniNames)} — ${lead.university} alone accepts ${lead.mappingCount.toLocaleString("en-US")} CC courses for credit.`,
      `State transfer records show ${joinList(uniNames)} as the largest receivers of ${insights.systemName} transfer credit, with ${lead.university} leading at ${lead.mappingCount.toLocaleString("en-US")} accepted courses.`,
      `For ${insights.systemName} students planning to transfer, ${joinList(uniNames)} hold the most course equivalencies on file — ${lead.university} leads with ${lead.mappingCount.toLocaleString("en-US")} accepted courses.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- ASSIST (CA only) ---
  if (insights.assistAgreementCount && insights.assistTopPairs.length >= 1) {
    const lead = insights.assistTopPairs[0];
    const key = `${insights.state}:assist`;
    const variants = [
      `Per the California ASSIST registry, the ${insights.systemName} maintains ${approxCount(insights.assistAgreementCount)} per-major articulation agreements with UC and CSU campuses — the deepest single pipeline runs from ${lead.ccName} to ${lead.uniName} with ${lead.agreementCount} majors.`,
      `The California ASSIST registry lists ${approxCount(insights.assistAgreementCount)} per-major agreements across the ${insights.systemName}, with the deepest CC-to-university pipeline being ${lead.ccName} → ${lead.uniName} (${lead.agreementCount} majors).`,
      `Across the California ASSIST registry, ${insights.stateName} community colleges hold ${approxCount(insights.assistAgreementCount)} major-specific articulation agreements — ${lead.ccName} → ${lead.uniName} is the deepest at ${lead.agreementCount} majors.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Senior waiver ---
  if (insights.seniorWaiver) {
    const sw = insights.seniorWaiver;
    const key = `${insights.state}:senior`;
    const variants = [
      `${insights.stateName} residents ${sw.ageThreshold} and older may attend ${insights.stateName} community colleges tuition-free under ${sw.legalCitation}.`,
      `Under ${sw.legalCitation}, ${insights.stateName} waives tuition at ${insights.stateName} community colleges for residents ${sw.ageThreshold} and older.`,
      `The ${insights.systemName} participates in ${insights.stateName}'s senior tuition waiver — residents ${sw.ageThreshold}+ enroll without paying tuition, per ${sw.legalCitation}.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  // --- Scorecard medians ---
  const sc = insights.scorecard;
  if (sc && sc.medianTuition != null && sc.medianEarnings != null) {
    const key = `${insights.state}:scorecard`;
    const variants = [
      `Federal College Scorecard data puts the ${insights.systemName} median in-state tuition at ${dollar(sc.medianTuition)} per year, with former students earning a median of ${dollar(sc.medianEarnings)} ten years after entry.`,
      `Across the ${insights.systemName}, median in-state tuition is ${dollar(sc.medianTuition)} per year and median earnings ten years after enrollment are ${dollar(sc.medianEarnings)}, per the federal College Scorecard.`,
      `Per federal College Scorecard data, ${insights.stateName} community colleges charge a median ${dollar(sc.medianTuition)} in-state tuition annually; alumni earn a median ${dollar(sc.medianEarnings)} a decade after entry.`,
    ];
    sentences.push(variants[pickVariant(key, variants.length)]);
  }

  if (sentences.length < 2) return [];
  return groupIntoParagraphs(sentences, 3);
}

// ---------------------------------------------------------------------------
// Paragraph packing
// ---------------------------------------------------------------------------

function groupIntoParagraphs(sentences: string[], perPara: number): string[] {
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += perPara) {
    paras.push(sentences.slice(i, i + perPara).join(" "));
  }
  return paras;
}
