---
title: 'WEB-014: Fix marketing-site console 404s and undersized touch targets'
status: todo
created: 2026-06-26
priority: medium
urgency: soon
area: apps/www
depends_on: []
---

# Fix marketing-site console 404s and undersized touch targets

## What

- **404s:** the `www.robota.io` homepage logs 5+ failed resource loads in the console.
  Identify the missing resources (icons, fonts, images, or chunk paths) and fix or remove
  the references.
- **Touch targets:** 20 interactive elements render below the 44×44px minimum. Bump
  padding / hit area so primary nav, footer links, and buttons meet 44px on mobile.

## Why

Design review (2026-06-26): console 404s read as a sloppy/unfinished site and waste
requests; sub-44px tap targets hurt mobile usability (Apple HIG / WCAG target size).

## Findings addressed

- 5+ console 404s on the homepage.
- 20 interactive elements `< 44px`.

## Done When

- Homepage console has no resource 404s.
- Primary interactive elements meet 44×44px on mobile widths.
- `pnpm --filter robota-www build` passes.

## Test Plan

- Load the built site; assert zero 4xx resource responses in the console/network panel.
- Re-run the touch-target audit (interactive elements `< 44px` count → 0 for primary nav
  and CTAs).

## User Execution Test Scenarios

1. Open `https://www.robota.io` with devtools console open → no red 404 errors on load.
   Evidence: _to fill after implementation._
2. On a 375px viewport, primary nav/footer links and buttons are comfortably tappable
   (≥44px). Evidence: _to fill after implementation._
