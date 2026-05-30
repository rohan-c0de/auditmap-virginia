import { describe, expect, it } from "vitest";
import {
  capMappingsByRoundRobin,
  trimMappingsForClient,
  TRANSFER_HUB_MAX_CLIENT_MAPPINGS,
} from "../transfer";
import type { TransferMapping } from "../types";

function makeMapping(prefix: string, number: string): TransferMapping {
  return {
    cc_prefix: prefix,
    cc_number: number,
    cc_course: `${prefix} ${number}`,
    cc_title: `${prefix} ${number} Title`,
    cc_credits: "3",
    university: "uni",
    university_name: "Test University",
    univ_course: `U${prefix} ${number}`,
    univ_title: "Univ Title",
    univ_credits: "3",
    notes: "",
    no_credit: false,
    is_elective: false,
  };
}

describe("capMappingsByRoundRobin", () => {
  it("returns input unchanged when below cap", () => {
    const input = [makeMapping("ENG", "111"), makeMapping("MTH", "161")];
    expect(capMappingsByRoundRobin(input, 100)).toBe(input);
  });

  it("never exceeds the cap", () => {
    const input: TransferMapping[] = [];
    for (let i = 0; i < 5000; i++) input.push(makeMapping("ENG", String(i)));
    const capped = capMappingsByRoundRobin(input, 100);
    expect(capped.length).toBe(100);
  });

  it("preserves every subject when one bucket dominates the input", () => {
    // 5000 ENG + 5 MTH + 5 BIO. A naive top-N slice would drop MTH/BIO.
    const input: TransferMapping[] = [];
    for (let i = 0; i < 5000; i++) input.push(makeMapping("ENG", String(i)));
    for (let i = 0; i < 5; i++) input.push(makeMapping("MTH", String(i)));
    for (let i = 0; i < 5; i++) input.push(makeMapping("BIO", String(i)));

    const capped = capMappingsByRoundRobin(input, 100);
    const prefixes = new Set(capped.map((m) => m.cc_prefix));
    expect(prefixes.has("ENG")).toBe(true);
    expect(prefixes.has("MTH")).toBe(true);
    expect(prefixes.has("BIO")).toBe(true);
  });

  it("rotates buckets so smaller subjects are not starved", () => {
    // With 3 buckets each of size 50 and a cap of 30, round-robin should
    // deliver an even-ish distribution rather than 30 from one bucket.
    const input: TransferMapping[] = [];
    for (let i = 0; i < 50; i++) input.push(makeMapping("ENG", String(i)));
    for (let i = 0; i < 50; i++) input.push(makeMapping("MTH", String(i)));
    for (let i = 0; i < 50; i++) input.push(makeMapping("BIO", String(i)));

    const capped = capMappingsByRoundRobin(input, 30);
    expect(capped.length).toBe(30);
    const counts: Record<string, number> = {};
    for (const m of capped) counts[m.cc_prefix] = (counts[m.cc_prefix] ?? 0) + 1;
    expect(counts.ENG).toBe(10);
    expect(counts.MTH).toBe(10);
    expect(counts.BIO).toBe(10);
  });

  it("handles empty input", () => {
    expect(capMappingsByRoundRobin([], 100)).toEqual([]);
  });
});

describe("trimMappingsForClient", () => {
  it("strips fields outside the client subset", () => {
    const trimmed = trimMappingsForClient([makeMapping("ENG", "111")]);
    expect(trimmed[0]).toEqual({
      cc_prefix: "ENG",
      cc_number: "111",
      cc_title: "ENG 111 Title",
      cc_credits: "3",
      univ_course: "UENG 111",
      univ_title: "Univ Title",
      notes: "",
      is_elective: false,
    });
    // Verify these source-only fields are gone.
    expect((trimmed[0] as unknown as { university?: string }).university).toBeUndefined();
    expect((trimmed[0] as unknown as { no_credit?: boolean }).no_credit).toBeUndefined();
  });

  it("preserves array length", () => {
    const input = [
      makeMapping("ENG", "111"),
      makeMapping("ENG", "112"),
      makeMapping("MTH", "161"),
    ];
    expect(trimMappingsForClient(input)).toHaveLength(3);
  });
});

describe("TRANSFER_HUB_MAX_CLIENT_MAPPINGS", () => {
  it("matches the documented Vercel-payload-safe ceiling", () => {
    expect(TRANSFER_HUB_MAX_CLIENT_MAPPINGS).toBe(2500);
  });
});
