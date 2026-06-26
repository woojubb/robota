---
title: 'BRAND-002: Unify apps/agent-web to the brand system (IBM Plex + emerald)'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: apps/agent-web
depends_on: [BRAND-001]
---

# Unify apps/agent-web to the brand system

## What

`apps/agent-web` (the third Next.js app) was not part of BRAND-001 and still uses the
pre-unification identity:

- **Color:** `globals.css` defines `--primary`/`--accent`/`--ring`/`--chart-1`/
  `--sidebar-primary`/`--sidebar-ring` (and `--studio-accent-violet`) as `#a78bfa`
  (violet). Swap to the unified emerald `#2dd4a7` token set (mirror BRAND-001).
- **Typography:** `layout.tsx` loads `Space_Grotesk` + `Fira_Code`. Replace with
  `IBM_Plex_Sans` + `IBM_Plex_Mono` via `next/font/google`, exposed as the same CSS
  variables the other apps use.
- **Semantic structure / a11y:** the root layout has only `<main>` — add `<header>`/
  `<footer>` landmarks if/when global nav exists, and ensure interactive controls meet
  the 44px tap-target floor.

## Why

Code/design review pattern: all robota.io web properties should share one brand
identity (IBM Plex + emerald). agent-web currently presents a different palette and
typeface, breaking cross-property consistency.

## Done When

- agent-web `globals.css` uses the emerald token set; no `#a78bfa` literals remain.
- IBM Plex Sans/Mono load via next/font; no Space Grotesk / Fira Code.
- `pnpm --filter <agent-web pkg> build` passes; accent renders emerald.

## Test Plan

- Build agent-web; grep for residual `#a78bfa` / `Space_Grotesk` / `Fira_Code` → 0.
- Visual spot-check against www/docs.

## User Execution Test Scenarios

1. Open the agent-web app → body/headings render IBM Plex; accent is emerald, matching
   www and docs. Evidence: _to fill._
