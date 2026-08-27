---
title: 'DOCS-029: reconcile delivered architecture migration records'
status: done
created: 2026-08-28
completed: 2026-08-28
priority: high
urgency: now
area: Task/spec lifecycle records and harness baselines
depends_on: []
---

# DOCS-029: reconcile delivered architecture migration records

no-issue: This repository-local reconciliation was requested directly by the owner and corrects six
records whose external delivery issues are already closed. Creating another GitHub issue would add a
second tracker for completed work.

## Problem

`ARCH-103` through `ARCH-108` delivered their interface-family ownership migrations, but the six Task
records remain nonterminal. Their paired specs also remain `approved` despite never acquiring a valid
pre-implementation checkpoint. Copying either lifecycle onto the other would falsify one evidence
channel: the work is delivered, while the historical plans did not earn implementation status.

## Recommendation

Archive all six Tasks as `done` using their delivery dates. Move all six specs to `rejected/`, preserve
their evidence, and record the missing/retrospective gate history. Rekey existing baseline entries for
the moved paths without expanding either baseline.

Independent review: `REVIEW VERDICT: ENDORSE`; `ACTIONABLE FINDINGS: 0` on 2026-08-28.

## Plan

- [x] TC-01: archive `ARCH-103` through `ARCH-108` with truthful `done` status and delivery dates.
- [x] TC-02: reject all six invalid historical specs without synthesizing gate passes.
- [x] TC-03: record and re-run the interface-owner, conformance, typecheck, and affected-package test
      evidence proving all six outcomes remain delivered.
- [x] TC-04: update moved-record citations plus reference-kind and standing-delegation baseline keys
      without adding exemptions.
- [x] TC-05: run lifecycle scans, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` on the final
      assembled tree.

## Test Plan

- [x] `pnpm harness:conformance` — PASS, zero dependency-direction violations.
- [x] `node scripts/harness/scan-interface-family-owner.mjs` — PASS, 22 modules and four manifest
      edges checked.
- [x] `pnpm typecheck` — PASS across 109 workspace projects.
- [x] Affected interface-package Vitest suites — 15 files and 58 tests passed.
- [x] Task placement, archival, spec-folder, citation, reference-kind, and standing-delegation scans —
      all PASS; the standing-delegation set was rekeyed without growth and reference-kind had zero
      affected baseline entries.
- [x] `pnpm harness:scan` — PASS, 145 scans with two declared skips in the implementation run.
- [x] `pnpm harness:verify-like-ci` — PASS, all 13 stages on the clean committed tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Not applicable.** This work changes only repository-internal lifecycle records and baseline keys. It
changes no product command, UI flow, public SDK behavior, configuration contract, or runtime output.
The user-observable product is identical before and after, so engineering verification is recorded in
the Test Plan instead of inventing a product scenario.
