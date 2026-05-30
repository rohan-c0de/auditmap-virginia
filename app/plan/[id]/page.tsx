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
    .select("id, state, name, target_courses, created_at")
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

  return (
    <SavedPlanView
      planId={plan.id}
      state={plan.state}
      systemName={config.systemName}
      name={plan.name}
      targetCourses={plan.target_courses ?? []}
      createdAt={plan.created_at}
    />
  );
}
