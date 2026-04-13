import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AccountDashboard from "./AccountDashboard";

export const metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  // Fetch profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Fetch all saved data for the dashboard
  const [
    { data: schedules },
    { data: courses },
    { data: transfers },
  ] = await Promise.all([
    supabase
      .from("saved_schedules")
      .select("id, state, name, score, score_breakdown, form_data, sections, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("saved_courses")
      .select("id, state, course_prefix, course_number, course_title, college_code, crn, notes, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("saved_transfers")
      .select("id, state, name, selected_courses, selected_universities, filters, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <AccountDashboard
      user={{
        id: user.id,
        email: user.email ?? "",
        displayName:
          profile?.display_name ??
          user.user_metadata?.full_name ??
          user.email?.split("@")[0] ??
          "User",
        avatarUrl:
          profile?.avatar_url ??
          user.user_metadata?.avatar_url ??
          null,
        authProvider: profile?.auth_provider ?? null,
        defaultState: profile?.default_state ?? null,
      }}
      savedSchedules={schedules ?? []}
      savedCourses={courses ?? []}
      savedTransfers={transfers ?? []}
    />
  );
}
