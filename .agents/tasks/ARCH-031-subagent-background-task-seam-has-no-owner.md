---
title: 'ARCH-031: the subagent↔background-task request/result seam has no owner — one field family is declared three times and carried by hand-written literals, so every new field is dropped at the hops nobody remembered'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-executor, packages/agent-framework, packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1747
---

# ARCH-031: derive the subagent seam instead of copying it

## Problem

One field family — what a subagent job IS — is declared **three times as independent shapes**:

- `IAgentBackgroundTaskRequest` / `IBackgroundTaskResult` (`agent-interface-transport`, the contract owner);
- `ISubagentSpawnRequest` / `ISubagentJobResult` (`agent-executor`);
- `ISpawnAgentTaskRequest` (`agent-framework/src/background-tasks/execution-workspace-spawner.ts:21-41`).

Roughly six true cross-family projections carry values between them, each a hand-written object literal
over a ~20-key family, **none compiler-checked for totality** — all in
`agent-executor/src/subagents/subagent-manager.ts`: `toBackgroundRequest`, `toSubagentStartRequest`,
`toBackgroundResult`, `toSubagentState`, `wait()`, and the handle literal in
`createSubagentBackgroundRunner`. (Named by symbol, not by line: the first draft cited line numbers that
ARCH-025's own three-line change to `wait()` immediately shifted by nine.)

So a field added to either side must be hand-copied at every hop, and a miss **compiles clean as a silent
no-op**. There is no error, no log, and nothing that tells a caller their field did nothing.

## Why this is foundational — the repeat is measured, three deep

- **TYPE-003** (done 2026-07-25) named this exact cause at
  `agent-interface-transport/src/subagent-contracts.ts:47-50` — _"every field a subagent job shares with
  the background-task SSOT is derived via `Pick` (previously a ~20-field manual mirror that could drift
  silently)"_ — and derived **only the state hop**. That hop is the one hop that has not lost a field since.
- **CORE-025** then repaired a dropped field at two of the remaining mappers and left the evidence in the
  file: `// CORE-025: carry the permission policy through to the runner (previously dropped here → dead
field)`, in `toSubagentStartRequest`.
- **ANALYTICS-001 Phase 2** (`34587800e`) added `usage` to `toBackgroundResult` and missed `wait()`
  **in the same one-line commit**. The field ARCH-025 reports was born dropped by the commit that created it.
- **ARCH-025** is the fourth repair of this class. Its own recommendation gate returned `REJECT` on the
  ground that solving this cause in place is the third option `finding-depth.md` forbids.

## Direction

**Derive the shapes so a drop is unrepresentable**, rather than classifying keys so an unclassified key is a
compile error. Classification is strictly weaker: a key can be classified and still be a silent no-op.
`ISubagentJobState` already proves the treatment works in this very seam.

- Move `ISubagentSpawnRequest` / `ISubagentJobResult` beside `ISubagentJobState` in
  `agent-interface-transport`, and derive them from `IAgentBackgroundTaskRequest` / `IBackgroundTaskResult`
  the way `ISubagentJobState` is derived from `IBackgroundTaskState`. Correct
  `subagent-contracts.ts:1-7`, which currently says spawn requests and results stay in `agent-executor`;
  they are pure data, and the interface-package rule permits the move. `agent-executor` keeps owning the
  SPI (`ISubagentRunner`, `ISubagentManager`).
- Collapse `ISpawnAgentTaskRequest` into the same derivation.
- Extend `agent-interface-transport/src/__tests__/type-ssot-parity.test.ts` — today's only mechanical parity
  check, and state-hop only — to the request and result hops.
- Keep a `satisfies`-checked disposition map **only for the residual non-derivable keys**, and reconcile its
  vocabulary with the already-shipped `TCompositionFieldPolicy`
  (`agent-capability-pack/src/capability-pack-types.ts:47-48`, ARCH-027) rather than inventing a third
  spelling. **Answer deliberately who owns "exhaustive public-key classification" as a concept** —
  `agent-capability-pack` is an odd owner for a domain-free idea, and `agent-executor` cannot depend on it.
- Residual keys and their dispositions: `status: 'paused' → 'sleeping'` (derived narrowing);
  `providerProfile` explicitly-rejected pending ARCH-021; `worktreePath` / `branchName` **runner-produced,
  never caller-supplied** — see the correction below; `parentTaskId` needs a key on both sides and lands here.

## A correction this item exists to prevent being repeated

ARCH-025's rejected recommendation claimed `worktreePath` / `branchName` were caller fields dropped by
`toBackgroundRequest`, and proposed removing
`agent-executor/src/subagents/worktree-subagent-runner.ts:117-122` as a "downstream re-injection workaround".
**That is inverted.** The worktree does not exist at spawn time — `ISubagentWorktreeAdapter.prepare()`
creates it inside `WorktreeSubagentRunner.start()` — and no producer of an `ISubagentSpawnRequest` anywhere
in the repo sets either field. Lines 117-122 are the **only** assignment of them; removing them would sever
the worktree identity from the request the worker sees and kill `subagentExecutionRoot`'s
"the worktree wins when present" branch (`execution-root.ts:20`), which guards a measured containment
breach. The invariant is **runner-produced, not caller-supplied**, and it must be recorded as such rather
than rediscovered by the next reader.

## Test Plan

- Red-first: a field added to a derived source shape fails to compile until every hop carries it.
- `type-ssot-parity.test.ts` extended to the request and result hops.
- `parentTaskId` flows end to end from `execution-workspace-spawner.ts:104` to the runner.
- `pnpm typecheck`, `pnpm build`, `pnpm harness:scan`, `pnpm harness:verify-like-ci`.
- Changesets for every changed public package (all are in one `fixed` group).

## User Execution Test Scenarios

To be authored before implementation. The only behaviour change is `parentTaskId` beginning to flow; the
rest is type derivation with no runtime effect, so the scenario must target the parent-link observable
rather than inventing one for a pure refactor.

## Plan

- [x] Owner decision on scope — **approved 2026-08-16.** This item spans four packages by construction, and
      that span is the reason it is filed rather than folded into ARCH-025; the owner authorized it
      explicitly when deciding to land ARCH-025's narrowed scope first.
- [ ] Move and derive the two data contracts; correct the `subagent-contracts.ts` placement note.
- [ ] Collapse `ISpawnAgentTaskRequest` into the derivation.
- [ ] Extend the parity fixture to the request and result hops.
- [ ] Settle the classification-vocabulary ownership question and apply it to the residual keys.

## Blockers

- **None.** The four-package span was authorized by the owner on 2026-08-16, together with the decision to
  land ARCH-025's narrowed scope first. `finding-depth.md` routes a FOUNDATIONAL cause to a filed root item
  and an owner decision; this file is that root item and the decision is recorded here, in
  `.agents/tasks/AGREEMENT-002-…` (TC-13), and in ARCH-025's `## Result`.

  _Recorded because it is the point:_ this file sat for several commits saying it needed an authorization it
  already had, while three later-written records said the opposite. That is the exact failure mode
  [`../memory/claims-not-rederived-after-facts-moved.md`](../memory/claims-not-rederived-after-facts-moved.md)
  names — a claim true when written and not re-derived once the fact under it moved — committed in the same
  change that added the memory entry, and caught by review rather than by me.

## Result

Pending.
