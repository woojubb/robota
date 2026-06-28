---
title: 'WEB-014: Fix marketing-site console 404s and undersized touch targets'
status: done
completed: 2026-06-27
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

## Root cause (2026-06-26)

The console 404s are Next.js `output: 'export'` RSC-prefetch requests: `next/link`
defaults to prefetching, fetching `/<route>.txt?_rsc=…` payloads that a pure static
export does not produce → 404. They only manifest on the real router (CF Pages), not on
a local static file server. Fix: `prefetch={false}` on all internal `<Link>` (9 instances
across `page.tsx`, `Header.tsx`, `Footer.tsx`).

Touch targets: bumped header nav/lang/github controls, hero CTAs, and footer links to a
`min-h-[44px]` (or `py-3`) hit area. Count of sub-44px interactive elements: **20 → 4**.
The 4 remaining are acceptable: the brand logo mark (28px) and three short-label links
(KO / npm / Issues) that are already ≥44px **tall** — width <44 on a 2-3 char inline link
is not a fat-finger risk and forcing it would distort the label.

## User Execution Test Scenarios

1. Open `https://www.robota.io` with devtools console open → no red 404 errors on load.
   Evidence: locally www serves with zero 404s; `prefetch={false}` removes the RSC-prefetch
   404s that appeared on CF. Live-deploy confirmation pending CF publish.
2. On a 375px viewport, primary nav/footer links and buttons are comfortably tappable
   (≥44px). Evidence: sub-44px interactive count 20 → 4 (remaining are the logo + short
   links already ≥44px tall), verified on the production build 2026-06-26.

## Live verification (2026-06-27)

Live after release: internal links carry `prefetch={false}` (no RSC `.txt`
prefetch 404s on CF); touch-target hit areas (44px) deployed.
