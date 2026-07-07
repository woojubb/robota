---
status: done
type: INFRA
tags: [cli]
---

# INFRA-031: Move GitWorktreeIsolationAdapter to the composition root (ARL-02 / ARCH-FIX-024)

## Problem

`GitWorktreeIsolationAdapter` — a concrete, side-effectful adapter that spawns the `git` CLI
(`execFileSync`), creates directories (`mkdirSync`), and parses git error strings — lives inside
`packages/agent-executor/src/subagents/git-worktree-isolation-adapter.ts`. `agent-executor` is a
reusable runtime-primitives package whose own SPEC Boundaries state it "does not create … Git
worktrees" and that "concrete I/O belongs in adapters owned by runtime shells or dedicated adapter
packages" — and the SPEC self-flags this exact misplacement as the deferred ARCH-FIX-024. Surfaced as
ARL-02 by the architecture-refresh pass.

The coupling leaks further: `packages/agent-subagent-runner/src/child-process-subagent-runner.ts:64`
**defaults** `worktreeAdapter` to `createGitWorktreeIsolationAdapter()`, so a second reusable mechanism
package hard-wires the concrete git/filesystem side-effect as its fallback, and `agent-cli` (the actual
composition root, `cli.ts:258`) relies on that hidden default rather than injecting the adapter itself.

**Reproduction condition:** `rg "execFileSync|mkdirSync" packages/agent-executor/src` shows a
foundational mechanism package shelling out to `git` and touching the filesystem, contradicting its
stated boundary; `agent-subagent-runner` cannot be used without dragging in a concrete git dependency.

## Architecture Review

### Affected Scope

- **Move:** `packages/agent-executor/src/subagents/git-worktree-isolation-adapter.ts` (concrete adapter +
  `createGitWorktreeIsolationAdapter` + `IGitWorktreeIsolationAdapterOptions`) → `packages/agent-cli/src/subagents/`.
  Its test `.../subagents/__tests__/git-worktree-isolation-adapter.test.ts` moves with it.
- **Stays in `agent-executor`:** the port `ISubagentWorktreeAdapter` + the pure decorator
  `WorktreeSubagentRunner`/`createWorktreeSubagentRunner` (`worktree-subagent-runner.ts`) — the mechanism.
- **`agent-subagent-runner`:** `child-process-subagent-runner.ts` drops the
  `?? createGitWorktreeIsolationAdapter()` default; `worktreeAdapter` becomes a required injected option
  on `IChildProcessSubagentRunnerOptions` (no concrete-git dependency remains here).
- **`agent-cli`:** the composition root — `cli.ts:258` passes
  `worktreeAdapter: createGitWorktreeIsolationAdapter()` (from the moved agent-cli copy) into
  `createChildProcessSubagentRunnerFactory(...)`. agent-cli already depends on agent-executor +
  agent-subagent-runner. The moved adapter imports `BackgroundTaskError` + the three port types from
  `@robota-sdk/agent-executor` (all already exported).
- **Docs/rules:** `agent-executor`, `agent-subagent-runner`, `agent-cli` SPECs;
  `.agents/architecture-remediation-log.md` (ARL-02 → Resolved).

### Alternatives Considered

1. **Move the concrete adapter to the composition root (agent-cli); inject the port downward (chosen).**
   The concrete git/fs I/O lives in the imperative shell (agent-cli); agent-executor owns only the port +
   pure decorator; agent-subagent-runner requires the adapter injected. Restores the executor boundary
   and makes the dependency explicit at the one place that composes the CLI.
   - _Pro:_ agent-executor no longer creates **Git worktrees** (its stated boundary becomes literally
     true) and `agent-subagent-runner` no longer hard-defaults a concrete git dependency; the concrete
     side-effect is owned once, at the shell that already wires everything. (Scope note: agent-executor
     still legitimately uses `child_process`/`fs` for its managed-shell + scheduled task runners — this
     change does **not** make it "pure" and needs no `package.json`/dep-kind change.)
   - _Con (cost):_ a cross-package move (executor→cli) + turning `agent-subagent-runner`'s optional
     defaulted field into a **required** injected one (a **breaking** change to a published package →
     changeset) + one agent-cli wiring line + one harness allowlist entry (the moved agent-cli file
     imports `@robota-sdk/agent-executor`, which the `cli-agent-executor-import` conformance scan gates —
     see Solution). CLI runtime behavior is unchanged (agent-cli injects the same adapter the default
     previously supplied; agent-cli is the sole factory caller, so no consumer silently loses isolation).
