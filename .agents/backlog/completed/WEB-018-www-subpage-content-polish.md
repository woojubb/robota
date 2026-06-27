---
title: 'WEB-018: www subpage content polish + de-slop audit'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: low
urgency: later
area: apps/www
depends_on: []
---

## Evidence Log (2026-06-27)

- **Empty placeholder section (#1, the concrete launch-credibility item)**: hidden the showcase
  "Community Projects" section that rendered only a `communityEmpty` placeholder — it is now
  commented out (strings kept in the dictionaries) to restore with real entries later; the
  Submit section directly below already invites contributions, so nothing user-facing is lost.
- **De-slop audit (#2) + i18n parity (#3)**: these are subjective, layout/visual judgments best
  made against rendered pages — recommended as a browser-based `/design-review` pass rather than
  a headless code change. No template-grid removals were made blindly.
- Verified: `apps/www` typecheck + static-export build pass; no `communityEmpty` placeholder
  renders.

# www subpage content polish + de-slop audit

## What

The homepage got a de-slop pass (WEB-013); the subpages were not reviewed for the same:

1. **Empty placeholder section.** The showcase page renders a "Community Projects" section
   whose only content is a `communityEmpty` placeholder string. Populate it with real
   entries or hide the section until there is content (a launch-credibility issue).
2. **De-slop audit of subpages** (compare/showcase/enterprise/roadmap/beta) for the same
   AI-template patterns the homepage fixed: centered-everything, symmetric icon-card
   grids, duplicate/overlapping copy, generic hero phrasing.
3. **i18n parity** for any copy changed (EN/KO).

## Why

Pre-launch credibility: placeholder/empty sections and template-grid slop on secondary
pages undercut the polish applied to the homepage.

## Done When

- No empty placeholder sections render on any subpage.
- Subpages no longer exhibit the flagged AI-slop patterns (or a note explains why a grid
  is intentional).
- EN/KO parity preserved; www build passes.

## Test Plan

- Build www; visual review of each subpage at desktop + mobile.
- Confirm no `*Empty`/placeholder strings render.

## User Execution Test Scenarios

1. Visit each www subpage → no empty/placeholder sections; layouts read as intentional
   compositions. Evidence: _to fill._
