---
status: approved
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

| TC-ID | Test Type | Tool / Approach                                                     | Notes                                                                      |
| ----- | --------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| TC-01 | Unit      | `vitest run verify-workspace-project-authority-gitdir-leak.test.ts`  | RED with the fix reverted (WorkspaceAuthorityRequiredError), GREEN with it |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                          | Regression — the affected set, not the full suite                             |
| TC-03 | Suite     | `pnpm scenario:verify` (agent-framework's full owner scenario chain) | Whole chain, not only the new test — proves no other scenario regressed       |

## User Execution Test Scenarios

Not applicable — this is a fix to an internal scenario-test fixture's git-shelling robustness; no
production `IWorkspaceIdentityResolver` implementation shares this pattern, so there is no
end-user-observable surface. Verification evidence is recorded in the engineering test plan (TC-01 to
TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/BEHAVIOR-2650-arch-042-scenario-leaks-ambient-git-dir-breaking-identity-isolation-in-a-git-hoo.md` — todo

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
