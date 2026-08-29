---
title: 'INFRA-145: allocator sentinel floor discards live work-item claims'
issue: https://github.com/woojubb/robota/issues/2390
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: harness work-item allocation
depends_on: []
---

# INFRA-145: allocator sentinel floor discards live work-item claims

## Objective

Make work-item allocation preserve every live claim, including real Task records at or above the
numeric band currently treated as fixture-only. An allocator invocation must never propose or write
an ID already owned by another record, regardless of slug, prefix, or sentinel-boundary position.

This Task is registered by [issue #2390](https://github.com/woojubb/robota/issues/2390). It is one
foundational cause: the claimed-set model discards authoritative records based only on their number.

## Existing Evidence

- `pnpm harness:task:allocate HARNESS --dry-run` on current `develop` reports 1,561 examined claims
  and still returns the already-owned `HARNESS-900`.
- `scripts/harness/allocate-work-item-id.mjs` ignores every number at or above
  `SENTINEL_FLOOR = 900` in `nextFreeId()`, while a real `HARNESS-900` Task is tracked on
  `develop` and a fixture citation at `HARNESS-899` drives the candidate to that floor.
- PR #2507 reproduced the consequence: a second record with a different slug was written at
  `HARNESS-900`, and `pnpm harness:test:contracts` correctly failed the collision scan.
- Issue #2390 records the same fully up-to-date-tree reproduction and a prior containment;
  issue #1916 records the collision history that motivated the allocator.

> **Contained — INFRA-143.** This occurrence is kind-qualified locally, but free-form document
> authoring still relies on a late integration scan to catch the same recurring reference defect.

## Scope Boundary

- Own the allocator's claimed-ID model and the fixture/real-record distinction.
- Preserve atomic record creation and the union of tracked records, tracked citations, and issue
  title claims.
- Add a refusing check for any generated candidate that is already claimed.
- Do not weaken `scan-work-item-id-collision`, allow known live collisions, or rename unrelated
  historical records as a substitute for fixing allocation.

## Plan

- [ ] Record a recommendation and planning checkpoint for the allocation invariant.
- [ ] Add a regression fixture containing a real record at the sentinel floor and a fixture just
      below it; prove allocation never returns the real record's ID.
- [ ] Replace the number-only sentinel assumption with a claim model that distinguishes fixture
      citations from authoritative work-item records, or otherwise refuses claimed candidates.
- [ ] Verify both dry-run and write modes across different slugs and prefixes.
- [ ] Remove `Contained — INFRA-145.` holds only after the corrected allocator lands.

## Completion Criteria

- A real record at `HARNESS-900` is never ignored when computing or validating the next HARNESS ID.
- A fixture citation at `HARNESS-899` cannot force allocation of an already-owned sentinel-floor ID.
- Dry-run and write mode agree on the same unclaimed candidate, and write mode refuses any collision
  even when the conflicting record has a different slug.
- Existing record, citation, and issue-title claim sources remain represented in allocation.
- `pnpm harness:test:contracts` passes with dedicated sentinel-boundary and different-slug fixtures.

## Test Plan

- Extend `scripts/harness/__tests__/allocate-work-item-id.test.mjs` with discriminating real-record
  and fixture-boundary cases.
- Extend or reuse `scripts/harness/__tests__/scan-work-item-id-collision.test.mjs` to prove a
  different-slug duplicate is still refused.
- Run the allocator in dry-run and write modes inside isolated fixture repositories.
- Run `pnpm harness:test:contracts` and the repository's CI-equivalent verification.

## User Execution Test Scenarios

Not applicable. This Task changes internal repository governance and exposes no CLI, TUI, browser,
or public SDK behavior. Its observable proof belongs to allocator fixtures and the enforcing scans.
