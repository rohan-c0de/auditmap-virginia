import { describe, it, expect } from "vitest";
import { isActiveProgramStatus } from "@/scripts/lib/scrape-coursedog-programs";

/**
 * Coursedog tenants store program status with varying casing. The "Active"
 * (capital A) filter sent to the search API returns 0 for tenants that store
 * lowercase "active" (Banner-SQL / some Colleague syncs), so the scraper falls
 * back to an unfiltered fetch and keeps only active programs via this helper.
 * It must accept any casing of "active" (and a missing status) while dropping
 * Inactive / Archived so the fallback never ships retired programs.
 */
describe("isActiveProgramStatus", () => {
  it.each(["active", "Active", "ACTIVE", "  active  "])(
    "keeps active (any casing/whitespace): %s",
    (s) => {
      expect(isActiveProgramStatus(s)).toBe(true);
    },
  );

  it.each([undefined, ""])("keeps missing/blank status: %s", (s) => {
    expect(isActiveProgramStatus(s)).toBe(true);
  });

  it.each(["Inactive", "inactive", "Archived", "archived", "Pending", "Draft"])(
    "drops non-active status: %s",
    (s) => {
      expect(isActiveProgramStatus(s)).toBe(false);
    },
  );
});
