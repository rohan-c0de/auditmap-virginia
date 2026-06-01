import { describe, expect, it } from "vitest";
import { runPooled } from "../concurrency";

describe("runPooled", () => {
  it("returns results in input order regardless of completion order", async () => {
    const tasks = [
      () => new Promise<number>((r) => setTimeout(() => r(1), 30)),
      () => new Promise<number>((r) => setTimeout(() => r(2), 5)),
      () => new Promise<number>((r) => setTimeout(() => r(3), 20)),
      () => new Promise<number>((r) => setTimeout(() => r(4), 10)),
    ];
    expect(await runPooled(tasks, 2)).toEqual([1, 2, 3, 4]);
  });

  it("respects the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return 1;
    });
    await runPooled(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(0);
  });

  it("handles an empty task list", async () => {
    expect(await runPooled([], 5)).toEqual([]);
  });

  it("doesn't spawn more workers than tasks", async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 2 }, () => async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return 1;
    });
    await runPooled(tasks, 100);
    expect(peak).toBe(2);
  });

  it("clamps limit to at least 1 even when passed 0 or negative", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
    ];
    expect(await runPooled(tasks, 0)).toEqual(["a", "b"]);
    expect(await runPooled(tasks, -3)).toEqual(["a", "b"]);
  });
});
