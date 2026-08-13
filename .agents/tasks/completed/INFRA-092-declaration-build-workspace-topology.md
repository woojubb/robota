---
title: 'INFRA-092: Declaration Build Must Follow the Complete Workspace Type Graph'
status: done
created: 2026-08-13
completed: 2026-08-13
priority: high
urgency: now
area: scripts/build-types-ordered.mjs, scripts/harness, verification pipeline
depends_on: []
---

# INFRA-092 Declaration Build Workspace Topology

- **Branch**: `fix/infra-092-declaration-build-topology`
- **Spec**: `.agents/spec-docs/done/INFRA-092-declaration-build-workspace-topology.md`

## Objective

Make root declaration builds follow the complete, deterministic local workspace dependency graph so
cold builds do not depend on stale declaration artifacts or retry order.

## Plan

- [x] TC-01: Model and deduplicate all four workspace dependency fields.
- [x] TC-02: Ignore irrelevant nodes and fail closed with deterministic cycle details.
- [x] TC-03: Cover all 75 live declaration packages and keep `agent-cli` after its local inputs.
- [x] TC-04: Pass a clean root `pnpm build` without a preparatory retry.
- [x] TC-05: Synchronize the verification pipeline owner document.

## Test Plan

Use TDD: first add fixtures that fail against the dependency-only, enumeration-order-sensitive graph;
then expose the root-private pure seam and make the smallest graph correction. Verify focused harness
tests, the live topology, the root build, harness scans, and the final CI-equivalent gate.

## User Execution Test Scenarios

**Applicability:** not-applicable

This changes repository-internal declaration-build scheduling only. Build and harness outputs are
engineering verification, not a shipped product surface.

## Progress

### 2026-08-13

- GATE-WRITE and owner approval passed before implementation.
- Independent depth review classified the problem as `DEPTH: LOCAL` (root-cause scoped).
- First proposal review returned REVISE: correct the live count to 75, include
  `optionalDependencies`, preserve serial tier execution honestly, and add deterministic ordering.
- The corrected recommendation received independent `REVIEW VERDICT: ENDORSE`; the owner's stated
  conditional automatic-approval criterion is satisfied for this final scope.
- RED: importing the old script from the new test immediately launched the live build and exposed
  both the absent main guard and dependency-only Tier 1 ordering.
- GREEN: five focused Vitest cases passed for four-field deduplication, irrelevant nodes,
  deterministic cycles and input permutations, nested discovery, all 75 live packages, and
  `agent-cli` Tier 9.
- A single root `pnpm build` passed without preparatory package builds or retry; declaration output
  showed nine tiers and `agent-cli` alone in Tier 9.
- The final CI-equivalent gate passed all 11 stages in 7m58.6s. It included the complete harness
  suite, build, typecheck, 86-scope affected verification, binary E2E, examples, and TUI PTY tests.
- User Execution PLAN independently returned `NOT-APPLICABLE`: this work has no shipped product
  surface and engineering verification is not user-execution evidence.

## Decisions

- Keep the existing root graph owner and tier-by-tier execution; do not mix true process parallelism
  into this correctness fix.
- Define completeness as the sorted, deduplicated union of all four npm dependency fields for local
  packages that own `build:types`.

## Blockers

- None.

## Result

Implementation, engineering verification, independent local review convergence, and the completion
gate are complete. The task and spec were archived atomically in the closing commit.
