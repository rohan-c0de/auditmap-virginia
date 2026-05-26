/**
 * GET /api/[state]/articulation?cc=...&university=...
 * Returns available majors for a CC→University pair
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface MajorOption {
  name: string;
  slug: string;
}

export const revalidate = 86400; // 1 day

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ state: string }> }
) {
  const { state: stateParam } = await params;
  const state = stateParam.toLowerCase();
  const cc = request.nextUrl.searchParams.get("cc");
  const university = request.nextUrl.searchParams.get("university");

  if (!cc || !university) {
    return NextResponse.json(
      { error: "Missing cc or university parameter" },
      { status: 400 }
    );
  }

  try {
    // Query unique majors for this CC→University combination
    const { data: agreements, error } = await supabase
      .from("assist_agreements")
      .select("major_name, major_slug")
      .eq("state", state)
      .eq("cc_slug", cc)
      .eq("receiving_institution_slug", university)
      .order("major_slug");

    if (error) throw error;

    // Deduplicate by slug (in case same major appears multiple times)
    const uniqueMajors = Array.from(
      new Map(
        (agreements || []).map((a: any) => [a.major_slug, { name: a.major_name, slug: a.major_slug }])
      ).values()
    ) as MajorOption[];

    return NextResponse.json(
      { majors: uniqueMajors },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (err: any) {
    console.error("articulation majors query error:", err);
    return NextResponse.json(
      { error: "Failed to fetch majors" },
      { status: 500 }
    );
  }
}
