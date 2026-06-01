/**
 * College Scorecard API client.
 *
 * Federal data source for per-institution cost, aid, completion, and earnings
 * metrics. Free, public, requires an `api.data.gov` key (sign up at
 * https://api.data.gov/signup — instant). Documented at
 * https://collegescorecard.ed.gov/data/api-documentation/.
 *
 * This file (PR 1 of issue #392) only provides the API client and the
 * persisted-record schema. The per-college ingest, IPEDS unitid mapping,
 * and library helpers land in follow-up PRs.
 *
 * Field selection rationale:
 *   The issue (#392) originally listed `completion.completion_rate_4yr_150nt`
 *   as the canonical completion metric. Empirically that field is null for
 *   community colleges (it's a 4-year-institution metric). The correct CC
 *   equivalent is `completion.completion_rate_less_than_4yr_150nt`. This
 *   client picks the less-than-4-year variants where they exist.
 */

import { fetchJsonWithRetry } from "@/scripts/lib/http-retry";
import { loadEnv } from "@/scripts/lib/load-env";

const API_BASE = "https://api.data.gov/ed/collegescorecard/v1/schools";

// Fields to request from the API. Comma-joined into the `fields` query param.
// Keeping this narrow keeps response payloads small (~2 KB per school vs.
// ~500 KB for the full record).
const FIELDS = [
  "id",
  "school.name",
  "school.state",
  "school.city",
  "school.school_url",
  "school.ownership",
  "school.degrees_awarded.predominant",
  "latest.student.size",
  "latest.student.share_firstgeneration",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.cost.attendance.academic_year",
  "latest.cost.avg_net_price.public",
  "latest.cost.booksupply",
  "latest.cost.roomboard.offcampus",
  "latest.cost.net_price.public.by_income_level.0-30000",
  "latest.cost.net_price.public.by_income_level.30001-48000",
  "latest.cost.net_price.public.by_income_level.48001-75000",
  "latest.cost.net_price.public.by_income_level.75001-110000",
  "latest.cost.net_price.public.by_income_level.110001-plus",
  "latest.aid.pell_grant_rate",
  "latest.aid.federal_loan_rate",
  "latest.aid.median_debt.completers.overall",
  "latest.completion.completion_rate_less_than_4yr_150nt",
  "latest.completion.completion_rate_less_than_4yr_200nt",
  "latest.completion.transfer_rate.less_than_4yr.full_time",
  "latest.earnings.10_yrs_after_entry.median",
  // Tier 1 outcomes additions — see issue #405.
  // Retention is the strongest leading indicator of completion; CCs often
  // have wildly different FT vs PT retention so we surface both.
  "latest.student.retention_rate.lt_four_year.full_time",
  "latest.student.retention_rate.lt_four_year.part_time",
  // 1yr earnings is a faster post-completion signal than the headline 10yr
  // figure (which mixes completers and non-completers entering the
  // workforce). 10yr percentiles (P25 / P75) give us a distribution
  // alongside the median for the existing earnings tile.
  "latest.earnings.1_yr_after_completion.median",
  "latest.earnings.10_yrs_after_entry.working_not_enrolled.earnings_percentile.25",
  "latest.earnings.10_yrs_after_entry.working_not_enrolled.earnings_percentile.75",
  // % of former students earning above $28k (federal threshold ~ median
  // for a HS graduate). The fed Scorecard's flagship "did college pay off"
  // outcome stat. Available where the 10yr earnings cohort is large enough.
  "latest.earnings.10_yrs_after_entry.percent_greater_than_28000",
];

const FIELDS_PARAM = FIELDS.join(",");

/**
 * Canonical persisted shape. This is what gets written to
 * `data/{state}/scorecard/{college}.json` once per ingest cycle.
 *
 * Every number-valued field is nullable because Scorecard suppresses values
 * with small cohorts and not every metric applies to every institution.
 * Consumers must handle null gracefully (don't show "$null tuition").
 */
export interface ScorecardRecord {
  /** IPEDS unitid — the federal institution ID. */
  unitid: number;
  schoolName: string;
  state: string;
  city: string;
  schoolUrl: string | null;
  /**
   * 1 = public, 2 = private nonprofit, 3 = private for-profit.
   * Community colleges in this codebase should all be ownership === 1.
   */
  ownership: number | null;
  /**
   * Predominant degree awarded: 1 = certificate, 2 = associate's,
   * 3 = bachelor's, 4 = graduate. Used during the unitid-mapping flow
   * to filter to two-year institutions.
   */
  predominantDegree: number | null;
  /** When this record was fetched, ISO 8601. Used for freshness checks. */
  fetchedAt: string;

