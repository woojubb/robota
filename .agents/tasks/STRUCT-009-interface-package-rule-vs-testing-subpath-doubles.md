---
title: 'STRUCT-009: two mandatory rules give incompatible instructions for test doubles owned by interface packages — amend the Interface Package Rule with the /testing carve-out it already de-facto has'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: .agents/project-structure.md, .agents/rules/code-quality.md, packages/agent-interface-transport, scripts/harness/scan-interface-runtime.mjs
depends_on: []
---

# STRUCT-009: Interface Package Rule vs `/testing` runtime doubles

## Problem

Two mandatory documents contradict each other about where a contract owner's test double may live,
and the shipped code follows one while the other still reads as absolute. This is a rule-level
contradiction (the class HARNESS-072 wants detected), and per the rules index an amendment requires a
filed item — this is that item.

## Location correction (ARCH-108, 2026-08-23)

**The contradiction stands; only its address moved.** This record cites the double at
`packages/agent-interface-transport/src/testing/index.ts` and the constraint at
`packages/agent-interface-transport/docs/SPEC.md:356-359`. ARCH-108 (issue #2113) moved
`createTestInteractiveSession` to `packages/agent-interface-session/src/testing/`, because
`agent-interface-session` declares the contract it doubles, and rewrote that SPEC — the cited line
range no longer exists in it.

Read the citations below against `agent-interface-session` instead. Nothing about Side A / Side B
changes: an `agent-interface-*` package still hosts a behavioural factory under `/testing` while the
Interface Package Rule still says those packages hold no runtime logic. The move made the
contradiction cleaner, not smaller — the double now sits in the package whose SPEC states the
constraint most directly.

The `area:` field is left as written rather than silently corrected; whoever takes this item should
re-measure it, per the footprint lesson recorded in ARCH-108.

## Evidence

- Side A — `.agents/project-structure.md:294` — "`agent-interface-*` packages contain **only type
  contracts and interfaces — no implementation**"; `:303` — "must not contain classes or runtime
  logic". The only stated relaxation (`:24`) is "pure, dependency-free derivation accessors".
  `packages/agent-interface-transport/docs/SPEC.md:356-359` repeats the constraint ("no
  stateful/side-effecting runtime logic").
- Side B — `.agents/rules/code-quality.md:30-36` mandates the opposite placement: "A genuine
  test-support double … belongs under a `testing/` subpath" of the contract owner. ARCH-012's
  reviewed resolution put the conformant `IInteractiveSession` double exactly there:
  `packages/agent-interface-transport/src/testing/index.ts` — a ~90-line behavioral factory with
  module-level mutable state (`let doublesCreated = 0`, :62,:67) and wall-clock reads (:16,:24,
  :35-36,:165), shipped via the manifest's `./testing` export.
- The mechanical guard cannot arbitrate: `scripts/harness/scan-interface-runtime.mjs:167-184` scans
  `src/testing/` but its floor (class/enum declarations + bare value imports) cannot see
  function-bodied runtime logic, so the conflict passes silently.
- Same root, second instance: the root entry also ships the `isTurnNotRunError` predicate and the
  `OWNER_DRIVER_ID`/`AGENT_DRIVER_ID` value constants — sanctioned in practice, unadmitted by the
  rule text.

## Direction

Amend the Interface Package Rule (constitutional amendment, via this filed item) to state the
carve-outs the ecosystem already relies on:

1. `./testing` subpath MAY ship a conformant test double for contracts the package owns —
   dependency-free, no I/O; prefer injectable clock/counters so the surviving rule text stays honest
   (make `createTestInteractiveSession`'s counter/clock injectable as part of this).
2. The root entry MAY ship pure predicates/constants over owned types (the existing accessor
   carve-out, stated to include predicates and identity constants).
3. Record in the rule that `scan-interface-runtime.mjs` enforces the floor (no classes/enums/bare
   value imports) and what it deliberately does not see, so the rule and the guard agree.

Mirror the amendment into `packages/agent-interface-transport/docs/SPEC.md` § Constraints.

## Test Plan

- Rule text updated in `.agents/project-structure.md` + SPEC; `rg` shows the two documents no longer
  contradict (`code-quality.md` placement rule cited from the Interface Package Rule).
- If the injectable-clock option is taken: `createTestInteractiveSession` unit test pinning
  deterministic ids without wall-clock.
- `pnpm harness:scan` green (interface-runtime scan unchanged or extended intentionally).

## User Execution Test Scenarios

Not applicable — rule/documentation amendment (plus an optional test-only refactor); no runnable
user-facing behavior changes.
