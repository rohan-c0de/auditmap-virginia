/**
 * GET /api/[state]/articulation/[major]?cc=...&university=...
 * Returns full articulation agreement with requirement groups, requirements, and sending options
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const revalidate = 86400; // 1 day

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ state: string; major: string }> }
) {
  const { state: stateParam, major: majorParam } = await params;
  const state = stateParam.toLowerCase();
  const majorSlug = majorParam.toLowerCase();
  const cc = request.nextUrl.searchParams.get("cc");
  const university = request.nextUrl.searchParams.get("university");

  if (!cc || !university) {
    return NextResponse.json(
      { error: "Missing cc or university parameter" },
      { status: 400 }
    );
  }

  try {
    // 1. Find the agreement
    const { data: agreements, error: agErr } = await supabase
      .from("assist_agreements")
      .select("id, cc_name, cc_slug, receiving_institution_name, receiving_institution_slug, major_name, major_slug")
      .eq("state", state)
      .eq("cc_slug", cc)
      .eq("receiving_institution_slug", university)
      .eq("major_slug", majorSlug)
      .single();

    if (agErr) {
      if (agErr.code === "PGRST116") {
        // Not found
        return NextResponse.json(
          { error: "Agreement not found" },
          { status: 404 }
        );
      }
      throw agErr;
    }

    const agreementId = agreements.id;

    // 2. Fetch requirement groups with all nested data
    const { data: groups, error: grErr } = await supabase
      .from("assist_requirement_groups")
      .select(
        `
        id,
        group_name,
        group_type,
        position,
        assist_requirements (
          id,
          receiving_course_prefix,
          receiving_course_number,
          receiving_course_title,
          receiving_course_units,
          requirement_label,
          position,
          no_articulation_reason,
          assist_sending_options (
            cc_course_prefix,
            cc_course_number,
            cc_course_title,
            cc_course_units,
            conjunction,
            position
          )
        )
      `
      )
      .eq("agreement_id", agreementId)
      .order("position");

    if (grErr) throw grErr;

    // 3. Construct response
    const requirementGroups = (groups || []).map((g: any) => ({
      name: g.group_name,
      type: g.group_type,
      requirements: (g.assist_requirements || [])
        .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
        .map((r: any) => ({
          receiving_course_prefix: r.receiving_course_prefix,
          receiving_course_number: r.receiving_course_number,
          receiving_course_title: r.receiving_course_title,
          receiving_course_units: r.receiving_course_units,
          requirement_label: r.requirement_label,
          sending_options: r.no_articulation_reason
            ? null
            : (r.assist_sending_options || [])
                .sort((a: any, b: any) => (a.position || 0) - (b.position || 0))
                .map((opt: any) => ({
                  cc_course_prefix: opt.cc_course_prefix,
                  cc_course_number: opt.cc_course_number,
                  cc_course_title: opt.cc_course_title,
                  cc_course_units: opt.cc_course_units,
                  conjunction: opt.conjunction,
                })),
          no_articulation_reason: r.no_articulation_reason,
        })),
    }));

    const agreement = {
      cc_name: agreements.cc_name,
      cc_slug: agreements.cc_slug,
      receiving_institution_name: agreements.receiving_institution_name,
      receiving_institution_slug: agreements.receiving_institution_slug,
      major_name: agreements.major_name,
      major_slug: agreements.major_slug,
      requirement_groups: requirementGroups,
    };

    return NextResponse.json(
      { agreement },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (err: any) {
    console.error("articulation detail query error:", err);
    return NextResponse.json(
      { error: "Failed to fetch agreement" },
      { status: 500 }
    );
  }
}