  /** Enrollment headcount. */
  size: number | null;
  /** Share of first-generation students (0–1). */
  shareFirstGeneration: number | null;

  cost: {
    tuitionInState: number | null;
    tuitionOutOfState: number | null;
    attendanceAcademicYear: number | null;
    avgNetPricePublic: number | null;
    bookSupply: number | null;
    roomBoardOffCampus: number | null;
    /**
     * Net price after aid, banded by family income. The dollar value is
     * what a student in that band would actually pay per year.
     */
    netPriceByIncome: {
      "0_30000": number | null;
      "30001_48000": number | null;
      "48001_75000": number | null;
      "75001_110000": number | null;
      "110001_plus": number | null;
    };
  };

  aid: {
    /** Share of students receiving Pell grants (0–1). */
    pellGrantRate: number | null;
    /** Share receiving federal loans (0–1). */
    federalLoanRate: number | null;
    /** Median cumulative debt for completers, $. */
    medianDebtCompleters: number | null;
  };

  completion: {
    /** 150%-of-normal-time completion rate for <4yr institutions (0–1). */
    completionRate150nt: number | null;
    /** 200%-of-normal-time completion rate for <4yr institutions (0–1). */
    completionRate200nt: number | null;
    /** Transfer-out rate for full-time <4yr students (0–1). */
    transferRate: number | null;
    /** 1st-year retention rate for full-time students at <4yr schools (0–1). */
    retentionRateFullTime: number | null;
    /** 1st-year retention rate for part-time students at <4yr schools (0–1). */
    retentionRatePartTime: number | null;
  };

  earnings: {
    /** Median earnings 10 years after enrollment entry, $. */
    median10YrsAfterEntry: number | null;
    /** Median earnings 1 year after completion, $. Faster signal than the
     * 10yr figure; only includes completers, so a cleaner per-cohort number. */
    median1YrAfterCompletion: number | null;
    /** 25th percentile, 10 years after entry — working, not enrolled, $. */
    percentile25_10YrsAfterEntry: number | null;
    /** 75th percentile, 10 years after entry — working, not enrolled, $. */
    percentile75_10YrsAfterEntry: number | null;
    /** Share of former students earning above $28k 10 years after entry —
     * roughly the median wage for a high-school graduate (0–1). Federal
     * Scorecard's flagship "did college pay off" outcome metric. */
    shareEarningAboveHsGrad: number | null;
  };
}

/** Raw Scorecard API response row. We map this into ScorecardRecord. */
interface ScorecardApiRow {
  id?: number;
  "school.name"?: string | null;
  "school.state"?: string | null;
  "school.city"?: string | null;
  "school.school_url"?: string | null;
  "school.ownership"?: number | null;
  "school.degrees_awarded.predominant"?: number | null;
  "latest.student.size"?: number | null;
  "latest.student.share_firstgeneration"?: number | null;
  "latest.cost.tuition.in_state"?: number | null;
  "latest.cost.tuition.out_of_state"?: number | null;
  "latest.cost.attendance.academic_year"?: number | null;
  "latest.cost.avg_net_price.public"?: number | null;
  "latest.cost.booksupply"?: number | null;
  "latest.cost.roomboard.offcampus"?: number | null;
  "latest.cost.net_price.public.by_income_level.0-30000"?: number | null;
  "latest.cost.net_price.public.by_income_level.30001-48000"?: number | null;
  "latest.cost.net_price.public.by_income_level.48001-75000"?: number | null;
  "latest.cost.net_price.public.by_income_level.75001-110000"?: number | null;
  "latest.cost.net_price.public.by_income_level.110001-plus"?: number | null;
  "latest.aid.pell_grant_rate"?: number | null;
  "latest.aid.federal_loan_rate"?: number | null;
  "latest.aid.median_debt.completers.overall"?: number | null;
  "latest.completion.completion_rate_less_than_4yr_150nt"?: number | null;
  "latest.completion.completion_rate_less_than_4yr_200nt"?: number | null;
  "latest.completion.transfer_rate.less_than_4yr.full_time"?: number | null;
  "latest.earnings.10_yrs_after_entry.median"?: number | null;
  // Tier 1 (issue #405)
  "latest.student.retention_rate.lt_four_year.full_time"?: number | null;
  "latest.student.retention_rate.lt_four_year.part_time"?: number | null;
  "latest.earnings.1_yr_after_completion.median"?: number | null;
  "latest.earnings.10_yrs_after_entry.working_not_enrolled.earnings_percentile.25"?: number | null;
  "latest.earnings.10_yrs_after_entry.working_not_enrolled.earnings_percentile.75"?: number | null;
  "latest.earnings.10_yrs_after_entry.percent_greater_than_28000"?: number | null;
}

