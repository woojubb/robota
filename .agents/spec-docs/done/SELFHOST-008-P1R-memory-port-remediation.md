---
status: done
type: DATA
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/selfhost-008-memory-agent-run.md
tags: [memory, dip-port, async, remediation, selfhost]
---

# SELFHOST-008 P1R: memory-port remediation — async surface + full command wiring + role segregation

## Problem

An owner-requested mid-point **architecture audit** of the merged SELFHOST-008 P1 memory port
([spec](../done/SELFHOST-008-durable-semantic-memory.md), PR #1218) found a sound foundation with two HIGH design
defects that must be corrected **before P2** builds the live capture path on the same port:

1. **The injected `IMemoryStore` port is only half-wired (split-brain).** The port's stated purpose is "so a surface can
   swap the whole store without editing the library" (`memory/types.ts`). But only startup-memory injection
   (`context-loader.ts`) and the dormant capture controller route through it. The **`/memory` command path**
   (`createCommandMemoryStores` in `command-api/memory/memory-command-api.ts`) constructs its OWN `ProjectMemoryStore`
   - `PendingMemoryStore` from `cwd`, **ignoring any injected store**. A surface that injects an alternate backend gets
     a split brain: startup/capture read the injected store, but `/memory list|add|approve|reject` read/write the default
     filesystem store. The port's contract is false as merged.
2. **The sync-only port contradicts the async precedents it mirrors and schedules the breaking change it claims to
   defer.** `IMemoryStore` methods are all synchronous (`memory/types.ts`), justified as "not prematurely
   Promise-ified." But the two ports it explicitly mirrors — `ISandboxClient` (`agent-tools/src/sandbox/types.ts`,
   `run/readFile/writeFile → Promise`) and `IRetrievalAdapter` (`agent-tools/src/retrieval/types.ts`, `retrieve →
Promise`) — are **async precisely so a remote/heavy backend fits behind them**. The deferred `ISemanticMemoryAdapter`
   (`index/query → Promise`) **cannot be injected behind a sync `IMemoryStore`** without either turning the whole port
   async later (a breaking change to every caller) or routing semantic recall around the port (the split-brain of #1
   again). So the async break is _scheduled_, not avoided, and the "deferred semantic seam" does not actually function.

Plus MEDIUM/LOW findings: a **god-interface** (one flat 9-method port over three change-reasons) that duplicates the
`ICommandProjectMemoryStore`/`ICommandPendingMemoryStore` contracts already in the same package; `recall()` fabricating
a throwaway `IAutomaticMemoryConfig` to reuse `MemoryRetrievalService`; and `FileSystemMemoryStore` holding two
`ProjectMemoryStore` instances for one `cwd` (the retrieval copy silently drops the injected clock). And two LOW
doc-drifts the conformance audit flagged in the merged P1 spec (normative text still names `ICreateSessionOptions.memoryStore`
the code did not use; the "thresholds surface-injectable" claim is overstated — the evaluator/threshold are hardcoded).

Correcting the port now — while there is a single fs adapter and few callers — is far cheaper than after P2 adds the
capture path as another caller. This slice does the correction; P2 then builds on the corrected port.

## Prior Art Research

Waived: internal-consistency remediation aligning to the repo's OWN already-approved capability-port precedents
(identified by the owner-requested architecture audit) — not a new external capability, so an external product sweep is
not load-bearing. The authoritative "prior art" here is in-repo:

- **Async capability ports are the established repo convention for I/O-bound backends.** `ISandboxClient`
  (`packages/agent-tools/src/sandbox/types.ts:106-118`) returns `Promise` on `run`/`readFile`/`writeFile` so a remote
  E2B sandbox fits behind it; `IRetrievalAdapter` (`packages/agent-tools/src/retrieval/types.ts:85-87`) returns
  `Promise` on `retrieve` so an index/vector backend fits. The memory port claims to mirror these and must match their
  async shape to host its own deferred heavy backend (`ISemanticMemoryAdapter`, already `Promise`-typed).
