---
status: approved
type: INFRA
tags: [backlog-zero-migration]
lane: L2
---

# DOCS-050: Terminalize duplicate harness backlog records

Paired with `.agents/tasks/DOCS-050-terminalize-harness-115-and-125.md`.

## Problem

HARNESS-115 remains a root todo record although its residual scope is explicitly split into canonical
issue #2322. HARNESS-125's still-open producer/skeleton half is owned by canonical issue #2308.
Leaving both local records actionable duplicates GitHub ownership.

## Decision

Archive both records as `skipped` with exact issue-comment handoffs. Do not claim either harness
improvement complete; recreate fresh Tasks from the canonical issues when implementation begins.

## Approval and scope

This is document-only `BACKLOG-ZERO-MIGRATION` work under DOCS-029. No source, API, policy, CI, or
runtime changes are included.

## Completion Criteria

- [x] HARNESS-115 and HARNESS-125 carry skipped metadata and exact handoff URLs.
- [x] Canonical issues record returned ownership.
- [x] Archive placement and document-only scope are verified.

## Test Plan

Inspect archived records and issue comments; run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` from the integration branch. Confirm no implementation path changed.

## User Execution Test Scenarios

Not applicable — internal backlog lifecycle only.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Tasks

- [x] Archive HARNESS-115 to issue #2322.
- [x] Archive HARNESS-125 to issue #2308.

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** `CLASS`

**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
