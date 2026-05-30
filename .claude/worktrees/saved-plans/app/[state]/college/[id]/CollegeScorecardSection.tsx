/**
 * Cost & outcomes section for /[state]/college/[id], driven by federal
 * College Scorecard data. See issue #392.
 *
 * Server component — pure render, no client JS. The data is loaded
 * synchronously from disk via `getScorecard()`; if it's missing (the two
 * unmapped colleges, or any future case where ingest failed), the section
 * renders nothing rather than blocking the page.
 */

import {
  getScorecard,
  getBenchmark,
  formatDollar,
  formatPercent,
  type ScorecardRecord,
} from "@/lib/scorecard";
import SectionHeading from "@/components/SectionHeading";

interface Props {
  state: string;
  collegeId: string;
  collegeName: string;
}

/**
 * Build a one-line comparison string like "11% below VA CC median ($2,847)".
 * Returns undefined when benchmark data is missing or the difference is
 * negligible (< 3%).
 */
function benchmarkLabel(
  value: number | null | undefined,
  metric: string,
  stateAbbr: string,
  fmt: "dollar" | "percent",
): string | undefined {
  if (value == null) return undefined;
  const bench = getBenchmark(metric, stateAbbr);
  if (!bench || bench.median === 0) return undefined;

  const diff = value - bench.median;
  const pctDiff = Math.abs(Math.round((diff / bench.median) * 100));
  if (pctDiff < 3) return `near ${stateAbbr.toUpperCase()} CC median`;

  const direction = diff > 0 ? "above" : "below";
  const formattedMedian =
    fmt === "dollar" ? formatDollar(bench.median) : formatPercent(bench.median);
  return `${pctDiff}% ${direction} ${stateAbbr.toUpperCase()} CC median (${formattedMedian})`;
}

function StatCard({
  label,
  value,
  sub,
  tooltip,
  benchmark,
}: {
  label: string;
  value: string;
  sub?: string;
  /**
   * Optional explanatory text. Rendered as a small "ⓘ" next to the label
   * with a native `title` attribute — works without client JS (the section
   * is a server component) and surfaces on hover on desktop. Mobile users
   * who tap-and-hold also get the tooltip via the OS-level long-press menu.
   */
  tooltip?: string;
  benchmark?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
      <div className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
        <span>{label}</span>
        {tooltip && (
          <span
            title={tooltip}
            aria-label={tooltip}
            className="cursor-help text-gray-400 dark:text-slate-500"
          >
            ⓘ
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs text-gray-500 dark:text-slate-400">
          {sub}
        </div>
      )}
      {benchmark && (
        <div className="mt-1 text-xs font-medium text-teal-700 dark:text-teal-400">
          {benchmark}
        </div>
      )}
    </div>
  );
}

function IncomeRow({
  band,
  amount,
}: {
  band: string;
  amount: number | null;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-700 py-2 last:border-0">
      <span className="text-sm text-gray-700 dark:text-slate-300">{band}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-slate-100 tabular-nums">
        {formatDollar(amount)}
      </span>
    </div>
  );
}

/**
 * Bridge between sticker tuition and average net price: itemize the
 * federal cost-of-attendance components, then subtract average aid to
 * show how the two cost numbers (often surprisingly far apart) actually
 * reconcile. Renders nothing if there's not enough Scorecard data to
 * tell a coherent story — at minimum we need the average net price plus
 * at least one COA line item.
 */