- **Interface segregation is the repo's DIP idiom** — the same package already models the memory stores as two role
  interfaces (`ICommandProjectMemoryStore` / `ICommandPendingMemoryStore`, `command-api/memory/memory-command-api.ts`);
  the remediation collapses to ONE owned set rather than two competing decompositions.
- General principle (universal): I/O-capability abstractions expose async surfaces (a sync one leaks the
  in-memory/fs-only assumption into every caller). The fs reference adapter wrapping sync `fs` calls in already-resolved
  Promises is the standard zero-cost bridge. No external product research is load-bearing for this internal alignment.

## Architecture Review

### Affected Scope

- **`packages/agent-framework/src/memory/types.ts`** — make the read/recall/write/curate surface **async**
  (`Promise`-returning), aligning with `ISandboxClient`/`IRetrievalAdapter` so `ISemanticMemoryAdapter` becomes an
  actually-injectable seam. **Segregate** `IMemoryStore` into cohesive role interfaces
  (`IDurableMemoryReader` = `loadStartupMemory`/`list`/`readTopic`; `IMemoryWriter` = `append`; `IMemoryRecaller` =
  `recall`; `IMemoryCurationQueue` = `getPending`/`listPending`/`markPending`/`upsertPending`); `IMemoryStore` extends
  all four (one decomposition, reusable slices).
- **`file-system-memory-store.ts`** — the reference adapter's methods become `async` (wrap the sync `ProjectMemoryStore`
  /`PendingMemoryStore`/recall calls in already-resolved values — zero behavior change, near-zero cost). Hold ONE
  `ProjectMemoryStore` and inject it into `MemoryRetrievalService` (drop the duplicate instance + honor the injected
  clock).
- **`memory-retrieval-service.ts`** — `retrieve(query, budget: IMemoryBudget)` (drop the fabricated
  `policy:'disabled'` config); accept an injected reader/`ProjectMemoryStore` instead of constructing its own.
- **`automatic-memory-controller.ts`** — `capture`/`retrieve`/`approve`/`reject`/`listPending` become `async` (await the
  now-async port). (Dormant today, so only tests + the future P2 wiring are affected — P2 will `await`.)
- **`context/context-loader.ts`** — `await` the now-async `loadStartupMemory()` (`loadContext` is already `async`).
- **`command-api/memory/memory-command-api.ts` + `agent-command/src/memory/memory-command.ts`** — route the `/memory`
  command path through the **injected** `IMemoryStore` (via the command host context) instead of constructing fs stores
  from `cwd`; replace `ICommandProjectMemoryStore`/`ICommandPendingMemoryStore` with the segregated role interfaces
  (closes the duplication + the split-brain). Command handlers `await` the port. Default remains the fs reference
  adapter when the surface injects none.
- **`command-api/host-context.ts`** (or wherever the command host context is defined) — expose the injected
  `IMemoryStore` so `createCommandMemoryStores` returns a view over it, not a fresh fs store.
- **`docs/SPEC.md`** — update the memory API rows to the async + segregated shape.
- **`.agents/spec-docs/done/SELFHOST-008-durable-semantic-memory.md`** — reconcile the two conformance doc-drifts
  (name the interactive-options seam, not `ICreateSessionOptions`; narrow the "thresholds surface-injectable" claim).

### Alternatives Considered

1. **Async surface + role segregation + full command wiring, now (CHOSEN).**
   - ✅ Aligns with the `ISandboxClient`/`IRetrievalAdapter` precedents; makes `ISemanticMemoryAdapter` an injectable
     seam (removes the ghost-seam); delivers the port's stated "swap the whole store" contract (command path included);
     one interface decomposition; cheapest now (single fs adapter, few callers); no future breaking async migration.
   - ❌ Ripples `async`/`await` through the (few) callers + tests now; touches the `/memory` command path.
2. **Keep sync; revise the port when the semantic backend lands (the P1 documented deferral).**
   - ✅ No churn now.
   - ❌ The deferred `ISemanticMemoryAdapter` cannot plug into a sync port — it is a non-functioning placeholder today,
     and the eventual async migration is strictly more expensive after P2/P3 add callers. Contradicts the mirrored
     precedents. REJECTED (schedules, not avoids, the break).
