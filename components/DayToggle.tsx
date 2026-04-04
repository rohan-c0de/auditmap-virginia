"use client";

const DAYS = [
  { key: "M", label: "Mon" },
  { key: "Tu", label: "Tue" },
  { key: "W", label: "Wed" },
  { key: "Th", label: "Thu" },
  { key: "F", label: "Fri" },
  { key: "Sa", label: "Sat" },
];

const PRESETS = [
  { keys: ["M", "W", "F"], label: "MWF" },
  { keys: ["Tu", "Th"], label: "TuTh" },
];

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s1 = [...a].sort();
  const s2 = [...b].sort();
  return s1.every((v, i) => v === s2[i]);
}

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

  function handlePreset(preset: string[]) {
    if (arraysEqual(selectedDays, preset)) {
      onChange([]);
    } else {
      onChange(preset);
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
                : "bg-white border-gray-300 text-gray-500 hover:border-teal-400"
            }`}
          >
            {d.label}
          </button>
        );
      })}
      {PRESETS.map((p) => {
        const active = arraysEqual(selectedDays, p.keys);
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => handlePreset(p.keys)}
            className={`rounded-md border px-2 py-1.5 text-[10px] font-medium transition ${
              active
                ? "bg-teal-600 border-teal-600 text-white"
                : "bg-white border-dashed border-gray-300 text-gray-400 hover:border-teal-400 hover:text-gray-500"
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
