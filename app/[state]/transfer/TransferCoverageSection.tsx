import type { CoverageRollup, ReceiverRollup } from "@/lib/transfer-coverage";

type Props = {
  coverage: CoverageRollup;
  systemName: string;
};

const CATEGORY_ORDER: Array<ReceiverRollup["receiverCategory"]> = [
  "UC",
  "CSU",
  "Independent",
];

const CATEGORY_LABEL: Record<ReceiverRollup["receiverCategory"], string> = {
  UC: "University of California",
  CSU: "California State University",
  Independent: "Independent / Private",
};

const CATEGORY_BLURB: Record<ReceiverRollup["receiverCategory"], string> = {
  UC: "9 UC campuses. Numbers below count published transfer agreements summed across every community college in the state.",
  CSU: "23 CSU campuses, plus the Maritime Academy and Cal Poly Pomona / SLO.",
  Independent:
    "Private and independent California universities that publish ASSIST agreements (Stanford, USC, Santa Clara, and others).",
};

export default function TransferCoverageSection({
  coverage,
  systemName,
}: Props) {
  const grouped = new Map<
    ReceiverRollup["receiverCategory"],
    ReceiverRollup[]
  >();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const r of coverage.receivers) grouped.get(r.receiverCategory)?.push(r);

  return (
    <section className="mt-12 pt-8 border-t border-gray-200 dark:border-slate-700">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
        Transfer pathways by destination university
      </h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
        Every {systemName} → 4-year transfer agreement published on{" "}
        <a
          href="https://assist.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-600 hover:text-teal-700 underline"
        >
          ASSIST.org
        </a>{" "}
        for {coverage.totalReceivers} receiving universities. Counts show
        published major-level agreements aggregated across all community
        colleges in the state.
      </p>

      <div className="space-y-8">
        {CATEGORY_ORDER.map((cat) => {
          const receivers = grouped.get(cat) ?? [];
          if (receivers.length === 0) return null;
          return (
            <div key={cat}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-1">
                {CATEGORY_LABEL[cat]}{" "}
                <span className="text-gray-400 dark:text-slate-500 font-normal">
                  ({receivers.length})
                </span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
                {CATEGORY_BLURB[cat]}
              </p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {receivers.map((r) => (
                  <li
                    key={r.receiverCode}
                    className="flex items-baseline justify-between gap-3 rounded-md border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">
                      {r.receiverName}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-1 text-xs text-gray-500 dark:text-slate-400">
                      <span className="font-semibold text-gray-700 dark:text-slate-300">
                        {r.totalAgreements.toLocaleString()}
                      </span>
                      <span>agreements</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-gray-500 dark:text-slate-400">
        Source: ASSIST.org academic year{" "}
        {coverage.academicYearId === 76 ? "2025-26" : coverage.academicYearId}.
        Course-by-course detail for individual majors is available on{" "}
        <a
          href="https://assist.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-teal-600 hover:text-teal-700 underline"
        >
          ASSIST.org
        </a>
        .
      </p>
    </section>
  );
}