function CostBreakdown({ record }: { record: ScorecardRecord }) {
  const netPrice = record.cost.avgNetPricePublic;
  const tuition = record.cost.tuitionInState;
  const roomBoard = record.cost.roomBoardOffCampus;
  const books = record.cost.bookSupply;
  const totalCOA = record.cost.attendanceAcademicYear;

  // Need enough to be useful — net price plus at least one line item.
  if (netPrice == null) return null;
  const lineItems: Array<{ label: string; amount: number | null; note?: string }> = [
    { label: "Tuition & fees (in-state)", amount: tuition },
    { label: "Room & board", amount: roomBoard, note: "off-campus, estimate" },
    { label: "Books & supplies", amount: books },
  ];
  const hasAnyLine = lineItems.some((l) => l.amount != null);
  if (!hasAnyLine && totalCOA == null) return null;

  // "Other" = total COA - sum of broken-out lines (transportation + personal
  // expenses + anything else IPEDS rolled into COA). Only shown if we have
  // the total *and* at least one line item, so subtraction makes sense.
  const knownSum = lineItems.reduce((s, l) => s + (l.amount ?? 0), 0);
  const knownAnyNonNull = lineItems.some((l) => l.amount != null);
  const other =
    totalCOA != null && knownAnyNonNull && totalCOA > knownSum
      ? totalCOA - knownSum
      : null;

  // Net aid is COA - net price. Only render if both knowns.
  const avgAid = totalCOA != null && netPrice != null ? totalCOA - netPrice : null;

  return (
    <div className="mt-4 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
        How cost adds up to net price
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
        Sticker tuition only covers tuition and fees. Federal &ldquo;average
        net price&rdquo; adds the full cost of attendance and subtracts
        average aid — which is why it&rsquo;s usually larger.
      </p>
      <dl className="mt-3 divide-y divide-gray-100 dark:divide-slate-700 text-sm">
        {lineItems.map(
          (l) =>
            l.amount != null && (
              <div
                key={l.label}
                className="flex items-baseline justify-between py-2"
              >
                <dt className="text-gray-700 dark:text-slate-300">
                  {l.label}
                  {l.note && (
                    <span className="ml-1 text-xs text-gray-400 dark:text-slate-500">
                      ({l.note})
                    </span>
                  )}
                </dt>
                <dd className="font-medium text-gray-900 dark:text-slate-100 tabular-nums">
                  {formatDollar(l.amount)}
                </dd>
              </div>
            ),
        )}
        {other != null && (
          <div className="flex items-baseline justify-between py-2">
            <dt className="text-gray-700 dark:text-slate-300">
              Other (transportation, personal)
              <span className="ml-1 text-xs text-gray-400 dark:text-slate-500">
                (estimate)
              </span>
            </dt>
            <dd className="font-medium text-gray-900 dark:text-slate-100 tabular-nums">
              {formatDollar(other)}
            </dd>
          </div>
        )}
        {totalCOA != null && (
          <div className="flex items-baseline justify-between py-2 font-semibold">
            <dt className="text-gray-900 dark:text-slate-100">
              Total cost of attendance
            </dt>
            <dd className="text-gray-900 dark:text-slate-100 tabular-nums">
              {formatDollar(totalCOA)}
            </dd>
          </div>
        )}
        {avgAid != null && avgAid > 0 && (
          <div className="flex items-baseline justify-between py-2 text-teal-700 dark:text-teal-300">
            <dt>Less: average grants &amp; scholarships</dt>
            <dd className="font-medium tabular-nums">
              &minus;{formatDollar(avgAid)}
            </dd>
          </div>
        )}
        <div className="flex items-baseline justify-between py-2 text-base font-bold">
          <dt className="text-gray-900 dark:text-slate-100">
            Average net price after aid
          </dt>
          <dd className="text-gray-900 dark:text-slate-100 tabular-nums">
            {formatDollar(netPrice)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Outcomes block: retention + completion + transfer. Surfaces retention
 * specifically because it's the single strongest leading indicator of
 * completion (Pell-eligible students who return for year two are 3-4x
 * more likely to graduate than those who don't), and the federal
 * Scorecard site doesn't prominently feature it.
 */
function OutcomesSection({ record, state }: { record: ScorecardRecord; state: string }) {
  const retentionFt = record.completion.retentionRateFullTime;
  const retentionPt = record.completion.retentionRatePartTime;
  const transfer = record.completion.transferRate;
  const completion200 = record.completion.completionRate200nt;
  if (retentionFt == null && transfer == null && completion200 == null)
    return null;
  const retentionTooltip =
    retentionPt != null
      ? `Share of full-time first-year students who returned the next year. Part-time retention is ${formatPercent(retentionPt)}. Returning for year two is the single best predictor of finishing.`
      : "Share of full-time first-year students who returned the next year. Returning for year two is the single best predictor of finishing.";

  return (
    <div className="mt-6">
      <SectionHeading as="h3" id="after-enrollment" className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">
        After enrollment
      </SectionHeading>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {retentionFt != null && (
          <StatCard
            label="1st-year retention"
            value={formatPercent(retentionFt)}
            sub="full-time students"
            tooltip={retentionTooltip}
            benchmark={benchmarkLabel(retentionFt, "retentionFt", state, "percent")}
          />
        )}
        {transfer != null && (
          <StatCard
            label="Transfer rate"
            value={formatPercent(transfer)}
            sub="to a 4-year school"
            tooltip="Share of full-time students who transferred out to a 4-year institution. Important for community colleges where transferring is a common goal."
            benchmark={benchmarkLabel(transfer, "transferRate", state, "percent")}
          />
        )}
        {completion200 != null && (
          <StatCard
            label="Completion rate"
            value={formatPercent(completion200)}
            sub="within 4 years"
            tooltip="Share of students who completed within 200% of the normal program length — i.e., 4 years for a 2-year associate's. Broader, more realistic figure for working students."
            benchmark={benchmarkLabel(completion200, "completionRate200", state, "percent")}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Earnings block: 1yr-after-completion, 10yr-after-entry median with a
 * P25/P75 range, the federal "% earning above HS-grad median" flagship
 * stat, plus loan rate and median debt. Together these answer "did the
 * money pay off."
 */
function EarningsSection({ record, state }: { record: ScorecardRecord; state: string }) {
  const earn1Yr = record.earnings.median1YrAfterCompletion;
  const earn10Yr = record.earnings.median10YrsAfterEntry;
  const p25 = record.earnings.percentile25_10YrsAfterEntry;
  const p75 = record.earnings.percentile75_10YrsAfterEntry;
  const aboveHs = record.earnings.shareEarningAboveHsGrad;
  const debt = record.aid.medianDebtCompleters;
  const loanRate = record.aid.federalLoanRate;

  if (
    earn1Yr == null &&
    earn10Yr == null &&
    aboveHs == null &&
    debt == null &&
    (loanRate == null || loanRate === 0)
  ) {
    return null;
  }

  const earn10YrSub =
    p25 != null && p75 != null
      ? `10 yrs after entry · ${formatDollar(p25)}–${formatDollar(p75)}`
      : "10 years after entry";

  return (
    <div className="mt-6">
      <SectionHeading as="h3" id="earnings-debt" className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-slate-300">
        Earnings &amp; debt
      </SectionHeading>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {earn1Yr != null && (
          <StatCard
            label="Earnings 1 yr after"
            value={formatDollar(earn1Yr)}
            sub="median, completers"
            tooltip="Median annual earnings one year after completion, completers only. Faster post-graduation signal than the 10-year figure (which mixes completers and non-completers)."
            benchmark={benchmarkLabel(earn1Yr, "earnings1Yr", state, "dollar")}
          />
        )}
        {earn10Yr != null && (
          <StatCard
            label="Median earnings"
            value={formatDollar(earn10Yr)}
            sub={earn10YrSub}
            tooltip={
              p25 != null && p75 != null
                ? `Median annual earnings 10 years after first entering college. The range shown is the 25th–75th percentile (middle half of working former students), so half earn within this band and half are outside it.`
                : "Median annual earnings 10 years after first entering college, working former students."
            }
            benchmark={benchmarkLabel(earn10Yr, "earnings10Yr", state, "dollar")}
          />
        )}
        {aboveHs != null && (
          <StatCard
            label="Earn above $28k"
            value={formatPercent(aboveHs)}
            sub="10 yrs after entry"
            tooltip="Share of former students earning more than $28,000 — roughly the median annual wage for someone with only a high school diploma. The federal Scorecard's headline 'did college pay off' metric."
            benchmark={benchmarkLabel(aboveHs, "aboveHsGrad", state, "percent")}
          />
        )}
      </div>
      {(debt != null || (loanRate != null && loanRate > 0)) && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {debt != null && (
            <StatCard
              label="Median debt at completion"
              value={formatDollar(debt)}
              sub="federal loans, completers"
              tooltip="Median federal student loan debt for students who completed their program. Excludes private loans."
              benchmark={benchmarkLabel(debt, "medianDebt", state, "dollar")}
            />
          )}
          {loanRate != null && loanRate > 0 && (
            <StatCard
              label="Take federal loans"
              value={formatPercent(loanRate)}
              sub="of all students"
              tooltip="Share of students taking out federal student loans. A 0% or very low rate (common at low-tuition community colleges) means loan debt isn't a typical part of the cost story here."
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Returns true if the record has enough non-null fields to be worth
 * rendering. A record with everything null (rare but possible) would render
 * a wall of "—" — we'd rather omit the whole section.
 */
function hasUsefulData(r: ScorecardRecord): boolean {
  return (
    r.cost.tuitionInState != null ||
    r.cost.avgNetPricePublic != null ||
    r.aid.pellGrantRate != null ||
    r.completion.completionRate150nt != null
  );
}

export default function CollegeScorecardSection({
  state,
  collegeId,
  collegeName,
}: Props) {
  const record = getScorecard(state, collegeId);
  if (!record || !hasUsefulData(record)) return null;

  const incomes: Array<{ band: string; amount: number | null }> = [
    { band: "$0 – $30,000", amount: record.cost.netPriceByIncome["0_30000"] },
    { band: "$30,001 – $48,000", amount: record.cost.netPriceByIncome["30001_48000"] },
    { band: "$48,001 – $75,000", amount: record.cost.netPriceByIncome["48001_75000"] },
    { band: "$75,001 – $110,000", amount: record.cost.netPriceByIncome["75001_110000"] },
    { band: "$110,001+", amount: record.cost.netPriceByIncome["110001_plus"] },
  ];
  const anyIncome = incomes.some((i) => i.amount != null);

  // Format fetchedAt → "Fall 2025" or just the year, depending on month.
  const fetched = new Date(record.fetchedAt);
  const year = fetched.getUTCFullYear();
  const reportedYear = fetched.getUTCMonth() >= 9 ? year : year - 1; // Scorecard refreshes in October

  return (
    <section className="mt-8" aria-labelledby="cost-outcomes">
      <SectionHeading
        id="cost-outcomes"
        className="text-xl font-semibold text-gray-900 dark:text-slate-100"
      >
        Cost &amp; outcomes
      </SectionHeading>
      <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
        Federal data on tuition, financial aid, and student outcomes at{" "}
        {collegeName}.
      </p>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard
          label="In-state tuition"
          value={formatDollar(record.cost.tuitionInState)}
          sub="per year (sticker)"
          tooltip="Published tuition and required fees for in-state students. Does not include books, transportation, or living expenses."
          benchmark={benchmarkLabel(record.cost.tuitionInState, "tuitionInState", state, "dollar")}
        />
        <StatCard
          label="Receive Pell"
          value={formatPercent(record.aid.pellGrantRate)}
          sub="federal grant"
          benchmark={benchmarkLabel(record.aid.pellGrantRate, "pellRate", state, "percent")}
        />
        <StatCard
          label="Completion rate"
          value={formatPercent(record.completion.completionRate150nt)}
          sub="within 3 years"
          tooltip="Share of first-time, full-time students who earned a degree or certificate within 3 years (federal standard for 2-year programs)."
          benchmark={benchmarkLabel(record.completion.completionRate150nt, "completionRate150", state, "percent")}
        />
      </div>

      <CostBreakdown record={record} />

      {anyIncome && (
        <div className="mt-6 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
            Net price by family income
          </h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            What students actually paid per year, after grants and scholarships,
            grouped by household income.
          </p>
          <div className="mt-3">
            {incomes.map((row) => (
              <IncomeRow key={row.band} band={row.band} amount={row.amount} />
            ))}
          </div>
        </div>
      )}

      <OutcomesSection record={record} state={state} />

      <EarningsSection record={record} state={state} />

      <p className="mt-4 text-xs text-gray-500 dark:text-slate-400">
        Source:{" "}
        <a
          href={`https://collegescorecard.ed.gov/school/?${record.unitid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-gray-700 dark:hover:text-slate-300"
        >
          U.S. Department of Education College Scorecard
        </a>
        , reporting year ~{reportedYear}.
      </p>
    </section>
  );
}
