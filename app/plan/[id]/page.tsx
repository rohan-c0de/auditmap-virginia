/**
 * /plan/[id] — view a saved degree plan.
 *
 * State-less URL (the plan is the noun, state is metadata on the row). The
 * server component reads the plan row by ID via RLS (Supabase auth.uid()
 * must match user_id), validates the state slug, then renders the standard
 * SemesterPlanner UI hydrated with the saved targets.
 *
 * "Duplicate to edit" semantics, per the PR 1 design discussion:
 *   - Plans are immutable in this PR. The user can add/remove targets on
 *     this page and click Save; that creates a NEW saved_plans row (the
 *     Save button always INSERTs, never UPDATEs). Source plan is unchanged.
 *   - A banner above the planner identifies the source plan + offers a
 *     "Start fresh" link to /[state]/plan for an empty planner.
 *
 * RLS lockdown:
 *   - Unauthenticated users get redirected to / (no plan ID enumeration).
 *   - Authenticated users who don't own this plan get the not-found page
 *     (RLS returns no rows; we treat that as 404, not 403, to avoid
 *     confirming the ID exists).
 */
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStateConfig } from "@/lib/states/registry";
import { getUniversities, loadTransferMappingsByUniversity } from "@/lib/transfer";
import { transferVerdict, type TransferVerdict } from "@/lib/transfer-tracker";
import SavedPlanView from "./SavedPlanView";

type Props = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "Saved plan — Community College Path",
  robots: { index: false, follow: false },
};

export default async function SavedPlanPage({ params }: Props) {
  const { id } = await params;
  // Reject anything that isn't a plausible UUID before hitting the DB.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/?next=/plan/${id}`);
  }

  const { data: plan } = await supabase
    .from("saved_plans")
    .select("id, state, name, target_courses, target_university, completed_courses, created_at")
    .eq("id", id)
    .single();

  // RLS returns null when the row exists but doesn't belong to this user,
  // OR when the row doesn't exist. Either way, 404 — don't confirm
  // existence to non-owners.
  if (!plan) {
    notFound();
  }

  const config = getStateConfig(plan.state);
  if (!config) {
    // Plan references a state that was removed from the registry — treat
    // as not-found rather than crashing.
    notFound();
  }

  // In-state universities the user can pick as their transfer goal (cached
  // file fast-path; falls back to the transfers table). Empty when the state
  // has no transfer data — the picker then simply offers no options.
  const universities = await getUniversities(plan.state);

  // Per-target-course transfer verdict to the chosen university (best outcome:
  // direct > elective > no-credit; "none" if unmapped). Computed server-side
  // for the CURRENT target_university only; the client re-summarizes live as
  // courses are checked, and a university change triggers router.refresh() so
  // this recomputes. Empty {} when no goal is set (or the plan has no targets).
  const targetCourses: string[] = plan.target_courses ?? [];
  let verdicts: Record<string, TransferVerdict> = {};
  if (plan.target_university && targetCourses.length > 0) {
    const mappings = await loadTransferMappingsByUniversity(plan.state, plan.target_university);
    verdicts = Object.fromEntries(targetCourses.map((c) => [c, transferVerdict(mappings, c)]));
  }

  return (
    <SavedPlanView
      planId={plan.id}
      state={plan.state}
      systemName={config.systemName}
      name={plan.name}
      targetCourses={targetCourses}
      createdAt={plan.created_at}
      universities={universities}
      targetUniversity={plan.target_university ?? null}
      completedCourses={plan.completed_courses ?? []}
      verdicts={verdicts}
    />
  );
}
