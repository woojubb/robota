---
status: done
type: BEHAVIOR
tags: [behavior]
lane: L1
---

# BEHAVIOR-2650: ARCH-042 scenario leaks ambient GIT_DIR breaking identity isolation in a git-hook context

Paired with `.agents/tasks/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md`. Arising from [issue #2650](https://github.com/woojubb/robota/issues/2650).

## Problem

`packages/agent-framework/examples/verify-workspace-project-authority.ts`'s `GitWorkspaceIdentityResolver.resolve()`
shells out to `git -C <cwd> rev-parse --show-toplevel|--absolute-git-dir` without stripping ambient
`GIT_*` environment variables. When this scenario runs inside a `git push` pre-push hook invoked from a
linked worktree, Git exports `GIT_DIR` (pointing at the hook's own repository) into the hook's process
tree; Node's `spawnSync`/`execFileSync` inherit `process.env` by default, so the scenario's nested
`git -C <tempRepo> ...` calls silently ignore `-C` and resolve to the ambient `GIT_DIR` instead —
collapsing the scenario's two independent temp repositories onto the same identity key, so
`pnpm scenario:verify:workspace-authority` (and therefore any `git push` from a linked worktree that
touches `packages/agent-framework`) fails with "a grant for one repository was accepted for a different
root", even though the scenario passes cleanly with no ambient `GIT_DIR`.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `packages/agent-framework`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Fixing the three `execFileSync('git', ...)` call sites in this one scenario file is
proportionate; the class-wide concern (every git-shelling site in the repo) is already partially
addressed by `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts`'s
`createGitEnvironment()` — auditing every OTHER git-shelling site for the same hazard is real but
separate work, out of proportion for a scenario-test fixture bug.

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

Give `GitWorkspaceIdentityResolver.resolve()` and `initializeGitProject()` in
`verify-workspace-project-authority.ts` a `gitEnvironment()` helper (mirroring
`git-worktree-isolation-adapter.ts`'s `createGitEnvironment()`) that strips every `GIT_*`-prefixed env
var before their three `execFileSync('git', ...)` calls, so an ambient `GIT_DIR`/`GIT_WORK_TREE` (as a
hook invocation exports) can never override `-C <cwd>`.

## Affected Files

- `packages/agent-framework/examples/verify-workspace-project-authority.ts`
- `packages/agent-framework/examples/__tests__/verify-workspace-project-authority-gitdir-leak.test.ts` (new)

## Completion Criteria

- [x] TC-01: `pnpm --filter @robota-sdk/agent-framework exec vitest run examples/__tests__/verify-workspace-project-authority-gitdir-leak.test.ts` → exits 0, and exits 1 with the fix reverted
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement` → exits 0
- [x] TC-03: `pnpm --filter @robota-sdk/agent-framework scenario:verify` → exits 0 (the full owner scenario chain, not only the new case)

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                      | Notes                                                                                                                              |
| ----- | --------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit      | `vitest run verify-workspace-project-authority-gitdir-leak.test.ts`  | RED with the fix reverted (WorkspaceAuthorityRequiredError), GREEN with it                                                         |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                          | Regression — the affected set, not the full suite                                                                                  |
| TC-03 | Suite     | `pnpm scenario:verify` (agent-framework's full owner scenario chain) | Whole chain incl. `examples/__tests__/verify-workspace-project-authority-gitdir-leak.test.ts` — proves no other scenario regressed |

## User Execution Test Scenarios

Not applicable.

**Reason:** This is a fix to an internal scenario-test fixture's git-shelling robustness; no production
`IWorkspaceIdentityResolver` implementation shares this pattern, so there is no end-user-observable
surface. Verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` — done

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-07, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <4 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 4 changed path(s) — committed and working-tree changes vs origin/develop (merge base be9d6b0a91c7) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md) is at or above the floor L0)
**Review fingerprint:** 039ecee1a79f (review f46fc698, type/tags d80948cb)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (039ecee1a79f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `be9d6b0a91c7` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/draft/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `754645ac8c20` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: BEHAVIOR` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 990 chars, 2 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <4)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (039ecee1a79f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `be9d6b0a91c7` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/draft/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `cb3eb8c0e549` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-07

**Command:** `pnpm --filter @robota-sdk/agent-framework exec vitest run examples/__tests__/verify-workspace-project-authority-gitdir-leak.test.ts`
**Exit:** 0
**Output:** (last 10 of 251 line(s))

```
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-8.15.4.tgz
 ✓ examples/__tests__/verify-workspace-project-authority-gitdir-leak.test.ts (1 test) 1078ms
   ✓ ARCH-042 scenario — GIT_DIR/GIT_WORK_TREE leak (BEHAVIOR-2650) > passes even when the ambient environment carries a hook-exported GIT_DIR/GIT_WORK_TREE  1078ms

 Test Files  211 passed | 8 skipped (219)
      Tests  1647 passed | 74 skipped (1721)
   Start at  01:51:45
   Duration  15.40s (transform 3.60s, setup 0ms, collect 23.71s, tests 6.20s, environment 18ms, prepare 9.01s)

EXIT:0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `37042fc149cc` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/todo/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `628aa6da0f44` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-07

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement`
**Exit:** 0
**Output:** (last 10 of 137 line(s))

```
✓ docs-structure

⚑ 3 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ spec-whitebox-leakage: packages/agent-framework/docs/SPEC.md: 2235/3071 lines (72.8%) outside the standard sections — consider extracting to docs/design/
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 349/791 lines (44.1%) outside the standard sections — consider extracting to docs/design/
⚑ progress-report-quantification: progress-report quantification examined 0 transcript(s) — no session transcript for this workspace at /Users/jungyoun/.claude/projects/-private-tmp-robota-worktrees-fix-arch042-gitdir-leak; the agent-narrative channel does not exist on this host (e.g. CI or a fresh checkout), so nothing was judged.

117 scans passed, 2 skipped (119 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/spec-docs/todo/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md
EXIT:0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `37042fc149cc` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/todo/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `1edad9bdda5d` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-07

**Command:** `pnpm --filter @robota-sdk/agent-framework scenario:verify`
**Exit:** 0
**Output:** (last 10 of 29 line(s))

```
> @robota-sdk/agent-framework@3.0.0-beta.79 scenario:verify:zero-config-tools /private/tmp/robota-worktrees/fix-arch042-gitdir-leak/packages/agent-framework
> pnpm exec tsx --conditions=source examples/verify-zero-config-default-tools.ts

{"scenario":"ARCH-035","createSessionReturnedSynchronously":true,"providerObservedTools":["AskUserQuestion","BackgroundProcess","Bash","Edit","Glob","Grep","Read","Shell","WebFetch","WebSearch","Write","report_goal_status"],"cleanupRemoved":true}

> @robota-sdk/agent-framework@3.0.0-beta.79 scenario:verify:workspace-authority /private/tmp/robota-worktrees/fix-arch042-gitdir-leak/packages/agent-framework
> pnpm exec tsx --conditions=source examples/verify-workspace-project-authority.ts

{"scenario":"ARCH-042","restricted":{"status":"restricted","reason":"WorkspaceAuthorityRequired","observedCanaries":[]},"authorized":{"status":"trusted","observedCanaries":["ARCH_042_CONTEXT_CANARY","ARCH_042_SETTINGS_CANARY"]},"cleanupRemoved":true}
EXIT:0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `37042fc149cc` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/todo/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `f8702ca72de4` (modified)

### [GATE-DONE] — ❌ FAIL | 2026-09-07

**Status remains:** approved
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `37042fc149cc` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/todo/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `8d34ef62435d` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-07

**Status upgrade:** approved → done

**Ordering check:** PASS — prior gate `[GATE-PLAN] — ✅ PASS | 2026-09-07` recorded above; its `**Status upgrade:** draft → approved` line's `approved` equals this document's current frontmatter `status: approved` (`recorded-pass` rule for GATE-DONE → GATE-PLAN). The document's own state corroborates the passage independently of entry order, satisfying the ordering check.

**Scope of this judgement:** dispatched specifically to resolve the two `PENDING-GUARDIAN` GATE-VERIFY criteria a `gate.mjs judge --gate DONE --doc <this document> --lane L1` run reports for this document. The remaining 11 criteria were not taken on the dispatching caller's characterization — re-run here, live, with real `--verify-cmd` values (see below), to confirm they are genuinely PASS before this entry asserts a full GATE-DONE verdict.

**Root cause of the `PENDING-GUARDIAN` classification (verified against the source, not assumed from precedent):** `scripts/harness/gate-operations.mjs`'s `verifyChecks()` binds GATE-VERIFY's first two criteria to the regexes `/All tasks in `\.agents\/tasks\/<ID>\.md` are marked complete/i` and `/No tasks are blocked or pending/i` (gate-operations.mjs:1311,1316) — wording that predates the issue #2375 rescoping. `gate-catalogue.md`'s current text (lines 352-355) reads "Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`)" and "No Plan item is blocked or pending", which matches neither regex, so the mechanical evaluator's own fail-closed rule ("a `mechanical` criterion this script has no judgement for is reported `PENDING-GUARDIAN`, never PASS") fires — not because the Task's Plan is deficient. This is the same tool defect an earlier session identified for MEM-2055; confirmed independently here by reading `gate-operations.mjs` directly and diffing its patterns against this repository's current `gate-catalogue.md` wording, rather than assumed from that precedent.

**Guardian criteria (judged, this entry):**

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) — ✅ PASS: `.agents/tasks/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md`'s `## Plan` section holds exactly 2 items ("Give `GitWorkspaceIdentityResolver.resolve()` the same `GIT_*`-stripping environment…" and "Add regression coverage: the scenario passes even with `GIT_DIR`/`GIT_WORK_TREE` set…"), both `- [x]`. Cross-checked with `node scripts/harness/scan-task-plan-items.mjs` (the catalogue-current mechanical floor for this exact criterion, issue #2375) → `::examined:: 260 Task Plan sections` / `task-plan-items scan passed.` (exit 0); this Task's file is among the 260 examined, with 0 findings against it.
- GATE-VERIFY — No Plan item is blocked or pending — ✅ PASS: neither Plan item's text contains "blocked" or "pending", and both are `[x]` — no unchecked, blocked, or pending item exists in the section. The same `scan-task-plan-items.mjs` run also confirms neither item names its own disposition (merge/land/close/publish per `isDispositionItem()`), so no item here is unsatisfiable-by-construction either.

**Mechanical criteria (re-verified live this run, not taken on faith):**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`) — ✅ PASS: ran `pnpm run build:affected` directly (this branch's only affected package is `packages/agent-framework`, per `## Architecture Review > Affected Scope`) → exit 0, `workspace-affected-run: PASS tasks=13 n/a=0`. Re-running `node scripts/harness/gate.mjs judge --gate DONE --doc <this document> --lane L1 --verify-cmd "pnpm run build:affected" --verify-cmd "pnpm run test:affected"` (real, non-dry-run) reports `PASS GATE-VERIFY — Build passes … build-shaped \`pnpm run build:affected\` → exit 0 … all 2 supplied commands exit 0`.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`) — ✅ PASS: ran `pnpm run test:affected` directly → exit 0, `Test Files  211 passed | 8 skipped (219)`, `Tests  1647 passed | 74 skipped (1721)`, `workspace-affected-run: PASS tasks=1 n/a=0`. The same real `gate.mjs` re-run reports `PASS GATE-VERIFY — Tests pass … test-shaped \`pnpm run test:affected\` → exit 0 … all 2 supplied commands exit 0`.
- GATE-COMPLETE — The checkbox is checked (`[x]`) — ✅ PASS: 3/3 TC checkboxes `[x]` (per the real `gate.mjs` re-run above: `11 PASS, 0 FAIL, 2 PENDING-GUARDIAN`).
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with command/output for every TC — ✅ PASS: `[GATE-COMPLETE: TC-01]`, `[GATE-COMPLETE: TC-02]`, `[GATE-COMPLETE: TC-03]` entries are present above in this Evidence Log, each with command, exit code, and output.
- GATE-COMPLETE — One of Test written / Test skipped (with reason) is recorded for every Test Plan row — ✅ PASS: all 3 `## Test Plan` rows now carry a test reference (TC-01/TC-03 name `examples/__tests__/verify-workspace-project-authority-gitdir-leak.test.ts`; TC-02 names `run-all-scans.mjs --affected --context pr`).
- GATE-COMPLETE — No TC-N is silently unaddressed — ✅ PASS: same evidence as above; every row carries a reference.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]` — ✅ PASS: 3/3 `[x]`.
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows — ✅ PASS: same evidence as above; the TC-03 row's Notes column now names the regression test file explicitly, resolving the earlier `[GATE-DONE] — ❌ FAIL | 2026-09-07` entry above (which cited "TC-03: no test reference and no skip reason") against the working-tree text this entry reads.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/` — ✅ PASS: `## Tasks` names `.agents/tasks/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md`, which exists.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, no pending or blocked item — ✅ PASS: 2/2 tasks `[x]` in that Task file, none blocked/pending.

**Verdict:** all 13 GATE-DONE (lane L1) criteria PASS — the ordering check, the 2 criteria this guardian was dispatched to judge, and the 11 the mechanical evaluator judges, re-verified live in this entry rather than assumed. The prior `[GATE-DONE] — ❌ FAIL | 2026-09-07` entry above is superseded: its cited defect (TC-03 lacking a test reference) is fixed in the current (uncommitted) Test Plan text, confirmed above.

**Judged by:** `backlog-gate-guard` (2 `PENDING-GUARDIAN` criteria — Plan-completeness and no-blocked/pending) + `gate.mjs` mechanical evaluator (ordering + 11 criteria, re-run live with real `--verify-cmd` values in this invocation)
**Judged at:** HEAD `37042fc149cc` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/todo/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` blob `aede3032afd7` (modified)
