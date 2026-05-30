"use client";

const DAYS = [
  { key: "M", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "F", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

interface DayToggleProps {
  selectedDays: string[];
  onChange: (days: string[]) => void;
}

export default function DayToggle({ selectedDays, onChange }: DayToggleProps) {
  function toggleDay(day: string) {
    if (selectedDays.includes(day)) {
      onChange(selectedDays.filter((d) => d !== day));
    } else {
      onChange([...selectedDays, day]);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DAYS.map((d) => {
        const active = selectedDays.includes(d.key);
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => toggleDay(d.key)}
            className={`rounded-md border px-2 py-1.5 text-xs font-medium transition ${
              active
                ? "bg-teal-600 border-teal-600 text-white"
                : "bg-white border-gray-300 text-gray-500 hover:border-teal-400 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:border-teal-400"
            }`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}
