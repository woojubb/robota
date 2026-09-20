---
title: 'RULE-2380: Dispose of the frozen legacy approval corpus'
issue: https://github.com/woojubb/robota/issues/2380
status: todo
created: 2026-09-20
priority: high
urgency: now
area: standing approval migration and frozen spec evidence
depends_on: [RULE-2326]
---

# RULE-2380: Dispose of the frozen legacy approval corpus

## Objective

Give each currently frozen approval record one explicit, auditable disposition without rewriting sealed
history or inventing missing user authority. The current measured baseline is 218 frozen records with no
route, so silence or a shrinking count is not completion.

## Plan

- [ ] TC-01 — Freeze the current corpus and classify every record by recoverable direct evidence, recoverable class evidence, relayed authority, or missing authority.
- [ ] TC-02 — Obtain and encode the owner policy needed for classes that cannot be decided mechanically.
- [ ] TC-03 — Apply only authorized metadata or terminal disposition while preserving every historical Evidence Log byte.
- [ ] TC-04 — Prove population conservation, idempotent replay, and zero unclassified frozen records.

## Test Plan

Use `scan-standing-delegation-evidence.mjs` as the population owner, a frozen manifest/read-back comparison,
and idempotent replay fixtures. Verify original blobs and evidence logs are unchanged except for the exact
authorized append-only disposition records.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a repository approval-record migration with no Robota product CLI, TUI, browser,
public SDK, or installed-package behavior an end user can execute.
