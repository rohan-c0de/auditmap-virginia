import { describe, it, expect } from "vitest";
import { buildCollegeCompareRows, applyCompare, type CollegeOfferingInput } from "@/lib/compare-colleges";
import type { CourseSection } from "@/lib/types";

function sec(p: Partial<CourseSection>): CourseSection {
  return {
    college_code: "x", term: "2026SU", course_prefix: "ENG", course_number: "111",
    course_title: "Comp", credits: 3, crn: "1", days: "MW", start_time: "9:00 AM",
    end_time: "10:15 AM", start_date: "2026-06-01", location: "", campus: "Main",
    mode: "in-person", instructor: "Smith", seats_open: 5, seats_total: 30,
    prerequisite_text: null, prerequisite_courses: [], ...p,
  };
}
function college(p: Partial<CollegeOfferingInput>): CollegeOfferingInput {
  return { slug: "c", name: "College", auditAllowed: null, sections: [], modeBreakdown: {}, ...p };
}

describe("buildCollegeCompareRows", () => {
  it("count state → 'N seats open' from honest sum", () => {
    const [r] = buildCollegeCompareRows([
      college({ sections: [sec({ seats_open: 5, seats_total: 30 }), sec({ seats_open: 8, seats_total: 30 }), sec({ seats_open: 0, seats_total: 30 })] }),
    ]);
    expect(r.seatLabel).toBe("13 seats open"); // 5+8, the 0 excluded
    expect(r.availability).toBe(13);
    expect(r.hasOpen).toBe(true);
    expect(r.sectionCount).toBe(3);
  });

  it("flag state (0/1, null totals) → 'N of M sections open', never fake seats", () => {
    const [r] = buildCollegeCompareRows([
      college({ sections: [sec({ seats_open: 1, seats_total: null }), sec({ seats_open: 1, seats_total: null }), sec({ seats_open: 0, seats_total: null })] }),
    ]);
    expect(r.seatLabel).toBe("2 of 3 sections open");
    expect(r.availability).toBe(2);
  });

  it("no seat data → '—'", () => {
    const [r] = buildCollegeCompareRows([college({ sections: [sec({ seats_open: null, seats_total: null })] })]);
    expect(r.seatLabel).toBe("—");
    expect(r.hasOpen).toBe(false);
  });

  it("soonest = earliest start date, schedule formatted; online/async when no times", () => {
    const [r] = buildCollegeCompareRows([
      college({ sections: [
        sec({ start_date: "2026-08-20", days: "TuTh", start_time: "1:00 PM", end_time: "2:15 PM" }),
        sec({ start_date: "2026-06-01", days: "MW", start_time: "9:00 AM", end_time: "10:15 AM" }),
      ] }),
    ]);
    expect(r.soonest).toBe("Mon Wed 9:00 AM–10:15 AM"); // earliest (June) wins
  });

  it("flags online and evening sections", () => {
    const [r] = buildCollegeCompareRows([
      college({ sections: [
        sec({ mode: "online", days: "", start_time: "TBA", end_time: "TBA" }),
        sec({ mode: "in-person", start_time: "6:00 PM", end_time: "8:45 PM" }),
      ] }),
    ]);
    expect(r.hasOnline).toBe(true);
    expect(r.hasEvening).toBe(true);
  });

  it("no evening when all sections are daytime", () => {
    const [r] = buildCollegeCompareRows([college({ sections: [sec({ start_time: "9:00 AM", end_time: "10:15 AM" })] })]);
    expect(r.hasEvening).toBe(false);
  });
});

describe("applyCompare", () => {
  const rows = buildCollegeCompareRows([
    college({ slug: "a", name: "Alpha", sections: [sec({ seats_open: 2, mode: "in-person", start_date: "2026-06-10" })] }),
    college({ slug: "b", name: "Bravo", sections: [sec({ seats_open: 50, mode: "online", days: "", start_time: "TBA", end_time: "TBA", start_date: "2026-06-01" }), sec({ seats_open: 5, start_date: "2026-06-01" })] }),
    college({ slug: "c", name: "Charlie", sections: [sec({ seats_open: 0, start_date: "2026-07-01" })] }),
  ]);

  it("sorts by availability (most open first)", () => {
    expect(applyCompare(rows, { sort: "availability" }).map((r) => r.slug)).toEqual(["b", "a", "c"]);
  });
  it("sorts by soonest (earliest start first)", () => {
    expect(applyCompare(rows, { sort: "soonest" }).map((r) => r.slug)).toEqual(["b", "a", "c"]);
  });
  it("sorts by most sections", () => {
    expect(applyCompare(rows, { sort: "sections" })[0].slug).toBe("b"); // 2 sections
  });
  it("filters open-only (drops the full college)", () => {
    expect(applyCompare(rows, { sort: "name", openOnly: true }).map((r) => r.slug)).toEqual(["a", "b"]);
  });
  it("filters online-only", () => {
    expect(applyCompare(rows, { sort: "name", onlineOnly: true }).map((r) => r.slug)).toEqual(["b"]);
  });
});