interface ScorecardApiResponse {
  metadata: { page: number; total: number; per_page: number };
  results: ScorecardApiRow[];
}

function requireApiKey(): string {
  loadEnv();
  const key = process.env.COLLEGE_SCORECARD_API_KEY;
  if (!key) {
    throw new Error(
      "COLLEGE_SCORECARD_API_KEY is not set. Sign up free at https://api.data.gov/signup and add the key to .env.local."
    );
  }
  return key;
}

function rowToRecord(row: ScorecardApiRow): ScorecardRecord {
  if (typeof row.id !== "number") {
    throw new Error("Scorecard row is missing `id` — likely a bad API response.");
  }
  return {
    unitid: row.id,
    schoolName: row["school.name"] ?? "",
    state: row["school.state"] ?? "",
    city: row["school.city"] ?? "",
    schoolUrl: row["school.school_url"] ?? null,
    ownership: row["school.ownership"] ?? null,
    predominantDegree: row["school.degrees_awarded.predominant"] ?? null,
    fetchedAt: new Date().toISOString(),
    size: row["latest.student.size"] ?? null,
    shareFirstGeneration: row["latest.student.share_firstgeneration"] ?? null,
    cost: {
      tuitionInState: row["latest.cost.tuition.in_state"] ?? null,
      tuitionOutOfState: row["latest.cost.tuition.out_of_state"] ?? null,
      attendanceAcademicYear: row["latest.cost.attendance.academic_year"] ?? null,
      avgNetPricePublic: row["latest.cost.avg_net_price.public"] ?? null,
      bookSupply: row["latest.cost.booksupply"] ?? null,
      roomBoardOffCampus: row["latest.cost.roomboard.offcampus"] ?? null,
      netPriceByIncome: {
        "0_30000": row["latest.cost.net_price.public.by_income_level.0-30000"] ?? null,
        "30001_48000": row["latest.cost.net_price.public.by_income_level.30001-48000"] ?? null,
        "48001_75000": row["latest.cost.net_price.public.by_income_level.48001-75000"] ?? null,
        "75001_110000": row["latest.cost.net_price.public.by_income_level.75001-110000"] ?? null,
        "110001_plus": row["latest.cost.net_price.public.by_income_level.110001-plus"] ?? null,
      },
    },
    aid: {
      pellGrantRate: row["latest.aid.pell_grant_rate"] ?? null,
      federalLoanRate: row["latest.aid.federal_loan_rate"] ?? null,
      medianDebtCompleters: row["latest.aid.median_debt.completers.overall"] ?? null,
    },
    completion: {
      completionRate150nt:
        row["latest.completion.completion_rate_less_than_4yr_150nt"] ?? null,
      completionRate200nt:
        row["latest.completion.completion_rate_less_than_4yr_200nt"] ?? null,
      transferRate:
        row["latest.completion.transfer_rate.less_than_4yr.full_time"] ?? null,
      retentionRateFullTime:
        row["latest.student.retention_rate.lt_four_year.full_time"] ?? null,
      retentionRatePartTime:
        row["latest.student.retention_rate.lt_four_year.part_time"] ?? null,
    },
    earnings: {
      median10YrsAfterEntry:
        row["latest.earnings.10_yrs_after_entry.median"] ?? null,
      median1YrAfterCompletion:
        row["latest.earnings.1_yr_after_completion.median"] ?? null,
      percentile25_10YrsAfterEntry:
        row[
          "latest.earnings.10_yrs_after_entry.working_not_enrolled.earnings_percentile.25"
        ] ?? null,
      percentile75_10YrsAfterEntry:
        row[
          "latest.earnings.10_yrs_after_entry.working_not_enrolled.earnings_percentile.75"
        ] ?? null,
      shareEarningAboveHsGrad:
        row["latest.earnings.10_yrs_after_entry.percent_greater_than_28000"] ?? null,
    },
  };
}

