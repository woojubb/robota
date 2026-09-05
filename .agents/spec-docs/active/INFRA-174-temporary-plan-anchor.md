---
title: 'INFRA-174: Temporary plan anchor'
status: in-progress
lane: L2
created: 2026-09-06
priority: low
urgency: soon
type: INFRA
tags: [governance, temporary]
---

# INFRA-174: Temporary plan anchor

## Problem

A planning boundary is needed for a repository-governance change.

## Prior Art Research

The repository harness rules define the planning and implementation checkpoint contract.

## Architecture Review

### Decision

Use a single planning boundary for the repository-governance change.

**Delivery mode:** `single`

## Completion Criteria

- [ ] TC-01: Keep the repository governance change aligned with its documented policy.
- [ ] TC-02: Confirm the final repository scan can evaluate the resulting tree.

## Tasks

`.agents/tasks/INFRA-174-temporary-plan-anchor.md`

## Test Plan

The repository governance change will be checked by the existing static harness contracts and the final repository scan.

## Evidence Log

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: the paired temporary Task exists.
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria: the Task records TC-01 and TC-02.
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `SCENARIO DRAFTED: not-applicable | 0`.
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired spec/Task inventory.

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-174-temporary-plan-anchor.md",
  "specPath": ".agents/spec-docs/todo/INFRA-174-temporary-plan-anchor.md",
  "taskItems": [
    { "kind": "tc-id", "value": "TC-01" },
    { "kind": "tc-id", "value": "TC-02" }
  ],
  "plan": { "outcome": "not-applicable", "count": 0 },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-174-temporary-plan-anchor.md",
    ".agents/tasks/INFRA-174-temporary-plan-anchor.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
