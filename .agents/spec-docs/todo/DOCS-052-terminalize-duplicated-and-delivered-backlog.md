---
status: approved
type: INFRA
tags: [backlog-zero-migration]
lane: L1
---

# DOCS-052: terminalize duplicated and delivered backlog records

Paired with `.agents/tasks/DOCS-052-terminalize-duplicated-and-delivered-backlog.md`.

## Problem

TOOL-007 and MEM-001 duplicate canonical open GitHub issues, while HARNESS-123 was delivered by a
merged pull request but remains an actionable root `todo` record. Keeping these records actionable
allows duplicate work and leaves stale backlog state.

## Decision

Archive TOOL-007 with a handoff to issue #1999, archive MEM-001 with a handoff to issue #2055, and
archive HARNESS-123 as done with exact PR #2363 merge evidence. Do not close the broader canonical
issues as part of this document-only batch.

## Approval and scope

This is document-only `BACKLOG-ZERO-MIGRATION` work under DOCS-029. No source, API, policy, CI, or
runtime changes are included.

## Completion Criteria

- [ ] TC-01: all three records are terminal, with exact issue or merge evidence and no root todo copy.

## Test Plan

Inspect issues #1999 and #2055, PR #2363, and archived metadata; run repository scans and CI-like
document verification. Confirm no package or runtime path changes.

## User Execution Test Scenarios

Reason: not applicable because this batch only archives backlog documents and records existing delivery or
issue ownership; it changes no user-facing execution surface.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Tasks

- [ ] `.agents/tasks/DOCS-052-terminalize-duplicated-and-delivered-backlog.md`
- [ ] TC-01: archive the three stale records with their evidence.

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Given:** 2026-08-29, this conversation
**Evidence condition met:** all records are being reconciled against current GitHub issue/PR state.
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
