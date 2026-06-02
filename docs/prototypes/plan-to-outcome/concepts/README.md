# Design concepts — Plan-to-Outcome

A scratchpad of **exploratory visual-design concepts** for the Plan-to-Outcome experience
(and the site's look & feel generally). These are **references to react to**, not shipping
code and **not wired into the app**. The working prototype lives one level up
(`../journey.html`); this folder is where we collect "what could it look like" ideas while
the design direction is still being explored.

Each concept is a self-contained HTML file — **just open it in a browser** (no server, no build).

## Concepts

### `welcome-inspired.html` — welcome-screen visual direction
A more polished, modern take on the welcome/landing screen, in our brand (teal + slate +
Geist). Inspired by a set of ed-tech / community references the owner liked:
[Circle](https://circle-website.webflow.io) · [Teachable](https://www.teachable.com) ·
[CAPSLOCK](https://capslock.ac) · an EduPress e-learning Figma template.

What it borrows:
- **Floating "product as hero"** — instead of a generic illustration, the hero shows our
  real UI floating in depth (a live course card, an earnings stat, a transfer chip) over soft
  teal/amber blobs + a dashed ring. (Capslock's floating graphic elements, applied to our data.)
- **"How it works" 3-step flow** (Circle's syllabus flow): Plan → Schedule → Transfer → Outcomes.
- **Social-proof strip + structured sections + soft-shadow cards + pill buttons** (Teachable).
- **Big airy hero, confident type, generous whitespace**, a teal highlight underline on the
  emphasis word, primary + soft-secondary CTAs.

⚠️ **Honesty placeholders — do NOT ship as-is.** The student **quote** is illustrative (written
to represent the north-star user, not a real testimonial), and the **partner logos / "50+
colleges"** are text stand-ins. Real social proof needs real students/sources, per the
project's no-fabrication principle. The course/earnings/transfer values shown are real GA /
Atlanta Tech / Accounting figures.

Status: **partial keep** — the owner liked *some* of it; not yet adopted into the live
prototype. Still gathering additional ideas before committing to a direction.

---

### `home-search.html` — search-first home
A landing where the **search interaction is the hero** (not a static illustration): a pill
search bar — "I want to study ___ near ___ transfer to ___" — over category pills, then a
**map + list split** of nearby colleges. Each result card carries a letter-grade transfer
badge, a confident single cost **estimate**, an open-seats indicator, and a personal **fit
meter**.

Borrows from:
- **Airbnb** — search-as-hero, the pill search bar, category browsing.
- **Zillow** — the map+list split, the one confident "estimate" number (à la Zestimate), filter chips.
- **Niche** — letter-grade report-card badges.
- **CollegeVine** — the personalized "fit" gauge.

⚠️ **Honesty:** **Atlanta Technical College** figures are real (Accounting A.S.). The other four
are **real Georgia institutions**, but their cost / earnings / grade / fit numbers are
**illustrative placeholders** (tagged inline). The map is **stylized**, not geographic.

### `compare-outcomes.html` — outcomes & compare *(almost entirely real data)*
A College-Scorecard-style outcomes surface for one program: an **earnings distribution**
(25th / median / 75th percentile), **cost-by-income** bars (showing that for families under
$48k, aid *exceeds* tuition — a genuinely non-obvious, honest insight), the **transfer
breakdown** per university (direct equivalent vs. elective vs. no-credit), and an
**earnings-vs-nearby-colleges** comparison.

Borrows from:
- **College Scorecard** — earnings distribution, cost-by-income, comparison framing.
- **NerdWallet** — money made plain-English + trustworthy, with the caveats surfaced not hidden.
- **Niche** — compare layout.

✅ **Honesty: every number on this page is real** — College Scorecard outcomes & net-price-by-income
for Atlanta Tech, real GA statewide articulation counts, real per-college earnings for 22 GA
colleges. The honesty *caveats* themselves are part of the design (college-wide vs. major-specific
earnings; "reviewed ≠ transfers"). This is the strongest demonstration that our real data already
supports a premium outcomes view.

### `journey-dashboard.html` — personal dashboard (premium dark)
A signed-in "your path" dashboard: a **progress ring** (credits done), stat tiles (semesters
left, projected earnings, universities that accept your credits, open seats in your next class),
a **semester timeline** (done / now / planned), an earnings **trajectory** curve, and a "best
next class" recommendation. Defaults to a **premium dark** theme with a working light toggle.

Borrows from:
- **Flighty** — personal data made *beautiful*, the timeline/recap feel, premium dark aesthetic.
- **Apple** — restraint, one focal number per tile.

⚠️ **Honesty:** course codes, credits (67 total), earnings ($30,350 median; $14.5k–$48.4k range),
seats (18), and the West Georgia transfer count (25) are **real** Atlanta Tech / Accounting data.
The **completed-credits state and semester layout are an illustrative example** of an in-progress
student — the real version is driven by what the student checks off.

## How to add a new concept here
Drop a self-contained `*.html` in this folder and add a short blurb above: what it explores,
what it borrows/changes, and any honesty caveats (no fabricated data/quotes presented as real).
