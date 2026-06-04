import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase";
import { rateLimit, getClientKey } from "@/lib/rate-limit";
import { buildAccountExport, escapeIlikePattern } from "@/lib/account-export";

/**
 * GET /api/account/export
 *
 * Returns a downloadable JSON copy of everything tied to the authenticated
 * user's account: profile, saved plans / schedules / courses / transfers,
 * seat-watch notification history, and any email subscriptions matching the
 * account email.
 *
 * Security:
 *   - Rate-limited.
 *   - Auth-gated on server-verified getUser(). Identity comes ONLY from the
 *     session, never from a request parameter, so it cannot dump another user's
 *     data. The saved_* tables, profile, and seat-watch history are read
 *     through the user's own RLS; the email-keyed `subscribers` table is read
 *     with the service client, scoped to the verified account email.
 */
export async function GET(request: Request) {
  const { allowed } = rateLimit(getClientKey(request), 10);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Own-rows reads — RLS enforces user-only access on each of these tables.
  const [profile, plans, schedules, courses, transfers, seatNotifs] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("saved_plans").select("*").eq("user_id", user.id),
      supabase.from("saved_schedules").select("*").eq("user_id", user.id),
      supabase.from("saved_courses").select("*").eq("user_id", user.id),
      supabase.from("saved_transfers").select("*").eq("user_id", user.id),
      supabase
        .from("plan_seat_notifications")
        .select("*")
        .eq("user_id", user.id),
    ]);

  // `subscribers` is email-keyed with service-role-only RLS; read via the
  // service client, scoped to the verified account email (escaped, ILIKE).
  let emailSubscriptions: unknown[] = [];
  if (user.email) {
    const { data } = await getServiceClient()
      .from("subscribers")
      .select("*")
      .ilike("email", escapeIlikePattern(user.email));
    emailSubscriptions = data ?? [];
  }

  const payload = buildAccountExport(
    {
      user: { id: user.id, email: user.email ?? null },
      profile: profile.data ?? null,
      savedPlans: plans.data ?? [],
      savedSchedules: schedules.data ?? [],
      savedCourses: courses.data ?? [],
      savedTransfers: transfers.data ?? [],
      seatNotifications: seatNotifs.data ?? [],
      emailSubscriptions,
    },
    new Date().toISOString()
  );

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ccp-data-export.json"',
      "Cache-Control": "no-store",
    },
  });
}