/**
 * Fetch a single institution by IPEDS unitid. Returns null if not found.
 * Throws on transport errors or auth failures.
 */
export async function fetchScorecardByUnitid(
  unitid: number
): Promise<ScorecardRecord | null> {
  const key = requireApiKey();
  const url = `${API_BASE}?id=${unitid}&fields=${encodeURIComponent(FIELDS_PARAM)}&api_key=${key}`;
  const data = await fetchJsonWithRetry<ScorecardApiResponse>(url, undefined, {
    label: `scorecard:${unitid}`,
  });
  if (!data.results || data.results.length === 0) return null;
  return rowToRecord(data.results[0]);
}

/**
 * Search Scorecard for institutions matching a name and state. Useful for
 * the unitid-mapping work (PR 2) — given a college name from
 * institutions.json, find candidate IPEDS matches. Returns up to 20 results.
 *
 * Caller is responsible for disambiguating: a query like "Northern Virginia"
 * matches both NVCC and a massage school. Real CC ingest should filter to
 * results with non-null `latest.cost.tuition.in_state` and large
 * enrollment.
 */
export async function searchScorecardByName(
  name: string,
  state: string
): Promise<ScorecardRecord[]> {
  const key = requireApiKey();
  const url =
    `${API_BASE}?school.name=${encodeURIComponent(name)}` +
    `&school.state=${encodeURIComponent(state.toUpperCase())}` +
    `&fields=${encodeURIComponent(FIELDS_PARAM)}` +
    `&api_key=${key}`;
  const data = await fetchJsonWithRetry<ScorecardApiResponse>(url, undefined, {
    label: `scorecard-search:${name}/${state}`,
  });
  return (data.results ?? []).map(rowToRecord);
}


/**
 * Per-program (4-digit CIP) outcomes record. Stored at
 * `data/{state}/scorecard-programs/{college_slug}.json` as an array, one
 * entry per CIP at that institution. Issue #406.
 *
 * Two-tier data: most fields capture the school-specific cohort (often
 * suppressed when the cohort is small). When suppressed, the API still
 * provides a NATIONAL benchmark (same CIP, all institutions); we store
 * both and the UI shows whichever is available.
 */
export interface ScorecardProgramRecord {
  /** 4-digit CIP code (e.g. "5138" for Registered Nursing). */
  cipCode: string;
  /** Human-readable CIP title from the API (e.g. "Registered Nursing/Registered Nurse."). */
  cipTitle: string;
  /** Credential level: 1=cert/diploma, 2=associate's, 3=bachelor's, 4=graduate. */
  credentialLevel: number | null;
  /** Human-readable credential title from the API. */
  credentialTitle: string | null;
  /** Annual IPEDS awards count for credential level 1 (certs). */
  awardsLevel1: number | null;
  /** Annual IPEDS awards count for credential level 2 (associate's). */
  awardsLevel2: number | null;

  // ----- School-specific earnings (often null due to small-cohort suppression) -----

  /** Median earnings 1 year after completion, this CIP at this school, $. */
  earnings1YrMedian: number | null;
  /** Median earnings 5 years after completion, this CIP at this school, $. */
  earnings5YrMedian: number | null;
  /** Median earnings 5 yrs after for Pell-recipient completers, $ (equity stat). */
  earnings5YrPellMedian: number | null;
  /** Median earnings 5 yrs after for non-Pell-recipient completers, $ (equity stat). */
  earnings5YrNonPellMedian: number | null;

  // ----- National benchmarks (populated even when school-specific is suppressed) -----

  /** National median earnings 4 yrs after completion for this CIP across all schools, $. */
  earnings4YrMedianNational: number | null;
  /** National P25 earnings 4 yrs after completion for this CIP, $. */
  earnings4YrP25National: number | null;
  /** National P75 earnings 4 yrs after completion for this CIP, $. */
  earnings4YrP75National: number | null;
}



/**
 * Fetch per-program (CIP) outcomes for one institution. Returns an array,
 * filtered to credential levels 1 (certificate) and 2 (associate's) — the
 * CC-relevant tiers. Programs with zero awards AND no earnings data are
 * dropped (no signal at all).
 *
 * Each program's response payload is large (~3 KB), so we request only
 * the fields we'll persist. Empty array if the institution isn't found
 * or has no program data.
 */