3. **Async only (defer command-wiring + segregation).**
   - ✅ Fixes the most consequential finding (#2) with the least change.
   - ❌ Leaves the split-brain (#1) live — the port still doesn't deliver its contract — and two competing
     decompositions. Since all touch the same files and P2 builds on the port, doing them together is cheaper than
     three separate passes. REJECTED (partial; owner chose the full slice).
4. **Wrap sync stores behind async at the command layer only (leave the port sync).**
   - ✅ Command path could await.
   - ❌ Inconsistent (port sync, command async), doesn't unblock the semantic seam, and keeps the god-interface.
     REJECTED.

### Decision

Adopt (1): make the `IMemoryStore` read/recall/write/curate surface **async** (`Promise`-returning) to match the
`ISandboxClient`/`IRetrievalAdapter` precedents and host the async `ISemanticMemoryAdapter`; **segregate** it into four
cohesive role interfaces that `IMemoryStore` composes and the command path reuses; **route the `/memory` command path
through the injected port** (default = fs reference adapter) to deliver the "swap the whole store" contract and kill the
split-brain; and clean the recall seam (`IMemoryBudget` param) + the duplicate `ProjectMemoryStore`. The fs reference
adapter wraps its sync fs calls in already-resolved Promises — **zero behavior change**. Reconcile the two P1 spec
doc-drifts. No new fallback introduced (declared below).

### Validated Recommendation

- **Reachability:** the async surface is consumed by `context-loader.ts` (already `async`), the dormant controller
  (async-ready, awaited by P2), and the `/memory` command handlers (async-capable — commands already return
  `Promise<ICommandResult>`). The segregated interfaces are reusable by both `IMemoryStore` and the command path.
  Verified against `command-api/memory/memory-command-api.ts`, `agent-command/src/memory/memory-command.ts`,
  `sandbox/types.ts`, `retrieval/types.ts`.
- **Capability preservation:** every existing operation (durable write/read, budgeted recall, curation queue, `/memory`
  command, startup injection) is preserved — the fs adapter delegates to the same unchanged `ProjectMemoryStore`/
  `PendingMemoryStore`/`MemoryRetrievalService`; only the sync→async wrapper + the injection wiring change. No behavior
  is removed; the semantic seam becomes functional rather than ghost.
- **Adversarial:** (a) async ripple breaking a caller → the callers are few + enumerated, each `await`ed, and the full
  agent-framework + agent-command test suites gate it; (b) the command path double-reading (injected vs fresh fs) →
  resolved by making the injected port the single source; (c) behavior drift from the sync→async wrap → the adapter adds
  no logic (already-resolved Promises), asserted by the preserved P1 round-trip/budget/curate tests.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-framework` (memory port + adapter + retrieval + controller + context-loader + command-api)
      and `agent-command` (`/memory` command consuming the segregated port); reconcile the `done/` P1 spec doc-drifts. No
      new package/surface; no dependency-direction change (still intra-package + the pre-existing downward interface import).
- [x] Sibling scan 완료 — aligns the memory port to the EXISTING `ISandboxClient`/`IRetrievalAdapter` async precedents +
      collapses to ONE role-interface decomposition (reusing the command path's existing sub-interfaces); adds no new
      mechanism or escape hatch.
- [x] 대안 최소 2개 — 4 considered (async+segregate+wire CHOSEN; keep-sync REJECTED ghost-seam/scheduled-break;
      async-only REJECTED leaves split-brain; command-layer-only-async REJECTED inconsistent), each Pro+Con.
- [x] 결정 근거 — mirror the repo's async capability-port precedents (so the semantic seam functions), deliver the
      port's stated swap-the-store contract (command wiring), one segregated decomposition; cheapest now. Driven by the
      owner-requested architecture audit (2 HIGH + MED/LOW findings). GATE-APPROVAL pending.

## Fallback & Degradation Declaration

**None.** This remediation introduces no fallback or degradation path. It changes method signatures (sync→async),
adds interface segregation, and redirects the command path to the injected store — all behavior-preserving. The one
PRE-EXISTING sanctioned degradation it touches (`pending-memory-store.ts` corrupt-JSON → empty document) keeps its
existing `// allow-fallback: <reason>` annotation unchanged.

## Solution

Make the `IMemoryStore` surface async (Promise-returning) + segregate it into `IDurableMemoryReader` / `IMemoryWriter`
/ `IMemoryRecaller` / `IMemoryCurationQueue` (composed by `IMemoryStore`, reused by the command path); the fs reference
adapter wraps the unchanged sync stores in already-resolved Promises (zero behavior change) and holds one
`ProjectMemoryStore` injected into `MemoryRetrievalService`; `recall` takes `IMemoryBudget`; the `/memory` command path
consumes the injected port through the command host context (default = fs adapter); callers `await`. Reconcile the two
P1 spec doc-drifts. P2 then builds the live capture path on the corrected async port (awaiting capture before the turn's
`persistSession()`).

## Affected Files

| File                                                                           | Change                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `packages/agent-framework/src/memory/types.ts`                                 | async surface; segregate into 4 role interfaces `IMemoryStore` composes                                  |
| `packages/agent-framework/src/memory/file-system-memory-store.ts`              | async methods (wrap sync in resolved Promises); one `ProjectMemoryStore` injected into recall            |
| `packages/agent-framework/src/memory/memory-retrieval-service.ts`              | `retrieve(query, budget: IMemoryBudget)` + injected reader; drop the fabricated config + duplicate store |
| `packages/agent-framework/src/memory/automatic-memory-controller.ts`           | `capture`/`retrieve`/`approve`/`reject`/`listPending` become `async` (await the port)                    |
| `packages/agent-framework/src/context/context-loader.ts`                       | `await` the async `loadStartupMemory()`                                                                  |
| `packages/agent-framework/src/command-api/memory/memory-command-api.ts`        | route command stores through the injected port; use the segregated role interfaces                       |
| `packages/agent-framework/src/command-api/host-context.ts` (+ `agent-command`) | expose the injected `IMemoryStore`; `/memory` handlers `await` the port                                  |
| `packages/agent-framework/docs/SPEC.md`                                        | async + segregated memory API rows                                                                       |
| `.agents/spec-docs/done/SELFHOST-008-durable-semantic-memory.md`               | reconcile the 2 conformance doc-drifts (interactive-options seam; narrowed injectability claim)          |
| `packages/agent-framework` + `agent-command` `__tests__/`                      | update memory tests to the async + injected-port shape                                                   |

## Completion Criteria

- [x] TC-01: `IMemoryStore` (and its 4 role sub-interfaces) is **async** — every read/recall/write/curate method returns
      `Promise`; the fs reference adapter satisfies it with zero behavior change (the P1 round-trip/budget/curate tests
      pass unchanged after `await`) (unit test).
- [x] TC-02: `ISemanticMemoryAdapter` (async) is now **structurally injectable behind the port** — a fake async
      `IMemoryStore` backed by a fake `ISemanticMemoryAdapter` satisfies every consumer with no `agent-framework` change
      (fake-adapter unit test) — the ghost-seam is closed.
- [x] TC-03: the **`/memory` command path routes through the injected `IMemoryStore`** — with an injected fake store,
      `/memory add` / `list` / `approve` / `reject` read+write THAT store (not a fresh fs store); with none injected the
      fs reference adapter is the default (memory works unchanged) (functional test — closes the split-brain).
- [x] TC-04: **role segregation** — `IMemoryStore` is composed of `IDurableMemoryReader` + `IMemoryWriter` +
      `IMemoryRecaller` + `IMemoryCurationQueue`; the command path consumes the segregated interfaces (no duplicate
      `ICommandProjectMemoryStore`/`ICommandPendingMemoryStore` contract); a reader-only consumer depends on no
      curate/write methods (type-level + unit test).
- [x] TC-05: **recall seam cleaned** — `MemoryRetrievalService.retrieve(query, budget: IMemoryBudget)` (no fabricated
      config); `FileSystemMemoryStore` constructs ONE `ProjectMemoryStore` honoring the injected clock (unit test —
      injected `now` reaches the recall read path).
- [x] TC-06: **doc drift reconciled + build/tests green** — the `done/` P1 spec names the interactive-options seam (not
      `ICreateSessionOptions`) and narrows the injectability claim; `pnpm --filter @robota-sdk/agent-framework typecheck` + agent-framework + agent-command test suites + `pnpm harness:scan` are all green.

## Test Plan

| TC    | Verification                                                   | Type/Tool                         | Test reference                                                                               |
| ----- | -------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------- |
| TC-01 | async port; fs adapter zero-behavior-change (P1 tests pass)    | vitest unit                       | `memory/__tests__/file-system-memory-store.test.ts` (TC-01/TC-02 async round-trip + budget)  |
| TC-02 | async semantic adapter injectable behind the port              | fake-adapter unit test            | same file › "semantic seam functions" (fake `ISemanticMemoryAdapter`-backed store)           |
| TC-03 | `/memory` command routes through the injected store            | functional (command + fake store) | `agent-command/.../memory-command-module.test.ts` (12) + `command-api.test.ts` memory API    |
| TC-04 | role segregation; command reuses the slices; reader-only dep   | type-level + vitest unit          | workspace typecheck (segregated composition) + the fake-store slice tests                    |
| TC-05 | recall takes `IMemoryBudget`; single store honors injected now | vitest unit                       | `file-system-memory-store.test.ts` › "recall seam cleaned: injected clock reaches recall"    |
| TC-06 | doc drift reconciled; typecheck + tests + harness:scan green   | doc review + suite/regression     | `done/` P1 spec + `docs/SPEC.md` diffs; `pnpm harness:scan` 55/55; workspace typecheck clean |

## Tasks

[`.agents/tasks/completed/SELFHOST-008-P1R.md`](../../tasks/completed/SELFHOST-008-P1R.md) — created at GATE-IMPLEMENT; TC-01..06 slices

- the 2 GATE-APPROVAL implementation cautions + a 4-commit increment plan + Test Plan.

## Evidence Log

- 2026-07-18 — **Drafted from the owner-requested architecture audit.** `architecture-auditor` (ACTIONABLE 4: 2 HIGH —
  half-wired command path + sync-vs-async ghost-seam — plus ISP/duplication/cleanup MED/LOW) + `architecture-conformance-auditor`
  (ACTIONABLE 0: materially in sync; 2 LOW doc-drifts). Owner chose the full port-remediation slice before P2. P2 is HELD
  in `spec-docs/backlog/` pending this correction.

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: DATA` (valid 11-prefix value); `tags:` present (`[memory, dip-port, async, remediation, selfhost]`). PASS.
- Problem: concrete symptoms (split-brain `/memory` path constructing its own stores in `createCommandMemoryStores`; sync port contradicting the async `ISandboxClient`/`IRetrievalAdapter` precedents) + reproduction condition (a surface injecting an alternate backend gets a split brain); no TBD/TODO/vague text. PASS.
- Prior Art Research: `## Prior Art Research` present with explicit `Waived:` line — internal-consistency remediation aligning to the repo's own async capability-port precedents (sandbox/retrieval), with in-repo citations; a valid research.md opt-out (scan-spec-research passes). Findings feed Alternatives/Decision. PASS.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence (aligns to existing `ISandboxClient`/`IRetrievalAdapter` + collapses to one role-interface decomposition, no new mechanism); Alternatives Considered has 4 entries each with Pro/Con; Decision references the trade-offs (async precedents + swap-store contract + cheapest-now). New-surface placement N/A — no new package/app/surface, no dependency-direction change (stated in checklist). PASS.
- Completion Criteria: TC-01..TC-06 all TC-N prefixed; ≥1 criterion per feature; command/observable form; no banned vague phrasing. PASS.
- Test Plan: `## Test Plan` present; 6 rows for 6 TC-N (count matches); each row has non-empty Type/Tool; no bare "manual" tool rows requiring Notes. PASS.
- Structure: Tasks section present with placeholder; Evidence Log present containing only the 2026-07-18 drafting-provenance note (no prior gate entries); no `## Status`/`## Classification` body sections. PASS.
- Cross-check: Completion Criteria TC count (6) == Test Plan TC count (6). Confirmed.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: `### [GATE-WRITE] — ✅ PASS | 2026-07-18` present in this Evidence Log; frontmatter `status: review-ready`; file in `spec-docs/backlog/`. Expected input stage matches. PASS.
- User explicit approval: the owner chose the full port-remediation slice before P2 — verbatim: **"포트 재정비 슬라이스 먼저 (P1.5)"** — a direct, unambiguous authorization directed at this memory-port remediation spec. PASS.
- No post-approval mutation: Architecture Review + frontmatter `type: DATA` / `tags` unchanged after approval (only this Evidence Log entry appended). PASS.
- Independent architecture validation: not strictly required (no new package/app/surface; intra-package async+segregation remediation, no dependency-direction change). Provided anyway — an independent `proposal-reviewer` returned **ENDORSE**, confirming both HIGH findings (split-brain `/memory` command path; a sync port cannot host the async `ISemanticMemoryAdapter`) and the async decision. PASS.
- Non-blocking implementation cautions carried into GATE-IMPLEMENT: (1) thread ONE shared `IMemoryStore` instance to all three consumers (startup injection, capture controller, `/memory` command path) via a host-context accessor — do not construct parallel instances; (2) unify the curation-queue method naming `get`/`list`/`mark`/`upsert` → `getPending`/`listPending`/`markPending`/`upsertPending`.
- No implementation work (file edits / commits) preceded this gate — GATE-IMPLEMENT (tasks file creation) has not yet run. No NON-COMPLIANCE trigger.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18

**Status upgrade:** approved → in-progress

- Prior-gate precondition: `### [GATE-APPROVAL] — ✅ PASS | 2026-07-18` present in this Evidence Log; frontmatter `status: approved`; file in `spec-docs/todo/`. Expected input stage matches. PASS.
- Tasks file created: `.agents/tasks/SELFHOST-008-P1R.md` exists (untracked new file). PASS.
- Tasks path recorded in spec: `## Tasks` section links `[.agents/tasks/SELFHOST-008-P1R.md](../../tasks/SELFHOST-008-P1R.md)`. PASS.
- Tasks map to Completion Criteria: task file has one slice per TC-N (TC-01..TC-06), each mirroring the spec's Completion Criteria; plus a 4-commit increment plan and the 2 GATE-APPROVAL implementation cautions. PASS.
- Test Plan present in task file: `## Test Plan` section (≥50 chars) enumerating vitest-unit / functional / regression coverage mapped to TC-01..06 — satisfies the `test-plans` harness scan [AF-24]. PASS.
- No implementation commits: `git log` shows the latest memory work is P1 (#1218, merged); no P1R remediation commits exist — spec + task files are untracked. No NON-COMPLIANCE trigger.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18

**Status upgrade:** approved → in-progress. Task `.agents/tasks/SELFHOST-008-P1R.md` created (TC-01..06 + 2 cautions +
increment plan + Test Plan); path in `## Tasks`; no pre-gate implementation. (Recorded by backlog-gate-guard.)

### [GATE-VERIFY] — ✅ PASS | 2026-07-18

**Status upgrade:** in-progress → verifying

- Prior-gate precondition: `### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18` present in this Evidence Log; frontmatter
  `status: in-progress`. Expected input stage matches. PASS.
- All task slices complete: `.agents/tasks/SELFHOST-008-P1R.md` shows TC-01..TC-06 all `[x]` (6/6); none blocked or
  pending. PASS.
- Build/tests green for affected packages (evidence spot-checked, full suites not re-run): agent-framework
  1176/1176 passing; agent-command 237/237 passing; `pnpm typecheck` (workspace) clean; `pnpm harness:scan` 55/55.
  Spot-check confirmed the backing test files exist (`memory/__tests__/file-system-memory-store.test.ts` with the
  "semantic seam functions" + "recall seam cleaned" cases; `agent-command/src/memory/__tests__/memory-command-module.test.ts`),
  the 4 segregated role interfaces + composing `IMemoryStore` are present in `memory/types.ts`, and the injected-port
  command wiring (`ICommandHostContext.getMemoryStore()` + fs default) is in place. PASS.
- (Recorded by backlog-gate-guard.)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-07-18

- Async port + zero-behavior-change adapter: `IMemoryStore` + the 4 role sub-interfaces are `Promise`-returning
  (`memory/types.ts`); `FileSystemMemoryStore` wraps the unchanged sync stores in resolved Promises. The P1
  round-trip/budget/curate tests pass unchanged after `await`.
- Test: `memory/__tests__/file-system-memory-store.test.ts` › TC-01 durable round-trip + TC-02 budgeted recall (async).
  `npx vitest run packages/agent-framework/src/memory` → all pass.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-07-18

- Semantic seam functions: a fake async `IMemoryStore` backed by a fake async `ISemanticMemoryAdapter` satisfies the
  port with no `agent-framework` change (ghost-seam closed).
- Test: `file-system-memory-store.test.ts` › "async adapter swap needs no library change; semantic seam functions".

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-07-18

- `/memory` routes through the injected port: `ICommandHostContext.getMemoryStore()` (new) returns the session's
  injected store or a lazily-cached fs default (ONE shared instance); `InteractiveSession.getMemoryStore()` implements
  it; `createCommandMemoryStores` returns that store; `executeMemoryCommand` (now async) reads/writes it — split-brain
  closed.
- Test: `agent-command/src/memory/__tests__/memory-command-module.test.ts` (12 pass — `/memory pending|approve|reject|
add` through the session's store) + `command-api.test.ts` memory API.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-07-18

- Role segregation: `IMemoryStore extends IDurableMemoryReader, IMemoryWriter, IMemoryRecaller, IMemoryCurationQueue`;
  the command path consumes those (the duplicate `ICommandProjectMemoryStore`/`ICommandPendingMemoryStore` were
  removed); `context-loader` depends only on the reader (`loadStartupMemory`).
- Test: typecheck (the segregated composition compiles + all consumers) + the async fake-store tests exercising slices.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-07-18

- Recall seam cleaned: `MemoryRetrievalService.retrieve(query, budget: IMemoryBudget)` (no fabricated config);
  `FileSystemMemoryStore` holds ONE `ProjectMemoryStore` injected into the retrieval service, honoring the injected clock.
- Test: `file-system-memory-store.test.ts` › "recall seam cleaned: injected clock reaches the recall read path"
  (recalled entry is stamped with the injected 2026-07-18 clock).

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-07-18

- Doc drift reconciled: the `done/` P1 spec now names the interactive-options seam (not `ICreateSessionOptions`) and
  narrows the "thresholds surface-injectable" claim (heuristics + policy-mode/budget injectable; threshold/evaluator
  deferred). `docs/SPEC.md` carries the async + segregated rows.
- Green: `pnpm --filter @robota-sdk/agent-framework typecheck` clean; agent-framework 1176/1176; agent-command 237/237;
  `pnpm typecheck` (workspace) clean; `pnpm harness:scan` 55/55.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-18

**Status upgrade:** verifying → done. All six Completion Criteria `[x]` with matching `[GATE-COMPLETE: TC-N]` evidence;
every Test Plan row has a test reference. Both HIGH audit findings closed (async port + full command wiring), MED/LOW
folded (segregation, recall seam, injected-clock). The two GATE-APPROVAL cautions applied: ONE shared store instance
(`InteractiveSession.getMemoryStore()` lazy-cached) + unified `*Pending` curation-queue naming. Spec → `spec-docs/done/`;
task → `.agents/tasks/completed/SELFHOST-008-P1R.md`. **P2 (in `backlog/`) is now UNBLOCKED** — it builds the live
capture path on the corrected async port (awaiting capture before the turn's `persistSession()`).
