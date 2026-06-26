---
title: 'DOCS-003: docs sidebar tap targets + InternalLink wrapper'
status: todo
created: 2026-06-27
priority: low
urgency: soon
area: apps/docs
depends_on: []
---

# docs sidebar tap targets + InternalLink wrapper

Follow-ups deferred from DOCS-002 / surfaced by the code review.

## What

1. **Sidebar tap targets.** `Sidebar.tsx` nav links use ~`0.275–0.3rem` vertical padding
   with `0.7–0.825rem` font, yielding ~24–25px touch targets — below the 44px floor the
   marketing site enforces. Increase the hit area (without bloating the dense docs nav
   more than necessary — e.g. a comfortable min-height on the link row).
2. **InternalLink wrapper.** `apps/docs` adds `prefetch={false}` per `<Link>` in
   `Sidebar.tsx`/`Header.tsx`; `apps/www` centralized this in an `InternalLink` wrapper.
   Add the same wrapper to docs so the static-export prefetch policy is one source of
   truth (a new link can't silently regress to RSC-prefetch 404s).

## Why

Consistency + a11y: docs nav has sub-44px targets and duplicates the prefetch policy that
www already centralized.

## Done When

- Docs sidebar nav rows meet a comfortable tap size (or document the intentional density).
- An `InternalLink` (or shared wrapper) carries `prefetch={false}`; no scattered literals.
- Docs build passes; no new prefetch 404s.

## Test Plan

- Measure sidebar link heights at mobile width.
- Grep docs for bare `prefetch={false}` → 0 (all via the wrapper).

## User Execution Test Scenarios

1. On a phone, docs sidebar links are comfortably tappable; devtools shows no RSC
   `.txt?_rsc` prefetch 404s. Evidence: _to fill._
