import { describeSeats, seatLabel, seatTone } from "@/lib/seats";

const TONE: Record<string, string> = {
  good: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  low: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  full: "bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400",
  muted: "text-gray-400 dark:text-slate-500",
};

/**
 * Honest seat badge for a single section. Routes raw seats_open/seats_total
 * through describeSeats so negatives render "Full", flags/sentinels render
 * "Open", and only trustworthy numbers render as counts. Pure render — safe in
 * server and client components alike.
 */
export default function SectionSeats({
  open,
  total,
  className = "",
  hideUnknown = false,
}: {
  open: number | null | undefined;
  total: number | null | undefined;
  className?: string;
  /** Render nothing (instead of "—") when seats are unknown — for compact
   *  inline badge rows where a dash would be noise. */
  hideUnknown?: boolean;
}) {
  const info = describeSeats(open, total);
  if (info.status === "unknown") {
    if (hideUnknown) return null;
    return <span className={`text-[10px] ${TONE.muted} ${className}`}>&mdash;</span>;
  }
  const title =
    info.status === "full" && info.waitlist
      ? `Full — ${info.waitlist} on the waitlist`
      : undefined;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE[seatTone(info)]} ${className}`}
      title={title}
    >
      {seatLabel(info)}
    </span>
  );
}