2. **Keep the adapter in agent-executor but "allow" it via a SPEC exception.** _Rejected —_ that fixes
   the contradiction by weakening the architecture to match bad placement: a zero-I/O mechanism package
   would still shell out to `git`, and `agent-subagent-runner` would still hard-default a concrete
   dependency. Correctness, not the smaller diff, governs.
3. **Move it to a new dedicated adapter package (`agent-subagent-worktree-git`).** _Rejected (for now) —_
   there is exactly one concrete adapter and one composition consumer (agent-cli); a new package is
   premature indirection (YAGNI). If a second shell needs it later, extract then.

### Decision

**Alternative 1.** The concrete `GitWorktreeIsolationAdapter` moves to `agent-cli/src/subagents/` (the
composition root / imperative shell). `agent-executor` keeps only `ISubagentWorktreeAdapter` +
`WorktreeSubagentRunner`; `agent-subagent-runner` requires `worktreeAdapter` injected (no concrete-git
default); `agent-cli` injects it at `createChildProcessSubagentRunnerFactory`. Runtime behavior is
preserved (the same adapter, now explicit); the executor's "creates no worktrees" boundary becomes true.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-executor (remove concrete + exports), agent-subagent-runner (drop default, require injection), agent-cli (own concrete + inject), 3 SPECs, remediation log
- [x] Sibling scan 완료 — the concrete adapter's only non-test consumers are `agent-subagent-runner` (the default) and `agent-executor`'s barrels; agent-cli is the sole composition caller of the factory (`cli.ts:258`; print-mode only re-types it) — verified by rg
- [x] 대안 최소 2개 검토 완료 — 3 alternatives; 2 rejected (SPEC-exception weakens the architecture; new package is premature)
- [x] 결정 근거 문서화 완료 — concrete I/O belongs in the imperative shell that composes the app; mechanism packages must stay pure; blast radius is a cost, not the rationale

## Solution

1. Move `git-worktree-isolation-adapter.ts` to `packages/agent-cli/src/subagents/`; repoint its imports
   (`BackgroundTaskError`, `ISubagentWorktreeAdapter`, `IPreparedSubagentWorktree`,
   `ISubagentWorktreePrepareRequest`) to `@robota-sdk/agent-executor`. Move its test alongside and
   repoint to the agent-cli-local adapter.
2. Remove the concrete adapter's exports from `agent-executor/src/index.ts` and
   `agent-executor/src/subagents/index.ts` (keep the port + `WorktreeSubagentRunner` exports).
3. In `agent-subagent-runner/src/child-process-subagent-runner.ts`: drop the
   `createGitWorktreeIsolationAdapter` import and the `?? createGitWorktreeIsolationAdapter()` fallback;
   make `worktreeAdapter` a required field of `IChildProcessSubagentRunnerOptions`.
4. In `agent-cli/src/cli.ts` (~258): pass `worktreeAdapter: createGitWorktreeIsolationAdapter()` (import
   the moved module directly — `cli.ts` is the only importer, so **no `agent-cli/src/subagents/` barrel**).
5. **Add the harness allowlist entry.** The moved file
   `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts` imports `@robota-sdk/agent-executor`,
   which the `cli-agent-executor-import` rule in `scripts/harness/check-background-workspace-conformance.mjs`
   gates (allowlist currently only `cli.ts` + `modes/print-mode.ts`). Add the new file to that rule's
   `exemptions` map with a reason ("composition root — concrete worktree adapter wiring"). Without this,
   `harness:scan` fails. (Do NOT route the port types via an agent-framework re-export to dodge the rule —
   that violates no-pass-through; the direct import + allowlist entry is the sanctioned shape.)
6. **Record the breaking change.** Making `IChildProcessSubagentRunnerOptions.worktreeAdapter` required is
   a breaking change to the published `@robota-sdk/agent-subagent-runner` API — add a `.changeset` entry
   and update `agent-subagent-runner/README.md` (the `worktreeAdapter` default is documented there).
