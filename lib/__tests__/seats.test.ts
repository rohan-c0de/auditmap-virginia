import { describe, it, expect } from "vitest";
import {
  describeSeats,
  aggregateSeats,
  seatLabel,
  aggregateLabel,
  seatTone,
} from "@/lib/seats";

describe("describeSeats — audited real-world patterns", () => {
  it("null open → unknown (nh, sd, partial states)", () => {
    expect(describeSeats(null, null)).toEqual({ status: "unknown" });
    expect(describeSeats(null, 25)).toEqual({ status: "unknown" });
  });

  it("negative open → full + waitlist (35 states, −1..−363)", () => {
    expect(describeSeats(-5, 30)).toEqual({ status: "full", waitlist: 5 });
    expect(describeSeats(-363, null)).toEqual({ status: "full", waitlist: 363 });
  });

  it("zero open → full", () => {
    expect(describeSeats(0, 25)).toEqual({ status: "full" });
    expect(describeSeats(0, null)).toEqual({ status: "full" }); // flag state closed
  });

  it("sentinel (≥1000, esp. 9999) → open, never the number", () => {
    expect(describeSeats(9999, 9999)).toEqual({ status: "open" });
    expect(describeSeats(1000, 50)).toEqual({ status: "open" });
    expect(describeSeats(5960, 275)).toEqual({ status: "open" }); // ms outlier
  });

  it("flag state open (1, no total) → Open, NOT '1 seat left'", () => {
    expect(describeSeats(1, null)).toEqual({ status: "open" });
  });

  it("real count with sane total → count with both (GA/NC/TX)", () => {
    expect(describeSeats(12, 30)).toEqual({ status: "count", open: 12, total: 30 });
    expect(describeSeats(1, 25)).toEqual({ status: "count", open: 1, total: 25 }); // genuine 1-of-25
  });

  it("real open count, no/garbage total → count with open only", () => {
    expect(describeSeats(12, null)).toEqual({ status: "count", open: 12 }); // CO-style null total
    expect(describeSeats(12, 9999)).toEqual({ status: "count", open: 12 }); // sentinel total dropped
    expect(describeSeats(20, 5)).toEqual({ status: "count", open: 20 }); // impossible total>open dropped
  });
});

describe("aggregateSeats", () => {
  it("sums only trustworthy open counts; ignores negatives/sentinels/nulls", () => {
    const a = aggregateSeats([
      { seats_open: 5, seats_total: 30 }, // +5, open
      { seats_open: -3, seats_total: 30 }, // full (waitlist), 0
      { seats_open: 9999, seats_total: 9999 }, // sentinel → open section, no count
      { seats_open: null, seats_total: null }, // unknown
      { seats_open: 0, seats_total: 25 }, // full
      { seats_open: 8, seats_total: null }, // +8 open
    ]);
    expect(a.openSeats).toBe(13); // 5 + 8 only
    expect(a.openSections).toBe(3); // the 5, the 8, and the sentinel
    expect(a.totalSections).toBe(6);
    expect(a.anyData).toBe(true);
  });

  it("flag-only college → openSeats null, falls back to sections", () => {
    const a = aggregateSeats([
      { seats_open: 1, seats_total: null },
      { seats_open: 1, seats_total: null },
      { seats_open: 0, seats_total: null },
    ]);
    expect(a.openSeats).toBeNull(); // no trustworthy counts
    expect(a.openSections).toBe(2); // two open flags
    expect(a.totalSections).toBe(3);
  });

  it("no data at all → openSeats null, anyData false", () => {
    const a = aggregateSeats([
      { seats_open: null, seats_total: null },
      { seats_open: null, seats_total: null },
    ]);
    expect(a.openSeats).toBeNull();
    expect(a.anyData).toBe(false);
  });
});

describe("labels & tone", () => {
  it("seatLabel reflects status honestly", () => {
    expect(seatLabel(describeSeats(12, 30))).toBe("12 of 30 seats");
    expect(seatLabel(describeSeats(8, null))).toBe("8 seats open");
    expect(seatLabel(describeSeats(1, null))).toBe("Open"); // flag, not "1 seat"
    expect(seatLabel(describeSeats(-5, 30))).toBe("Full");
    expect(seatLabel(describeSeats(0, 25))).toBe("Full");
    expect(seatLabel(describeSeats(9999, 9999))).toBe("Open");
    expect(seatLabel(describeSeats(null, null))).toBe("—");
  });

  it("aggregateLabel always frames as open-of-total SECTIONS (consistent across states)", () => {
    // Count state (GA-shape): even with real seat counts, header reads sections.
    expect(
      aggregateLabel(
        aggregateSeats([
          { seats_open: 5, seats_total: 30 }, // open
          { seats_open: 0, seats_total: 25 }, // full
          { seats_open: 12, seats_total: 30 }, // open
        ]),
      ),
    ).toBe("2 of 3 sections open");
    // Flag state (VA-shape): 0/1 flags → same framing.
    expect(
      aggregateLabel(
        aggregateSeats([
          { seats_open: 1, seats_total: null },
          { seats_open: 0, seats_total: null },
        ]),
      ),
    ).toBe("1 of 2 sections open");
    // Singular when there's a single section.
    expect(aggregateLabel(aggregateSeats([{ seats_open: 5, seats_total: 30 }]))).toBe(
      "1 of 1 section open",
    );
    // No data → null (header shows nothing).
    expect(aggregateLabel(aggregateSeats([{ seats_open: null, seats_total: null }]))).toBeNull();
  });

  it("seatTone: full=full, low count=low, open/healthy=good, missing=muted", () => {
    expect(seatTone(describeSeats(-5, 30))).toBe("full");
    expect(seatTone(describeSeats(3, 30))).toBe("low");
    expect(seatTone(describeSeats(40, 50))).toBe("good");
    expect(seatTone(describeSeats(1, null))).toBe("good"); // "Open"
    expect(seatTone(describeSeats(null, null))).toBe("muted");
  });
});
