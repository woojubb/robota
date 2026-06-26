---
title: 'WEB-013: De-slop the marketing feature section (dedupe cards, break the AI grid)'
status: in-progress
created: 2026-06-26
priority: medium
urgency: soon
area: apps/www
depends_on: []
---

# De-slop the marketing feature section

## What

Rework the "Built for real TypeScript codebases" feature section on `apps/www` to reduce
generic AI-template patterns flagged by the design review:

- **Dedupe overlapping cards:** "Fully Self-Hostable" and "Auditable & Self-Hostable" are
  two of six cards both about self-hosting. Consolidate into one (e.g. "Auditable &
  self-hostable") and replace or drop the freed slot.
- **Break the 2×3 icon-card grid:** the symmetric icon-in-tile + title + 2-line grid is
  the most recognizable AI-generated layout. Introduce hierarchy (one or two hero
  features larger / asymmetric, or a non-grid layout) instead of six equal tiles.
- **Reduce centered-everything:** hero h1 + subtitle are center-aligned; consider a
  left-aligned or composition-first hero.

## Why

Design review (2026-06-26): the official marketing site exhibits 5 of 11 AI-slop patterns
(violet accent, 2×3 icon feature grid, centered hero, system-ui font, cookie-cutter
section rhythm). Typography/color are handled by [[BRAND-001]]; this item handles layout
and content redundancy.

## Findings addressed

- Redundant self-hosting cards (2 of 6).
- Symmetric 2×3 icon-circle feature grid (AI-slop pattern #2/#3).
- Centered hero (AI-slop pattern #4).

## Done When

- No two feature cards describe the same capability.
- Feature section is no longer a symmetric six-equal-tile grid.
- `pnpm --filter robota-www build` passes; i18n EN/KO parity preserved.

## Test Plan

- Build www; confirm no missing i18n keys (EN/KO parity for any changed feature copy).
- Visual check at desktop + mobile breakpoints.

## User Execution Test Scenarios

1. Visit `https://www.robota.io` → the feature section shows no duplicate self-hosting
   cards and reads as an intentional composition, not six identical tiles.
   Evidence: _to fill after implementation._