7. Update SPECs: `agent-executor` (boundary "creates no worktrees" now literally true; concrete adapter
   removed from surface — leave its `child_process`/`fs` usage for managed-shell/scheduled runners
   documented as-is), `agent-subagent-runner` (`worktreeAdapter` now required), `agent-cli` (owns
   `GitWorktreeIsolationAdapter`); mark ARL-02 resolved in the remediation log.
8. Build/typecheck/affected tests green; `pnpm harness:scan` 45/45 (incl. `deps`/`dep-kind` and the
   `cli-agent-executor-import` conformance scan).

## Affected Files

- Move: `packages/agent-executor/src/subagents/git-worktree-isolation-adapter.ts` → `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts`; test `packages/agent-executor/src/subagents/__tests__/git-worktree-isolation-adapter.test.ts` → `packages/agent-cli/src/subagents/__tests__/`
- `packages/agent-executor/src/index.ts`, `packages/agent-executor/src/subagents/index.ts` (drop concrete exports)
- `packages/agent-subagent-runner/src/child-process-subagent-runner.ts` (drop default; require `worktreeAdapter`)
- `packages/agent-cli/src/cli.ts` (inject the adapter; direct import, no barrel)
- `scripts/harness/check-background-workspace-conformance.mjs` (add the moved file to `cli-agent-executor-import` `exemptions`)
- new `.changeset/*.md` (breaking: `@robota-sdk/agent-subagent-runner` required `worktreeAdapter`)
- `packages/agent-executor/docs/SPEC.md`, `packages/agent-subagent-runner/docs/SPEC.md` + `packages/agent-subagent-runner/README.md`, `packages/agent-cli/docs/SPEC.md`
- `.agents/architecture-remediation-log.md` (ARL-02 → Resolved)

## Completion Criteria

