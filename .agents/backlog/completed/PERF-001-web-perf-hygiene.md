---
title: 'PERF-001: Web performance hygiene — font display:swap + image config consistency'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: soon
area: apps/agent-web, apps/www
depends_on: []
---

## Evidence Log (2026-06-27)

- `apps/agent-web/src/app/layout.tsx`: added `display: 'swap'` to both `Space_Grotesk` and
  `Fira_Code` (parity with www/docs) — avoids the font-swap CLS jump.
- `apps/www/next.config.ts`: added `images: { unoptimized: true }` (explicit, parity with docs)
  since `output: 'export'` can't run the Image Optimization API at runtime.
- Verified: `apps/agent-web` + `apps/www` typecheck pass.

# Web performance hygiene

First performance pass across the web properties (no property had been perf-audited).

## What

1. **`apps/agent-web/src/app/layout.tsx` fonts lack `display: 'swap'`.** The `Space_Grotesk`
   and `Fira_Code` declarations omit `display: 'swap'`, while `apps/www` and `apps/docs` both
   set it. Without swap, text renders in a fallback then swaps on font load → Cumulative
   Layout Shift (a Core Web Vital). Add `display: 'swap'`.
2. **`apps/www/next.config.ts` has no `images` config.** www is `output: 'export'` with no
   explicit `images` strategy, whereas `apps/docs` sets `images: { unoptimized: true }` and
   `agent-web` configures full optimization. Make www's image handling explicit and
   consistent with the static-export reality (e.g. `unoptimized: true` for the export, or a
   documented decision).

## Why

These are cheap, concrete Core-Web-Vitals / consistency wins that directly support the SEO
work (SEO-001) — CLS and image strategy feed Lighthouse/ranking. No property had a perf pass;
this establishes the baseline two fixes.

## Done When

- agent-web fonts use `display: 'swap'` (parity with www/docs).
- www has an explicit `images` config appropriate for its static export.
- All three apps build; no CLS regression introduced.

## Test Plan

- Grep the three apps' font declarations → all set `display: 'swap'`.
- Build www and confirm the image config is honored by `output: 'export'`.
- (Optional) a Lighthouse spot-check on agent-web before/after for CLS.

## User Execution Test Scenarios

1. Load agent-web on a slow connection → no visible font-swap layout jump; www builds and
   serves images per its declared config. Evidence: _to fill._
