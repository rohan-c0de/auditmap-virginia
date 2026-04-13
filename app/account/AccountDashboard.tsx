"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getAllStates } from "@/lib/states/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  authProvider: string | null;
  defaultState: string | null;
}

interface SavedSchedule {
  id: string;
  state: string;
  name: string;
  score: number | null;
  score_breakdown: Record<string, unknown> | null;
  form_data: Record<string, unknown>;
  sections: Record<string, unknown>[];
  created_at: string;
}

interface SavedCourse {
  id: string;
  state: string;
  course_prefix: string;
  course_number: string;
  course_title: string;
  college_code: string | null;
  crn: string | null;
  notes: string | null;
  created_at: string;
}

interface SavedTransfer {
  id: string;
  state: string;
  name: string;
  selected_courses: string[];
  selected_universities: string[];
  filters: Record<string, unknown> | null;
  created_at: string;
}

interface Props {
  user: AccountUser;
  savedSchedules: SavedSchedule[];
  savedCourses: SavedCourse[];
  savedTransfers: SavedTransfer[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const stateMap = new Map(getAllStates().map((s) => [s.slug, s.name]));

function stateName(slug: string): string {
  return stateMap.get(slug) ?? slug.toUpperCase();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildScheduleUrl(state: string, formData: Record<string, unknown>): string {
  const p = new URLSearchParams();
  const subjects = formData.subjects as string[] | undefined;
  if (subjects?.length) p.set("subjects", subjects.join(","));
  const days = formData.daysAvailable as string[] | undefined;
  if (days && days.join(",") !== "M,Tu,W,Th,F") p.set("days", days.join(","));
  if (formData.timeWindowStart && formData.timeWindowStart !== "any")
    p.set("time", String(formData.timeWindowStart));
  if (formData.maxCourses && formData.maxCourses !== 2)
    p.set("max", String(formData.maxCourses));
  if (formData.zip) p.set("zip", String(formData.zip));
  if (formData.maxDistance) p.set("dist", String(formData.maxDistance));
  if (formData.mode && formData.mode !== "any") p.set("mode", String(formData.mode));
  if (formData.minBreakMinutes && Number(formData.minBreakMinutes) > 0)
    p.set("break", String(formData.minBreakMinutes));
  if (formData.includeInProgress) p.set("inprog", "1");
  if (formData.targetUniversity) p.set("univ", String(formData.targetUniversity));
  if (formData.hideFullSections === false) p.set("full", "1");
  if (formData.term) p.set("term", String(formData.term));
  const qs = p.toString();
  return qs ? `/${state}/schedule?${qs}` : `/${state}/schedule`;
}

function buildTransferUrl(state: string, courses: string[]): string {
  const encoded = courses.map((c) => c.replace(/ /g, "+")).join(",");
  return `/${state}/transfer?courses=${encoded}`;
}

// ---------------------------------------------------------------------------
// Group items by state
// ---------------------------------------------------------------------------

function groupByState<T extends { state: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    if (!map.has(item.state)) map.set(item.state, []);
    map.get(item.state)!.push(item);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function AccountDashboard({
  user,
  savedSchedules: initialSchedules,
  savedCourses: initialCourses,
  savedTransfers: initialTransfers,
}: Props) {
  const router = useRouter();
  const [defaultState, setDefaultState] = useState(user.defaultState ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Mutable lists for client-side deletion
  const [schedules, setSchedules] = useState(initialSchedules);
  const [courses, setCourses] = useState(initialCourses);
  const [transfers, setTransfers] = useState(initialTransfers);

  const states = getAllStates();

  const schedulesGrouped = useMemo(() => groupByState(schedules), [schedules]);
  const coursesGrouped = useMemo(() => groupByState(courses), [courses]);
  const transfersGrouped = useMemo(() => groupByState(transfers), [transfers]);

  // ── Preferences ──
  const handleSavePreferences = async () => {
    setSaving(true);
    const supabase = createClient();
    await supabase
      .from("profiles")
      .update({
        default_state: defaultState || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // ── Delete individual items ──
  const deleteSchedule = async (id: string) => {
    const supabase = createClient();
    await supabase.from("saved_schedules").delete().eq("id", id);
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const deleteCourse = async (id: string) => {
    const supabase = createClient();
    await supabase.from("saved_courses").delete().eq("id", id);
    setCourses((prev) => prev.filter((c) => c.id !== id));
  };

  const deleteTransfer = async (id: string) => {
    const supabase = createClient();
    await supabase.from("saved_transfers").delete().eq("id", id);
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  };

  // ── Delete account ──
  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (res.ok) {
        router.push("/");
      } else {
        alert("Failed to delete account. Please try again.");
      }
    } catch {
      alert("Failed to delete account. Please try again.");
    }
    setDeleting(false);
  };

  const totalSaved = schedules.length + courses.length + transfers.length;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100 mb-8">
        My Account
      </h1>

      {/* ── Profile section ── */}
      <section className="rounded-lg border border-gray-200 dark:border-slate-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
          Profile
        </h2>
        <div className="flex items-center gap-4 mb-6">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.displayName}
              className="w-16 h-16 rounded-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
              <span className="text-xl font-bold text-teal-700 dark:text-teal-300">
                {user.displayName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2)}
              </span>
            </div>
          )}
          <div>
            <p className="text-lg font-medium text-gray-900 dark:text-slate-100">
              {user.displayName}
            </p>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {user.email}
            </p>
            {user.authProvider && (
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                Signed in with{" "}
                {user.authProvider.charAt(0).toUpperCase() +
                  user.authProvider.slice(1)}
              </p>
            )}
          </div>
        </div>

        {/* Default state preference */}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="default-state"
              className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1"
            >
              Default state
            </label>
            <select
              id="default-state"
              value={defaultState}
              onChange={(e) => setDefaultState(e.target.value)}
              className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 px-3 py-2 text-sm text-gray-900 dark:text-slate-100 focus:border-teal-500 focus:ring-1 focus:ring-teal-500 outline-none"
            >
              <option value="">None</option>
              {states.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleSavePreferences}
            disabled={saving}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 transition"
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      {/* ── Summary cards ── */}
      <section className="rounded-lg border border-gray-200 dark:border-slate-700 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
          Saved Data
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <a href="#schedules" className="text-center p-4 rounded-lg bg-gray-50 dark:bg-slate-800 hover:ring-2 hover:ring-teal-200 dark:hover:ring-teal-800 transition">
            <p className="text-2xl font-bold text-teal-600">
              {schedules.length}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Saved Schedules
            </p>
          </a>
          <a href="#courses" className="text-center p-4 rounded-lg bg-gray-50 dark:bg-slate-800 hover:ring-2 hover:ring-teal-200 dark:hover:ring-teal-800 transition">
            <p className="text-2xl font-bold text-teal-600">
              {courses.length}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Bookmarked Courses
            </p>
          </a>
          <a href="#transfers" className="text-center p-4 rounded-lg bg-gray-50 dark:bg-slate-800 hover:ring-2 hover:ring-teal-200 dark:hover:ring-teal-800 transition">
            <p className="text-2xl font-bold text-teal-600">
              {transfers.length}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              Transfer Comparisons
            </p>
          </a>
        </div>
        {totalSaved === 0 && (
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-4 text-center">
            Nothing saved yet. Use the schedule builder, course search, or
            transfer tool and click the save/bookmark buttons to keep your work.
          </p>
        )}
      </section>

      {/* ── Saved Schedules ── */}
      <section id="schedules" className="mb-6">
        <SectionHeading
          title="Saved Schedules"
          count={schedules.length}
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
            </svg>
          }
        />
        {schedules.length === 0 ? (
          <EmptyCard message="No saved schedules yet." linkText="Build a schedule" linkHref={user.defaultState ? `/${user.defaultState}/schedule` : "/"} />
        ) : (
          <div className="space-y-3">
            {Array.from(schedulesGrouped.entries()).map(([stateSlug, items]) => (
              <div key={stateSlug}>
                <StateLabel state={stateSlug} />
                <div className="space-y-2">
                  {items.map((s) => (
                    <ScheduleRow key={s.id} schedule={s} onDelete={deleteSchedule} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Bookmarked Courses ── */}
      <section id="courses" className="mb-6">
        <SectionHeading
          title="Bookmarked Courses"
          count={courses.length}
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
          }
        />
        {courses.length === 0 ? (
          <EmptyCard message="No bookmarked courses yet." linkText="Search courses" linkHref={user.defaultState ? `/${user.defaultState}/courses` : "/"} />
        ) : (
          <div className="space-y-3">
            {Array.from(coursesGrouped.entries()).map(([stateSlug, items]) => (
              <div key={stateSlug}>
                <StateLabel state={stateSlug} />
                <div className="space-y-2">
                  {items.map((c) => (
                    <CourseRow key={c.id} course={c} onDelete={deleteCourse} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Saved Transfers ── */}
      <section id="transfers" className="mb-6">
        <SectionHeading
          title="Transfer Comparisons"
          count={transfers.length}
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          }
        />
        {transfers.length === 0 ? (
          <EmptyCard message="No saved comparisons yet." linkText="Compare transfers" linkHref={user.defaultState ? `/${user.defaultState}/transfer` : "/"} />
        ) : (
          <div className="space-y-3">
            {Array.from(transfersGrouped.entries()).map(([stateSlug, items]) => (
              <div key={stateSlug}>
                <StateLabel state={stateSlug} />
                <div className="space-y-2">
                  {items.map((t) => (
                    <TransferRow key={t.id} transfer={t} onDelete={deleteTransfer} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Danger zone ── */}
      <section className="rounded-lg border border-red-200 dark:border-red-900/50 p-6">
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-2">
          Danger Zone
        </h2>
        <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
          Permanently delete your account and all saved data. This action cannot
          be undone.
        </p>
        {showDeleteConfirm ? (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition"
            >
              {deleting ? "Deleting..." : "Yes, delete my account"}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-lg border border-gray-300 dark:border-slate-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-lg border border-red-300 dark:border-red-800 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition"
          >
            Delete Account
          </button>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI pieces
// ---------------------------------------------------------------------------

function SectionHeading({ title, count, icon }: { title: string; count: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-teal-600 dark:text-teal-400">{icon}</span>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">
        {title}
      </h2>
      {count > 0 && (
        <span className="rounded-full bg-gray-100 dark:bg-slate-700 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-slate-400">
          {count}
        </span>
      )}
    </div>
  );
}

function StateLabel({ state }: { state: string }) {
  return (
    <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2 mt-1">
      {stateName(state)}
    </p>
  );
}

function EmptyCard({ message, linkText, linkHref }: { message: string; linkText: string; linkHref: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 dark:border-slate-700 py-8 text-center">
      <p className="text-sm text-gray-500 dark:text-slate-400">{message}</p>
      <Link href={linkHref} className="mt-2 inline-block text-sm font-medium text-teal-600 hover:text-teal-800 dark:text-teal-400 dark:hover:text-teal-300">
        {linkText} &rarr;
      </Link>
    </div>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);

  if (confirm) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          onClick={onDelete}
          className="text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
        >
          Confirm
        </button>
        <button
          onClick={() => setConfirm(false)}
          className="text-xs text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirm(true)}
      className="text-xs text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 transition"
      title="Delete"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Schedule Row
// ---------------------------------------------------------------------------

function ScheduleRow({ schedule, onDelete }: { schedule: SavedSchedule; onDelete: (id: string) => void }) {
  const courseCount = schedule.sections?.length ?? 0;
  const subjects = schedule.sections
    ?.map((s: Record<string, unknown>) => `${s.course_prefix} ${s.course_number}`)
    .filter(Boolean) ?? [];
  const uniqueSubjects = [...new Set(subjects)];

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 flex items-center gap-3">
      {/* Score badge */}
      {schedule.score !== null && (
        <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
          schedule.score >= 80
            ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300"
            : schedule.score >= 60
              ? "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300"
              : "bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300"
        }`}>
          {schedule.score}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
          {schedule.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
          {uniqueSubjects.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
              {uniqueSubjects.join(", ")}
            </p>
          )}
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {courseCount} {courseCount === 1 ? "section" : "sections"}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {formatDate(schedule.created_at)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={buildScheduleUrl(schedule.state, schedule.form_data)}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
          </svg>
          Re-run
        </Link>
        <DeleteButton onDelete={() => onDelete(schedule.id)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Course Row
// ---------------------------------------------------------------------------

function CourseRow({ course, onDelete }: { course: SavedCourse; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 flex items-center gap-3">
      {/* Bookmark icon */}
      <div className="shrink-0 text-teal-600 dark:text-teal-400">
        <svg className="h-5 w-5" fill="currentColor" stroke="currentColor" strokeWidth={0.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
          {course.course_prefix} {course.course_number}
          <span className="font-normal text-gray-500 dark:text-slate-400 ml-1.5">
            &mdash; {course.course_title}
          </span>
        </p>
        <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
          {formatDate(course.created_at)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/${course.state}/courses?q=${encodeURIComponent(`${course.course_prefix} ${course.course_number}`)}`}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          Search
        </Link>
        <DeleteButton onDelete={() => onDelete(course.id)} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transfer Row
// ---------------------------------------------------------------------------

function TransferRow({ transfer, onDelete }: { transfer: SavedTransfer; onDelete: (id: string) => void }) {
  const courseCount = transfer.selected_courses?.length ?? 0;
  const uniCount = transfer.selected_universities?.length ?? 0;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 flex items-center gap-3">
      {/* Icon */}
      <div className="shrink-0 text-teal-600 dark:text-teal-400">
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
          {transfer.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {courseCount} {courseCount === 1 ? "course" : "courses"}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500">&middot;</span>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {uniCount} {uniCount === 1 ? "university" : "universities"}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500">&middot;</span>
          <span className="text-xs text-gray-400 dark:text-slate-500">
            {formatDate(transfer.created_at)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={buildTransferUrl(transfer.state, transfer.selected_courses)}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Open
        </Link>
        <DeleteButton onDelete={() => onDelete(transfer.id)} />
      </div>
    </div>
  );
}
