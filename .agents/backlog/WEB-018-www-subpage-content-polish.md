---
title: 'WEB-018: www subpage content polish + de-slop audit'
status: todo
created: 2026-06-27
priority: low
urgency: later
area: apps/www
depends_on: []
---

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
