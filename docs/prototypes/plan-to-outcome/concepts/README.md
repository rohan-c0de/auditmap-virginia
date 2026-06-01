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

## How to add a new concept here
Drop a self-contained `*.html` in this folder and add a short blurb above: what it explores,
what it borrows/changes, and any honesty caveats (no fabricated data/quotes presented as real).
