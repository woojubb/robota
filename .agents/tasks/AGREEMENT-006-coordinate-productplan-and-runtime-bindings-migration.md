---
title: 'AGREEMENT-006: coordinate ProductPlan and runtime-bindings migration'
issue: https://github.com/woojubb/robota/issues/2070
status: in-progress
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-product and product-composition consumers
depends_on: []
children: [DATA-008, DATA-009, ARCH-116]
---

# AGREEMENT-006: coordinate ProductPlan and runtime-bindings migration

## Objective

Replace issue #2070's GitHub-only execution tree with one governed relationship owner while preserving
the external problem under canonical issue #2079. The three executable causes remain independently
verifiable Tasks; this conversion does not choose the runtime-realization package, amend architecture
policy, implement product code, or claim any outcome is delivered.

## Children

- [ ] DATA-008 — todo — `.agents/tasks/DATA-008-define-secret-free-structured-cloneable-productplan.md`
- [ ] DATA-009 — todo — `.agents/tasks/DATA-009-encode-product-source-modes-as-discriminated-data.md`
- [ ] ARCH-116 — todo — `.agents/tasks/ARCH-116-place-product-realization-and-migrate-consumers.md`

## Plan

- [x] TC-01 — Freeze the exact candidate set `{#2070,#2085,#2104,#2118}` with all four rows still
      `OWNER_REVIEW`, exact Task paths, and no GitHub mutation authority.
- [x] TC-02 — Land this AGREEMENT, its paired spec, and DATA-008/DATA-009/ARCH-116 on `develop` in the
      native dependency order `DATA-008 → DATA-009 → ARCH-116`.
- [x] TC-03 — Preserve open issue #2044 and open issue #2443 as live external prerequisites rather than
      treating completed ARCH-109/CLI-078 or closed issue #2048 as delivery.
- [x] TC-04 — Require ARCH-116's own recommendation/spec gate to decide runtime-realization placement and
      obtain any required package/policy/public-contract approval before implementation.
- [x] TC-05 — After fresh post-merge review, apply and immediately read back only the four approved Issue,
      body, marker, label, dependency, and terminal-state mutations.
- [ ] TC-06 — Complete this AGREEMENT only after all three children are `done` and issue #2079's current
      execution map points to their exact completed Task paths through resolvable full-SHA links.

## Verification

- B2 authorization: commit `1f716784f240b4693687458c2798f903d2ba359d`; exact frozen rows
  `#2070/#2085/#2104/#2118`; independent pre-write findings 0.
- Live apply: exact `woojubb` Task markers read back before P-label removal, then four
  `CLOSED/NOT_PLANNED` transitions in reverse dependency order.
- Post-write: independent findings 0 at `2026-09-02T15:05:19.715Z`; full audit changed 277/73 to 273/69
  open Issues/open native children with [issue #2044](https://github.com/woojubb/robota/issues/2044) and
  [issue #2443](https://github.com/woojubb/robota/issues/2443) preserved as live prerequisites and
  [issue #2048](https://github.com/woojubb/robota/issues/2048) as history.

## Shared Constraints

- `ProductPlan` is secret-free structured-cloneable data made of stable values and references. It does not
  carry provider definitions, resolved credentials, functions, class instances, live packs, registries,
  runners, transports, or factories.
- DATA-009 owns exhaustive source-mode vocabulary and decoding/type tests only. Factory execution and
  consumer migration remain outside that Task.
- This migration does not approve an effectful `realizeProduct` inside `agent-product`, change the
  pure-assembler carve-out, or introduce a new shared package. ARCH-116 must independently review the
  closest serializable-reference/live-binding analog, product-family placement, and reuse level.
- No compatibility facade keeps the mixed prerelease `IProductProfile`/`IAssembledProduct` surface public.

## External Prerequisites and Ownership

- [Issue #2044](https://github.com/woojubb/robota/issues/2044) remains the live owner of the child-worker
  provider-recipe boundary. ARCH-116 may not start implementation or complete until that Issue reaches a
  truthful terminal disposition or its responsible
  owner records an exact replacement mapping that preserves the unresolved dependency.
- [Issue #2443](https://github.com/woojubb/robota/issues/2443) remains the live owner of eval and
  pre-assembly runner-collaborator composition. Before
  ARCH-116 implementation, that owner must be converted/coordinated or its seam must be explicitly excluded
  from ARCH-116 with no contradictory completion claim.
- Closed [issue #2048](https://github.com/woojubb/robota/issues/2048) and completed ARCH-109/CLI-078 are
  historical evidence only.

## Test Plan

- Validate the AGREEMENT child projections and exact Task/spec paths with task lifecycle and placement scans.
- Read linked issues 2070, 2085, 2104, and 2118 plus native parent/blocking relations immediately before
  every mutation gate.
- Read [issue #2044](https://github.com/woojubb/robota/issues/2044) and
  [issue #2443](https://github.com/woojubb/robota/issues/2443) live state before ARCH-116's recommendation
  gate and before its done gate.
- Run `node scripts/harness/scan-user-execution-plan-order.mjs --staged` on the atomic conversion prelude.
- Run affected harness scans and full required verification before each repository evidence PR merges.

## User Execution Test Scenarios

Not applicable to this migration-only AGREEMENT record. Each child Task owns the runnable SDK or CLI
scenario for the behavior it eventually changes; this parent verifies only ownership, sequencing, and
terminal evidence.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This record changes Task/spec governance and GitHub Issue administration only. It introduces
no runnable Robota product behavior, public API, command output, TUI/browser flow, or end-user interface.
