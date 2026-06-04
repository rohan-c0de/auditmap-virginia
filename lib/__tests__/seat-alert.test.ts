import { describe, expect, it } from "vitest";
import { courseHasFullSection } from "@/lib/seat-alert";

const sec = (seats_open: number | null, seats_total: number | null = null) => ({
  seats_open,
  seats_total,
});

describe("courseHasFullSection", () => {
  it("is true when a section has 0 seats (full)", () => {
    expect(courseHasFullSection([sec(5, 30), sec(0, 30)])).toBe(true);
  });

  it("is true when a section has a negative (waitlist) value", () => {
    expect(courseHasFullSection([sec(-3, 30)])).toBe(true);
  });

  it("is false when every section is open or has seats (incl. low counts)", () => {
    expect(courseHasFullSection([sec(5, 30), sec(12, 40), sec(2, 30)])).toBe(false);
  });

  it("is false for unknown seats (null is not 'full')", () => {
    expect(courseHasFullSection([sec(null, null)])).toBe(false);
  });

  it("is false for sentinel values (>=1000 → unlimited/online, not full)", () => {
    expect(courseHasFullSection([sec(9999, 9999)])).toBe(false);
  });

  it("is false for an empty section list", () => {
    expect(courseHasFullSection([])).toBe(false);
  });
});
