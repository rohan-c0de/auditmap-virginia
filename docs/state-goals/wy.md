# Wyoming (wy) — state goals

> **Current tier: B** · Limited by: **courses** · _Refreshed 2026-06-22_
>
> Dimensions: `crs=B` `prq=A` `trf=A` `sc=A` `cfg=A`
>
> _Transfers are now wired (A) — the old F is cleared. Courses sit at 86% (6/7); the single gap, Central Wyoming College, is a genuine deferred-buildable (Colleague behind SAML-SSO + Cloudflare WAF; schedule only in Google Docs). B is an honest grade — this is NOT a cheap flip._

## Diagnosis

- **Primary gap:** courses 86% (6/7). The lone gap is `central-wyoming-college`.
- **Disposition (honest):** `lib/states/wy/config.ts` marks it `DEFERRED-scrapers`: Colleague host `central-ss.colleague.elluciancloud.com` is 100% SAML-SSO-gated (tenant central.edu), course-search is behind Cloudflare WAF, and the only public schedule is Google Docs spreadsheets — no stable machine-readable public SIS endpoint.
- **B is fair.** Don't ceiling-game public-but-hard data. Two optional paths to A, both judgment calls:
  1. **Defensible ceiling** — argue that a SAML+WAF SIS with data only in ad-hoc Google Docs is not a stable public endpoint, and record `central-wyoming-college` in `documentedCeilings.courseColleges`. Borderline (the Docs are technically public) — only if you can defend it in the PR.
  2. **Bespoke build** — parse the public Google-Docs schedule spreadsheets → real sections. Honest but fragile/brittle; medium effort.
- **Effort:** accept-B is free; the ceiling path is cheap metadata (but a judgment call); the build path is medium and brittle.
- **Course colleges:** 0 cleanly buildable / 1 deferred-buildable.
- **Programs / planner:** check `scripts/wy/scrape-programs.ts` base URLs — a separate GOLD lever, not this gap.

## Goal checklist

### WY — current tier B (limited only by courses; transfers now wired/A)

- [ ] **Default: accept B.** It's an honest grade for a single SAML+WAF-gated college. Only pursue A if there's appetite.
- [ ] If pursuing A, pre-flight `WT=$(scripts/new-pr-worktree.sh wy-central); cd "$WT"` and pick a path for `central-wyoming-college`:
  - **Path A (defensible ceiling):** add it to `documentedCeilings.courseColleges` in `lib/states/wy/config.ts` with the SAML-SSO + Cloudflare-WAF + Google-Docs-only rationale (cite the existing `DEFERRED-scrapers` note). Only if you can defend "no stable public endpoint" in the PR body.
  - **Path B (bespoke build):** write a parser over the public Google-Docs schedule spreadsheets → `data/wy/courses/central-wyoming-college/`; wire or mark `// manual-only:` honestly.
- [ ] Re-run the collector for wy; confirm courses A, composite A.
- [ ] PR (branch `claude/wy-central`): plain-English first; name the SAML/WAF reality and which path you took. DO NOT MERGE — stop for review.

Definition of done: wy accepted at B (no change) OR central-wyoming has real course data OR is a defensibly-documented ceiling; no placeholder data, no grade-gaming.
