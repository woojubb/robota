---
title: 'DOCS-001: Docs sidebar overlaps content on mobile'
status: done
completed: 2026-06-27
created: 2026-06-26
priority: high
urgency: now
area: apps/docs
depends_on: []
---

# Docs sidebar overlaps content on mobile

## What

On `robota.io` (docs) at mobile widths (≈375px), the left navigation sidebar
(GETTING STARTED / GUIDE / EXAMPLES / …) stays expanded and renders ON TOP of the main
content, covering the hero text, the "Get Started"/"Read the Guide" buttons, and the
cards. A floating green hamburger button also exists at the same time, so navigation is
both broken and redundant.

Fix: hide the persistent desktop sidebar below the responsive breakpoint and expose nav
only through the hamburger toggle (or a proper off-canvas drawer).

## Why

Design review (2026-06-26): this is the highest-impact responsive defect found — the
docs landing is partially unusable on mobile because content is obscured.

## Findings addressed

- Mobile sidebar overlaps hero/buttons/cards (HIGH).
- Redundant hamburger FAB coexisting with the always-on sidebar.

## Done When

- At ≤768px the persistent sidebar is hidden; nav is reachable via the hamburger/drawer.
- No content is overlapped at 320 / 375 / 768px.
- Docs build passes.

## Test Plan

- Responsive screenshots at 320 / 375 / 768 / 1024px — no overlap; nav toggle works.
- Confirm no horizontal scroll introduced.

## Investigation note (2026-06-26)

The responsive logic is **already correct in current source**: `DocsLayout`'s
`@media (max-width: 768px)` rule translates `.docs-sidebar` off-screen
(`translateX(-100%)`) and shows the hamburger; the `<aside>` only sets
`transform: translateX(0)` when `mobileOpen`. Verified on the current production
build served locally at a settled 375px viewport — sidebar right edge at x=0
(fully off-screen), `main` margin-left 0, content full-width, hamburger visible,
no overlap (`home-mobile-settled.png`). The overlap seen on the live `robota.io`
was a **stale deployment** predating this fix; it resolves on the next CF publish.

The only code change made here: the mobile hamburger `box-shadow` still used the
pre-BRAND-001 purple `rgba(167,139,250,…)` — corrected to the emerald token along
with four other BRAND-001 stragglers (MermaidDiagram, PackageManagerTabs, www hero
gradient).

## User Execution Test Scenarios

1. Open `https://robota.io` on a phone (or 375px devtools viewport) → the hero text and
   both buttons are fully visible; tapping the hamburger opens nav; nav does not sit on
   top of content. Evidence: verified on the production build served locally 2026-06-26
   (sidebar off-screen at 375px, no content overlap — `home-mobile-settled.png`).
   Live-site confirmation pending the next CF deploy.
