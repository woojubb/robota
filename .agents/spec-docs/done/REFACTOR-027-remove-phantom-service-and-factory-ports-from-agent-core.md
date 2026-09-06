---
status: done
type: BEHAVIOR
tags: [typescript]
lane: L1
---

# REFACTOR-027: Remove phantom service/factory ports from agent-core

Paired with `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`. Arising from [issue #2064](https://github.com/woojubb/robota/issues/2064).

## Problem

`packages/agent-core` root-exports three public interfaces — `IToolExecutionService`,
`IExecutionService` (`packages/agent-core/src/interfaces/service.ts`), and `IAgentFactory`
(`packages/agent-core/src/interfaces/manager.ts`) — that have zero production implementors and zero
consumers anywhere in the workspace (`grep -rn` across `packages/` and `apps/` for each name returns
only their own declaration/export). The concrete classes with similar names (`ExecutionService`,
`ToolExecutionService`, `AgentFactory`) do not `implements` these interfaces and have incompatible
method signatures. `grep -rn IExecutionService packages apps` (excluding
`packages/agent-core/src/interfaces/*`) returns no matches, reproducing the phantom-port condition.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `packages/agent-core`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Delete the three phantom interfaces outright (all published versions are
prerelease, so no compatibility alias is owed), and delete the support types that become orphaned
as a direct consequence (`IExecutionServiceOptions`, `TExecutionMetadata`, `IAgentCreationOptions`,
`IConfigValidationResult`, `TAgentCreationMetadata`) rather than leaving new dead exports behind.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Delete the three phantom interfaces and every support type/import/export that becomes orphaned as a
direct result, in `packages/agent-core/src/interfaces/{service,manager,index}.ts`, without adding a
compatibility alias. This is a pure type-level deletion with no runtime code path — there is no
consumer whose behavior to preserve, so the applicable evidence is that (a) the package still
builds/typechecks, (b) the existing test suite (which by construction never exercised these unused
interfaces) still passes unchanged, and (c) the public-surface baseline mechanically confirms the
export count dropped by exactly the 8 removed symbols.

## Affected Files

- `packages/agent-core/src/interfaces/service.ts`
- `packages/agent-core/src/interfaces/manager.ts`
- `packages/agent-core/src/interfaces/index.ts`
- `scripts/harness/spec-surface-baseline.json`

## Completion Criteria

- [x] TC-01: `pnpm --filter @robota-sdk/agent-core typecheck` → exits 0
- [x] TC-02: `pnpm --filter @robota-sdk/agent-core build` → exits 0
- [x] TC-03: `pnpm --filter @robota-sdk/agent-core test` → exits 0 (all pre-existing tests pass
      unchanged; none reference the removed interfaces, confirmed by
      `grep -rn "IToolExecutionService\|IExecutionService\|IAgentFactory" packages apps` returning
      only the removed declaration sites before this change)
- [x] TC-04: `node scripts/harness/check-spec-public-surface.mjs` → exits 0, and
      `scripts/harness/spec-surface-baseline.json`'s `@robota-sdk/agent-core` `type` count drops from
      229 to 221 (the 8 removed symbols)

## Test Plan

| TC-ID | Test Type | Tool / Approach                                      | Notes                                                                                                                    |
| ----- | --------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | manual    | `pnpm --filter @robota-sdk/agent-core typecheck`     | Skipped: no dedicated test file — no consumer imports the removed types, so the compiler itself is the check           |
| TC-02 | manual    | `pnpm --filter @robota-sdk/agent-core build`          | Skipped: no dedicated test file — tsdown build for node+browser targets is the check                                    |
| TC-03 | manual    | `pnpm --filter @robota-sdk/agent-core test`           | Skipped: no automated test can RED/GREEN a symptom with zero runtime consumers — proven instead by TC-01 plus the unchanged 1305-test suite passing |
| TC-04 | manual    | `node scripts/harness/check-spec-public-surface.mjs` | Skipped: no dedicated test file — mechanical export-count ratchet confirms the removal                                  |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-04).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` — done

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <5 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 5 changed path(s) — committed and working-tree changes vs origin/develop (merge base aff91a876cd7) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md) is at or above the floor L1)
**Review fingerprint:** c0536c611d30 (review 89776977, type/tags ae40bc03)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c0536c611d30) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `aff91a876cd7` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/draft/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `ca13e4bf2e35` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: BEHAVIOR` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 746 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows = 4 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 4 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c0536c611d30) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `aff91a876cd7` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/draft/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `da1941add9a5` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm --filter @robota-sdk/agent-core typecheck`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
> @robota-sdk/agent-core@3.0.0-beta.79 typecheck /private/tmp/robota-worktrees/refactor-027-v2/packages/agent-core
> tsgo -p tsconfig.json --noEmit && tsgo -p tsconfig.examples.json --noEmit
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `60880c017356` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/todo/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `2b35803b4b72` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Command:** `pnpm --filter @robota-sdk/agent-core build`
**Exit:** 0
**Output:** (last 10 of 76 line(s))

```
ℹ [ESM] 12 files, total: 1.38 MB
src/hooks/executors/command-executor.ts (17:22) [33m[UNRESOLVED_IMPORT] [0mCould not resolve 'node:child_process' in src/hooks/executors/command-executor.ts
    [38;5;246m╭[0m[38;5;246m─[0m[38;5;246m[[0m src/hooks/executors/command-executor.ts:17:23 [38;5;246m][0m
    [38;5;246m│[0m
 [38;5;246m17 │[0m [38;5;249mi[0m[38;5;249mm[0m[38;5;249mp[0m[38;5;249mo[0m[38;5;249mr[0m[38;5;249mt[0m[38;5;249m [0m[38;5;249m{[0m[38;5;249m [0m[38;5;249ms[0m[38;5;249mp[0m[38;5;249ma[0m[38;5;249mw[0m[38;5;249mn[0m[38;5;249m [0m[38;5;249m}[0m[38;5;249m [0m[38;5;249mf[0m[38;5;249mr[0m[38;5;249mo[0m[38;5;249mm[0m[38;5;249m [0m'node:child_process'[38;5;249m;[0m
 [38;5;240m   │[0m                       ──────────┬─────────  
 [38;5;240m   │[0m                                 ╰─────────── Module not found, treating it as an external dependency
[38;5;246m────╯[0m

✔ Build complete in 1144ms
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `60880c017356` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/todo/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `a65c57e6fcdf` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Command:** `pnpm --filter @robota-sdk/agent-core test`
**Exit:** 0
**Output:** (last 10 of 117 line(s))

```
 ✓ src/hooks/__tests__/types.test.ts (3 tests) 2ms
 ✓ src/context/model-pricing.test.ts (8 tests) 2ms
 ✓ src/utils/bounded-output.test.ts (4 tests) 58ms
 ✓ src/utils/path-containment.test.ts (2 tests) 3ms
 ✓ src/services/__tests__/execution-usage.test.ts (2 tests) 1ms

 Test Files  102 passed (102)
      Tests  1305 passed (1305)
   Start at  21:17:26
   Duration  4.15s (transform 724ms, setup 0ms, collect 2.48s, tests 3.52s, environment 7ms, prepare 3.00s)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `60880c017356` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/todo/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `37092caed1af` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/check-spec-public-surface.mjs`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
spec public-surface scan passed.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `60880c017356` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/todo/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `0eb93fa24a9a` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → done

**Ordering check:** prior gate `GATE-PLAN`, re-run rule `recorded-pass` (gate-catalogue.md § Prior-gate
map). The `[GATE-PLAN] — ✅ PASS | 2026-09-06` entry above carries `**Status upgrade:** draft →
approved`; the document's current frontmatter `status: approved` equals that entry's `Y`. Ordering
satisfied.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` is marked complete (`[x]`): read the Task file's committed content — the file is tracked and has no working-tree modification (`git status` shows no entry for it; it is part of commit `60880c0173`). Its `## Plan` section holds exactly 4 items, all `- [x]`: "Inventory every exported service/factory port …", "Delete phantom declarations …", "Update package public-surface evidence …", "Run typecheck, package tests, build, and public-surface scans." No `- [ ]` item present. PASS.
- GATE-VERIFY — No Plan item is blocked or pending: `grep -ni "blocked\|pending\|\[ \]" .agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` returned no match (exit 1) — none of the 4 items carries a blocked/pending marker or an unchecked box. PASS.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): satisfied by the `[GATE-COMPLETE: TC-02]` entry above — `pnpm --filter @robota-sdk/agent-core build` exit 0. The spec's Architecture Review § Affected Scope names only `packages/agent-core`, so this is the whole affected set. PASS.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): satisfied by the `[GATE-COMPLETE: TC-03]` entry above — `pnpm --filter @robota-sdk/agent-core test` exit 0, 1305/1305 tests passed. PASS.
- GATE-COMPLETE — Each TC-N checkbox is `[x]` with a matching Evidence Log entry: `[GATE-COMPLETE: TC-01]` through `[GATE-COMPLETE: TC-04]` above each carry command, exit code and output; `git diff` on this file confirms all four `## Completion Criteria` boxes flipped `[ ]` → `[x]` in the same working-tree change that added the four entries. PASS.
- GATE-COMPLETE — Every `## Test Plan` row carries a test-written or test-skipped record, none silently unaddressed: all 4 rows are `manual` with a non-empty Notes column stating the specific skip reason (compiler/build/public-surface scan is itself the check; no RED/GREEN test possible for a zero-consumer deletion). PASS.
- GATE-COMPLETE — `## Tasks` section names the exact active task path: `## Tasks` lists `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md`, matching the paired Task's actual path. PASS.
- GATE-COMPLETE — Active task exists and is completion-ready (all tasks `[x]`, none pending/blocked): same Task file, same finding as the two GATE-VERIFY Plan checks above — 4/4 `[x]`, none blocked/pending. PASS.

**Judged by:** `backlog-gate-guard` — semantic escalation of the 2 GATE-VERIFY criteria `gate.mjs` could
not resolve mechanically (task-plan-items scan indeterminate); remaining criteria corroborated directly
against `git diff`, `git log`, and the Task file's committed content rather than re-asserted from the
prior mechanical entries.
**Judged at:** HEAD `60880c0173561c9a57eeb2a11c7ec25f9b5795dd` · base `origin/develop@aff91a876cd74f82616d0d1708cd53480a7dfc63` · document `.agents/spec-docs/todo/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `eb72e1fda5ac7e1a3f315d62477fda3745b470e1` (modified) · Task `.agents/tasks/REFACTOR-027-remove-phantom-service-and-factory-ports-from-agent-core.md` blob `adfc5275c65364ed863238e20d658b5802ba8912` (tracked)