- [ ] TC-01: `packages/agent-executor/src/subagents/git-worktree-isolation-adapter.ts` no longer exists; `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts` exists.
- [ ] TC-02: `rg "GitWorktreeIsolationAdapter" packages/agent-executor/src` returns nothing; `agent-executor`'s barrels export neither the class nor `createGitWorktreeIsolationAdapter`.
- [ ] TC-03: `rg "execFileSync|mkdirSync" packages/agent-executor/src` returns nothing (the "creates no worktrees" boundary holds); `rg "execFileSync|mkdirSync|require\('child_process'\)" packages/agent-subagent-runner/src` also clean of the git adapter.
- [ ] TC-04: `agent-subagent-runner` no longer imports `createGitWorktreeIsolationAdapter`; `IChildProcessSubagentRunnerOptions.worktreeAdapter` is required (omitting it is a type error).
- [ ] TC-05: `agent-cli/src/cli.ts` passes `worktreeAdapter` into `createChildProcessSubagentRunnerFactory`; CLI worktree-isolation runtime behavior unchanged (the moved adapter is exercised by its relocated test + the subagent runner path).
- [ ] TC-06: `pnpm build`, `pnpm typecheck`, affected package tests (agent-executor, agent-subagent-runner, agent-cli) and `pnpm harness:scan` (45/45, incl. `deps`/`dep-kind` AND the `cli-agent-executor-import` conformance scan — the moved agent-cli file is added to that rule's `exemptions`) all green.
- [ ] TC-07: `agent-executor`/`agent-subagent-runner`/`agent-cli` SPECs + `agent-subagent-runner/README.md` updated; a `.changeset` entry records the breaking `worktreeAdapter`-required change; ARL-02 marked resolved in the remediation log.

## Test Plan

Test strategy (INFRA + cli): structural (grep/type assertions for placement + required-injection) +
the relocated adapter's own unit test + affected-package green gate. Behavior is preserved, so the
existing worktree/subagent tests are the regression guard.

| TC-ID | Test Type  | Tool / Approach                                                          | Notes                                                                |
| ----- | ---------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| TC-01 | Structural | `ls`/`rg` — file moved executor→cli                                      | placement                                                            |
| TC-02 | Structural | `rg "GitWorktreeIsolationAdapter" packages/agent-executor/src` → none    | executor no longer owns/exports it                                   |
| TC-03 | Structural | `rg "execFileSync\|mkdirSync"` in executor + subagent-runner src → none  | boundary "creates no worktrees" holds                                |
| TC-04 | Type/Unit  | tsc — omitting `worktreeAdapter` is a type error; no concrete-git import | required injection                                                   |
| TC-05 | Unit       | vitest — relocated adapter test green in agent-cli; subagent runner path | behavior preserved                                                   |
| TC-06 | Build/CI   | `pnpm build && pnpm typecheck && pnpm test` (affected) + `harness:scan`  | green gate incl. deps/dep-kind + cli-agent-executor-import allowlist |
| TC-07 | Structural | SPEC + README + `.changeset` + remediation-log diff review               | docs/rules/changeset in sync                                         |

## Tasks

- [x] `.agents/tasks/INFRA-031.md` — created (T1–T9, one+ per TC-N; includes Test Plan / 검증)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter: `---`; `status: draft`; `type: INFRA` (valid); `tags: [cli]`.
Problem: concrete symptom (`rg execFileSync|mkdirSync packages/agent-executor/src` — a mechanism package shells out to git; SPEC boundary contradicted; agent-subagent-runner hard-defaults the concrete adapter) + reproduction condition; no TBD.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` (only non-test consumers are agent-subagent-runner default + executor barrels; agent-cli sole factory caller — verified by rg); 3 alternatives with pro/con (2 rejected: SPEC-exception weakens architecture, new package premature); Decision references the imperative-shell/correctness trade-off.
Completion Criteria: TC-01..TC-07, all TC-N-prefixed, structural/observable form.
Test Plan: present; 7 rows matching TC-01..TC-07; each has Test Type + Tool; no "manual" rows.
Structure: Tasks placeholder; Evidence Log was empty; no `## Status`/`## Classification` in body.

### [Design Review] — proposal-reviewer | 2026-07-07

- Round 1 → **REVISE**: direction correct, but missed the `cli-agent-executor-import` harness allowlist entry (TC-06 blocker), overstated the "pure mechanism" Pro, and omitted the breaking-change changeset/README + barrel decision.
- Round 2 → **ENDORSE**: all five corrections verified against code (allowlist rule location, executor still uses child_process/fs, published-surface breaking change, no barrel, test repoint). Decision sound + rule-aligned. "Approve as written."

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user rule): a spec is approved when the neutral `proposal-reviewer` ENDORSEs a sound, rule-aligned recommendation. Reviewer returned `REVIEW VERDICT: ENDORSE` (correctness-based: concrete git/fs side-effect belongs in the imperative shell; mechanism packages stay port-only; no-pass-through respected via the sanctioned composition-root allowlist). No Architecture Review / type / tags changed after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
`.agents/tasks/INFRA-031.md` created; path recorded in `## Tasks`. Tasks map to TC-01..TC-07 (≥1 per TC-N); tasks file includes a `## Test Plan / 검증` section [AF-24].

### [GATE-VERIFY] — ✅ PASS | 2026-07-07

**Status upgrade:** in-progress → verifying
TC-01: adapter + test moved to `packages/agent-cli/src/subagents/`; gone from agent-executor. TC-02: `rg "GitWorktreeIsolationAdapter" packages/agent-executor/src` → none; barrels no longer export it. TC-03: `rg "execFileSync|mkdirSync" packages/agent-executor/src` → none (boundary holds). TC-04: `worktreeAdapter` required — omission is a type error (tsc); agent-subagent-runner no longer imports the concrete adapter. TC-05: `agent-cli/src/cli.ts` injects `createGitWorktreeIsolationAdapter()` (direct import); print-mode type-only. TC-06: `pnpm harness:scan` 45/45 incl. `cli-agent-executor-import` (allowlist entry exercised); **full-repo `pnpm typecheck` green** (all packages — no missed consumer); affected tests green (agent-cli 163/163 incl. relocated 8/8, agent-subagent-runner 14/14, agent-executor green); repo-wide sweep confirms agent-cli is the ONLY factory caller. TC-07: 3 SPECs + README + `.changeset` + remediation-log (ARL-02 → Resolved) updated.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-07

**Status upgrade:** verifying → done
All TC-01..TC-07 satisfied. Concrete `GitWorktreeIsolationAdapter` now lives at the agent-cli composition root; agent-executor keeps only the port + pure decorator (its "creates no Git worktrees" boundary is literally true); agent-subagent-runner requires the adapter injected (breaking change recorded via changeset + README). proposal-reviewer ENDORSE (after 1 REVISE); implemented by architecture-implementer; behavior preserved.
