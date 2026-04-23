# Community College Path

A national community college course navigator. Helps students find classes, plan schedules, and understand transfer equivalencies across public community-college systems.

- **Live site:** communitycollegepath.com (Vercel project: `cc-coursemap`)
- **Brand name in user-facing copy:** "Community College Path" — not "CC CourseMap", not "AuditMap". The folder name `cc-coursemap` is legacy.
- **North star:** a first-generation student with no prior college experience should be able to use the site without help.

## Scope

The project is **national, expanding state-by-state**. East Coast is nearly complete. Never treat this as a Virginia-only tool — VA was the original scope but the architecture is multi-state.

Currently covered states (as of this writing): ct, dc, de, ga, md, me, nc, nj, ny, pa, ri, sc, tn, va, vt. Run `getAllStates()` for the authoritative list.

## Stack

Next.js 16 (App Router) + React 19 + TypeScript · Supabase (Postgres + SSR auth) · Tailwind v4 · Playwright + cheerio for scrapers · Resend for transactional email · Vercel hosting.

## Architectural invariants — do not violate

1. **Never hardcode state lists.** Derive from the registry via `getAllStates()` / `getStateConfig(slug)`. Commit `be494a7` removed every hardcoded state list specifically to make new-state expansion a config-only change. Components that need per-state values accept them as props; they do not import a `PLACEHOLDER_BY_STATE`-style map.
2. **State-specific defaults live in `StateConfig`.** Zip placeholders, senior-waiver citations, SIS URLs, `defaultZip`, `defaultZipCity`, etc. Never write ternary chains like `state === 'va' ? X : Y` in components.
3. **Per-state file layout is fixed.** Data in `data/{state}/`, scrapers in `scripts/{state}/`, config in `lib/states/{state}/config.ts`. Dynamic routing through `app/[state]/…`.
4. **Student data never runs through prod with fake values.** If a scraper fails, leave the existing data untouched rather than substitute placeholder courses.

## Environment variables

Source of truth: `.env.example` in repo root. Local dev uses `.env.local` (gitignored). Vercel holds the production values.

## Dev commands

- `npm run dev` — local Next server
- `npm run build` · `npm run lint`
- `npm run scrape:college -- <slug>` — scrape a single VA college (VCCS)
- `npm run enrich:college -- <slug>` — PeopleSoft enrichment for one VA college
- Per-state scrapers live at `scripts/{state}/…` — invoke directly with `tsx`

## Adding a new state

This is the most frequent multi-step workflow. See the `add-new-state` skill (`.claude/skills/add-new-state/`). Short version: bootstrap (data + config + registry) → course scraper → transfer data → prereqs → Supabase import. Each phase is its own PR.

## Environment quirks

**This is NOT the Next.js you know.** Next 16 has breaking changes vs. training-data-era Next.js. Before writing routing, caching, or server-component code, read the relevant page in `node_modules/next/dist/docs/`. Heed deprecation notices.
