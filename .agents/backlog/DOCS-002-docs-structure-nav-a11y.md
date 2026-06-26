---
title: 'DOCS-002: Docs landing structure, nav crowding, and a11y/SEO fixes'
status: todo
created: 2026-06-26
priority: medium
urgency: soon
area: apps/docs
depends_on: [DEPLOY-001]
---

# Docs landing structure, nav crowding, and a11y/SEO fixes

## What

Cluster of smaller defects on the docs landing (`robota.io`):

- **Semantic structure:** the page has 0 `<section>` elements and only one `<h1>`, no
  `<h2>`/`<h3>`. The "Getting Started / Guide / Packages …" cards are not headings. Mark
  up sections and card titles semantically (improves a11y and SEO/AEO).
- **Empty "Guide" card:** the second hero card shows only the title "Guide" with no
  description, while "Getting Started" has body copy. Add the missing description (or
  remove the empty card).
- **Top-nav crowding:** logo + 8 nav items + search + theme + language + GitHub +
  "← robota.io" overflow the bar. The GitHub link renders as a blank/empty box (missing
  icon — likely tied to the homepage 404s). Restore the icon and reduce crowding.
- **Touch targets:** 25 interactive elements `< 44px`.
- **Console 404s:** 7+ failed resource loads on the docs homepage.

Note: the self-referential "← robota.io" link is owned by [[DEPLOY-001]].

## Why

Design review (2026-06-26): weak document semantics hurt accessibility and search
indexing; the empty card and blank GitHub icon read as unfinished; crowded nav and tiny
tap targets hurt usability.

## Findings addressed

- 0 sections / 1 h1 / 0 h2-h3 semantic structure.
- Empty "Guide" hero card.
- Blank GitHub icon in top nav + nav crowding.
- 25 touch targets `< 44px`; 7+ console 404s.

## Done When

- Sections and card titles use semantic landmarks/headings.
- No empty hero card; GitHub icon renders.
- No homepage console 404s; primary tap targets ≥44px.
- Docs build passes.

## Test Plan

- Re-audit headings (≥1 h1, h2/h3 present) and `<section>` count.
- Console shows no resource 404s; touch-target audit count → 0 for primary controls.

## User Execution Test Scenarios

1. Open `https://robota.io` → every hero card has a title and description; the GitHub icon
   is visible; console shows no 404s. Evidence: _to fill after implementation._
2. Run a quick a11y/heading check (e.g. devtools accessibility tree) → page has a single
   h1 and section headings. Evidence: _to fill after implementation._
