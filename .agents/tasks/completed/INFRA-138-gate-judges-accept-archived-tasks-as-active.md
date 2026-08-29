---
title: 'INFRA-138: Gate judges accept archived Tasks as active'
issue: https://github.com/woojubb/robota/issues/2467
status: superseded
completed: 2026-08-29
created: 2026-08-29
priority: high
urgency: now
area: harness gate task-path validation
depends_on: []
---

# INFRA-138: Gate judges accept archived Tasks as active

## Objective

Make GATE-IMPLEMENT and GATE-COMPLETE require the exact active root Task path they claim to judge,
so an archived terminal Task cannot satisfy an active-task criterion by existence alone.

## Observed Defect

DOCS-038's approved correction required reopening its paired Task under `.agents/tasks/` before a
fresh GATE-IMPLEMENT. Commit `673f55ac7` left the Task under `.agents/tasks/completed/`, but the gate
still recorded PASS and the later GATE-COMPLETE accepted the same archived path as its "exact active
task path". The common reader accepts nested Task paths and the active-path criteria reduce the
claim to file existence.

This is related to issue #2265, which concerns the task-archival scan losing sight of archived
records, but is not a duplicate: this defect is in gate judgement and has its own falsification test.

## Why Separate

Registered as GitHub issue #2467. DOCS-038 is an immutable documentation-only migration batch;
changing the gate reader, tests, catalogue, or policy inline would cross its approved source/policy
boundary. The batch can restore its own promised lifecycle sequence, but that does not prevent the
same false PASS in future work.

## Resolution

Superseded by `INFRA-139-gate-judges-reject-archived-tasks-as-active`, completed in PR #2474 and
merged to `develop` as `beab5d3b85c6e81ad7a4f6a00b9d0061918165a5`. The canonical gate now rejects
archived and nested Task paths, so this original implementation Task no longer remains actionable.

## Plan

- [ ] Convert issue #2467 through `issue-to-backlog` before implementation and form the governed
      recommendation.
- [ ] Add a regression fixture where a live spec points at `.agents/tasks/completed/<ID>.md` and prove
      both active-task gate criteria fail before the fix.
- [ ] Make the canonical gate reader distinguish the exact root active path from archived nested paths
      without weakening historical evidence parsing.
- [ ] Prove the completed-path fixture fails and the equivalent root-path fixture passes at both
      GATE-IMPLEMENT and GATE-COMPLETE; then run the CI-equivalent gate.

## Test Plan

Add focused gate-judge fixtures for completed-path rejection and root-path acceptance at both gates;
prove the completed-path regression case fails on the pre-fix reader and passes after the canonical
path validation is corrected; run the affected harness tests, full harness scan, and
`pnpm harness:verify-like-ci` before delivery.

## User Execution Test Scenarios

Not applicable. This is an internal harness gate-correctness defect and introduces no runnable product
behavior; its future verification belongs to the harness regression suite.