export async function fetchScorecardProgramsByUnitid(
  unitid: number,
): Promise<ScorecardProgramRecord[]> {
  const key = requireApiKey();
  const programFields = [
    "latest.programs.cip_4_digit.code",
    "latest.programs.cip_4_digit.title",
    "latest.programs.cip_4_digit.credential.level",
    "latest.programs.cip_4_digit.credential.title",
    "latest.programs.cip_4_digit.counts.ipeds_awards1",
    "latest.programs.cip_4_digit.counts.ipeds_awards2",
    "latest.programs.cip_4_digit.earnings.1_yr.overall_median_earnings",
    "latest.programs.cip_4_digit.earnings.5_yr.overall_median_earnings",
    "latest.programs.cip_4_digit.earnings.5_yr.pell_median_earnings",
    "latest.programs.cip_4_digit.earnings.5_yr.nonpell_median_earnings",
    "latest.programs.cip_4_digit.earnings.4_yr.overall_median_earnings_national",
    "latest.programs.cip_4_digit.earnings.4_yr.overall_p25_earnings_national",
    "latest.programs.cip_4_digit.earnings.4_yr.overall_p75_earnings_national",
  ].join(",");
  const url = `${API_BASE}?id=${unitid}&fields=id,${encodeURIComponent(programFields)}&api_key=${key}`;
  const data = await fetchJsonWithRetry<{
    results: Array<{ "latest.programs.cip_4_digit"?: ScorecardProgramApiRow[] }>;
  }>(url, undefined, { label: `scorecard-programs:${unitid}` });
  if (!data.results || data.results.length === 0) return [];
  const rows = data.results[0]["latest.programs.cip_4_digit"] ?? [];
  const out: ScorecardProgramRecord[] = [];
  for (const r of rows) {
    const credLevel = r.credential?.level ?? null;
    // Filter to CC-relevant credentials.
    if (credLevel !== 1 && credLevel !== 2 && credLevel !== null) continue;
    const awards1 = r.counts?.ipeds_awards1 ?? null;
    const awards2 = r.counts?.ipeds_awards2 ?? null;
    const e1 = r.earnings?.["1_yr"]?.overall_median_earnings ?? null;
    const e5 = r.earnings?.["5_yr"]?.overall_median_earnings ?? null;
    const eNat = r.earnings?.["4_yr"]?.overall_median_earnings_national ?? null;
    // Drop rows with no signal whatsoever (no awards, no earnings local
    // or national). Keeps the file size reasonable.
    if (
      awards1 == null &&
      awards2 == null &&
      e1 == null &&
      e5 == null &&
      eNat == null
    ) {
      continue;
    }
    out.push({
      cipCode: r.code ?? "",
      cipTitle: (r.title ?? "").replace(/\.$/, ""),
      credentialLevel: credLevel,
      credentialTitle: r.credential?.title ?? null,
      awardsLevel1: awards1,
      awardsLevel2: awards2,
      earnings1YrMedian: e1,
      earnings5YrMedian: e5,
      earnings5YrPellMedian: r.earnings?.["5_yr"]?.pell_median_earnings ?? null,
      earnings5YrNonPellMedian:
        r.earnings?.["5_yr"]?.nonpell_median_earnings ?? null,
      earnings4YrMedianNational: eNat,
      earnings4YrP25National:
        r.earnings?.["4_yr"]?.overall_p25_earnings_national ?? null,
      earnings4YrP75National:
        r.earnings?.["4_yr"]?.overall_p75_earnings_national ?? null,
    });
  }
  return out;
}

interface ScorecardProgramApiRow {
  code?: string;
  title?: string;
  credential?: { level?: number | null; title?: string | null };
  counts?: { ipeds_awards1?: number | null; ipeds_awards2?: number | null };
  earnings?: {
    "1_yr"?: { overall_median_earnings?: number | null };
    "5_yr"?: {
      overall_median_earnings?: number | null;
      pell_median_earnings?: number | null;
      nonpell_median_earnings?: number | null;
    };
    "4_yr"?: {
      overall_median_earnings_national?: number | null;
      overall_p25_earnings_national?: number | null;
      overall_p75_earnings_national?: number | null;
    };
  };
}
