---
title: 'WEB-016: InternalLink + tap-target primitives (de-duplicate www)'
status: todo
created: 2026-06-27
priority: low
urgency: soon
area: apps/www
depends_on: []
---

# InternalLink + tap-target primitives

Follow-up from the code review of WEB-014.

## What

1. **`prefetch={false}` scattered (altitude).** The static-export prefetch policy is
   pasted onto ~15 individual `<Link>` across `apps/www` (and docs). A new link is easy to
   add without it (silently regressing to eager prefetch + RSC 404s), and reversing the
   policy means editing every site. Add a thin `InternalLink` wrapper (or app-local
   `next/link` re-export) that bakes in `prefetch={false}`, and use it everywhere.
2. **`min-h-[44px]` tap target duplicated.** The `inline-flex min-h-[44px] items-center`
   hit-area is repeated as a literal on ~12 links/buttons. Express it once (a shared
   className constant, a `@utility`, or a small tap-target primitive) so the 44px minimum
   is enforced by a component, not copy-paste discipline.

## Why

Code review (2026-06-27): both fixes from WEB-014 are correct but applied per-call-site;
the policy/constant lives in many strings instead of one source, inviting drift.

## Done When

- Internal links go through one wrapper that sets `prefetch={false}`; no bare
  `prefetch={false}` repetition.
- The 44px tap target is defined once and reused.
- `apps/www` build passes; links still don't prefetch and targets stay ≥44px.

## Test Plan

- Grep: no scattered `prefetch={false}` / `min-h-[44px]` literals remain (all via the
  primitive).
- Build; re-check touch-target audit count unchanged.

## User Execution Test Scenarios

1. Open www with devtools → no RSC `.txt?_rsc` prefetch 404s; nav/footer tap targets
   ≥44px. Evidence: _to fill._
