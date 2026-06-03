import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Invariant guard for issue #1137.
 *
 * Next 16: a route with a dynamic segment (`[param]`) that exports
 * `revalidate` (declaring ISR intent) but provides NEITHER
 * `generateStaticParams` NOR `export const dynamic` is silently rendered
 * **dynamically** — the `revalidate` is dead, every response ships
 * `cache-control: no-store`, and ISR never engages. From the official docs:
 *
 *   "You must always return an array from generateStaticParams, even if it's
 *    empty. Otherwise, the route will be dynamically rendered."
 *
 * This bit the program page (#1098/#1137) and the /[state]/online page. The
 * test below fails if any new dynamic ISR route reintroduces the trap, so the
 * fix can't silently regress when someone removes the export.
 */

const APP_DIR = join(__dirname, "..");

/** Recursively collect every page.tsx whose route path contains a [dynamic]
 *  segment (the only routes subject to the #1137 trap). */
function findPageFiles(dir: string = APP_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      out.push(...findPageFiles(full));
    } else if (entry.name === "page.tsx") {
      // Only routes with a [dynamic] segment somewhere in their path.
      if (relative(APP_DIR, full).includes("[")) out.push(full);
    }
  }
  return out;
}

describe("ISR route config invariant (#1137)", () => {
  const pages = findPageFiles();

  it("finds dynamic-segment page routes to check", () => {
    // Sanity: the glob actually matched something, otherwise the test is vacuous.
    expect(pages.length).toBeGreaterThan(5);
  });

  it("every dynamic route that exports `revalidate` also opts into static rendering", () => {
    const offenders: string[] = [];

    for (const file of pages) {
      const src = readFileSync(file, "utf-8");

      const declaresRevalidate = /export\s+const\s+revalidate\s*=/.test(src);
      if (!declaresRevalidate) continue; // no ISR intent → not subject to the trap

      const hasGenerateStaticParams = /generateStaticParams/.test(src);
      const hasDynamicExport = /export\s+const\s+dynamic\b/.test(src);

      if (!hasGenerateStaticParams && !hasDynamicExport) {
        offenders.push(file.replace(APP_DIR, "app"));
      }
    }

    expect(
      offenders,
      `These dynamic routes export \`revalidate\` but neither \`generateStaticParams\` ` +
        `nor \`export const dynamic\`, so Next renders them dynamically and the ` +
        `revalidate is dead (issue #1137). Add \`export function generateStaticParams() ` +
        `{ return []; }\`:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the program page specifically declares generateStaticParams (regression lock for #1098/#1137)", () => {
    const programPage = join(
      APP_DIR,
      "[state]",
      "college",
      "[id]",
      "program",
      "[slug]",
      "page.tsx",
    );
    const src = readFileSync(programPage, "utf-8");
    expect(/export\s+function\s+generateStaticParams/.test(src)).toBe(true);
  });
});
