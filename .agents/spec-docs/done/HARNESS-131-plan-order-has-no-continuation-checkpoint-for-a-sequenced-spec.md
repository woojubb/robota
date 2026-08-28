---
status: done
type: RULE
tags: [harness, testing]
---

# HARNESS-131: plan-order has no continuation checkpoint for a sequenced spec

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` binds every implementation path on a branch to
a planning checkpoint that must be an ancestor inside the branch's own `base..HEAD` range. The
checkpoint has one recognised shape (`isCheckpointTransition`, `:813-824`):

```js
signal !== null &&
  frontmatterStatus(task) === 'in-progress' &&
  frontmatterStatus(spec) === 'in-progress' &&
  frontmatterStatus(parentTask) !== 'in-progress' &&
  frontmatterStatus(parentSpec) !== 'in-progress' &&
  gateImplementPassCount(parentSpec) === 0 &&
  gateImplementPassCount(spec, { basename, signal }) === 1;
```

and `completeGateImplementEntry` (`:430-439`) accepts one status line, `approved → in-progress`.
A spec whose delivery is sequenced across PRs is `in-progress` with one PASS at the base of its
second branch, so no commit on that branch can be a checkpoint: the parent is already
`in-progress`, and the parent count is already 1. The branch's implementation is then refused as
"no planning checkpoint ancestor" on the staged path and "implementation exists with no planning
checkpoint" on the history path — the `scans` required check.

**Measured, 2026-08-28, `origin/develop` `c59e9d028`.** RULE-016 (issue #2403) was approved on the
direct route as one recommendation gate with two sequenced PRs — its § "Delivery — two sequenced
PRs, and why" states the cause: the `review-gate` job checks out the base revision, so the step that
invokes the PR-body judge cannot land in the PR that adds the judge. PR #2409 (PR 1) is merged; the
spec sits in `active/`, `status: in-progress`, one GATE-IMPLEMENT PASS. On a branch cut from
`c59e9d028` with PR 2's twelve paths staged (the held patch `pr2.patch`: ten modified files, the new memory record, and the `verify-like-ci` test corrected after the first run — re-measured 2026-08-28 against that patch):

```
$ HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs --staged
✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.
::examined:: 12 staged path(s)
```

The history path yields the same once committed. Nothing in the five gate runs the spec passed
(GATE-WRITE ×3, GATE-APPROVAL, GATE-IMPLEMENT) asks whether the delivery a spec states is one the
checkpoint scan can accept; the catalogue's GATE-IMPLEMENT (`gate-catalogue.md` § GATE-IMPLEMENT,
prior-gate map line 77) takes `approved` as its only input state.

**Reproduction condition.** Any spec whose § Decision sequences delivery across more than one PR, at
the branch of its second or later PR.

## Prior Art Research

Waived: the defect and its remedy are internal to this repository's own scan and gate catalogue.
No external product defines a "planning checkpoint"; the remedy reuses the repository's own
GATE-IMPLEMENT form.

## User Execution Test Scenarios

Not applicable — `SCENARIO DRAFTED: not-applicable | 0` (recorded in the paired Task). One
additional checkpoint form in a repository verification scan, its fixture, and the catalogue
sentence that declares it; no product surface.

## Depth verdict

LOCAL to the scan's checkpoint definition, the catalogue section that owns the form, the rule
section that states the mandate and the two skill sections that dispatch it. The
sibling fact that evidence forms are declared in the scan rather than the catalogue is HARNESS-128
(issue #2394) and is not changed here; this item follows the existing pattern (the catalogue text
names the status line, the parser accepts it) so that HARNESS-128's eventual fix covers both forms.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — `completeGateImplementEntry` accepts a
  second status line, the continuation form; `isCheckpointTransition` gains the continuation
  branch; both history and staged paths inherit it because they call the same function (`:862`,
  `:1162`, `:1299`, `:1419`).
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — the fixture cases.
- `.agents/specs/gate-catalogue.md` § GATE-IMPLEMENT — enumerates the continuation: the input state
  it takes (`in-progress`, when the spec's § Decision sequences delivery), the status line
  `in-progress → in-progress (continuation)`, and its own criteria list; the entry-format block
  declares the parenthetical annotation. The catalogue states no mandate (its charter, lines 7–9).
- `.agents/rules/backlog-execution.md` § Pre-implementation planning checkpoint — the mandate: a
  later PR of a sequenced spec MUST open with a continuation checkpoint (the rule's existing
  `Enforced by: user-execution-plan-order` covers it).
- `.agents/skills/backlog-pipeline/SKILL.md` § State Machine — the conditional row that dispatches
  GATE-IMPLEMENT (continuation) on an `in-progress` document whose branch has no checkpoint.
- `.agents/skills/backlog-execution-orchestrator/SKILL.md` Phase 2.5 — the continuation entry
  point (Phases 1–2 already ran for the spec; enter at 2.5, commit the entry as the branch's
  first commit).

### Alternatives Considered

- **A1 — a continuation checkpoint, re-recording GATE-IMPLEMENT (chosen).** The second branch's
  first commit is pair-only and appends one more `### [GATE-IMPLEMENT] — ✅ PASS` entry to the
  spec, bound to the same exact PLAN signal, whose status line is
  `**Status upgrade:** in-progress → in-progress (continuation)`. The scan recognises a commit as
  a continuation checkpoint when parent and child pairs are both `in-progress`, the parent holds
  ≥ 1 complete PASS entry, and the child holds exactly one more bound entry than the parent, in
  continuation form. The single-candidate ambiguity refusal, the implementation-before-checkpoint
  refusal and the staged mirror are unchanged because they sit around `isCheckpointTransition`;
  candidate DISCOVERY is not, and changes with it. The continuation commit touches the spec
  only (the Task has nothing to change), so the pair is identified by the active spec path in the
  commit's paths plus the paired Task present in the commit's TREE — today's `activePairCandidates`
  needs both paths in the diff, which a first checkpoint always has and a continuation never does.
  Pro: the branch is bound to the exact pair
  by a guardian-judged entry (the guard re-runs the GATE-IMPLEMENT criteria: Task binding, PLAN
  outcome, whole-worktree inventory), and the catalogue owns the form. Con: one more accepted
  status line in a parser that HARNESS-128 says should read the catalogue.
- **A2 — treat an `in-progress` pair at the base as the ancestor.** The checkpoint literally IS an
  ancestor of the second branch (on the base). Pro: no new form, no guardian run, nothing to write. Rejected: with five `in-progress` specs in `active/`
  today, "some active spec exists at base" binds a branch to nothing; the scan's purpose is the
  binding.
- **A3 — one PR per spec; a new Task/spec pair for each later PR.** Pro: no scan or catalogue change at all — every branch carries a first-form checkpoint. Rejected by the owner's decision
  on RULE-016 ("spec 하나, 게이트 하나") and by § PR Unit Rule's "sequential PRs on the same seam";
  a second planning unit per continuation would also multiply gate runs for one cause.
- **A4 — an acknowledgement environment variable that excuses the branch.** Pro: one line, no fixture. Rejected: an excuse is
  not a binding, and the `scans` check has no environment to read it from.

### Decision

A1. What a later PR's checkpoint must attest differs from the first: PLAN-before-implementation is
already an ancestor; what is missing is WHICH pair this branch implements, that the spec AUTHORISES
a later PR (otherwise any `in-progress` spec is an open-ended licence), and that the sequencing was
honoured (the preceding PR's merge is an ancestor of the branch base). Those are judgements, so the
continuation checkpoint is a GATE-IMPLEMENT re-run judged by `backlog-gate-guard` on the
`in-progress` document — the same gate NAME (the scan keys `canonicalPassEntries` on it; a second
name would put one fact under two parsers), a distinct status line
`in-progress → in-progress (continuation)`, and a distinct criteria list. Each fact lands with its
owner: the mandate in `backlog-execution.md` (the catalogue states no mandate), the form and
criteria in the catalogue, the dispatch in `backlog-pipeline` and the orchestrator's Phase 2.5, the
recognition in the scan. The parser accepts exactly that line; the commit touches the spec only and
is discovered as a candidate by the active spec path plus the Task in the commit's tree. The
RULE-016 spec needs no change: its § Delivery already states the spec stays `active` across both
PRs and names PR 2's artifacts, which is what the continuation criteria read; PR 2 lands after this
item with a continuation checkpoint as its first commit. A malformed entry on the unrecognised path
is refused with a misleading reason today for both forms — issue #2420, separate.

**Landing path.** This item's own branch carries a first-form checkpoint (it is a new spec), so it
passes the current scan; nothing circular.

### Architecture Review Checklist

- [x] Affected package/layer list complete — one scan, its test file, the catalogue, one rule section, two skills
- [x] Sibling scan complete — `N/A for new-surface placement`: no package, app, presentation or
      interface surface. Sibling readers of the GATE-IMPLEMENT entry: `gateImplementPassCount` is
      the only consumer of `completeGateImplementEntry`; `scan-standing-delegation-evidence.mjs`
      reads GATE-APPROVAL, not GATE-IMPLEMENT.
- [x] At least 2 alternatives reviewed — A1–A4
- [x] Decision rationale documented — the binding survives a sequenced delivery because the
      guardian re-records the gate on the same pair; the catalogue owns the form

## Fallback & Degradation Declaration

None. A commit that is not a first-form or continuation-form checkpoint is judged exactly as today;
nothing falls back.

## Solution

1. `completeGateImplementEntry` accepts `**Status upgrade:** approved → in-progress` or
   `**Status upgrade:** in-progress → in-progress (continuation)`; a helper reports which form an
   entry carries.
   Pair identification on the history path, the secondary-candidate check and the staged path gains
   the continuation shape: an active spec path in the change set whose paired Task exists in the
   resulting tree (`continuationPairCandidates`), alongside today's both-paths shape.
2. `isCheckpointTransition` returns true for the first form as today, OR for the continuation
   form: `signal !== null`, task and spec `in-progress`, parent task and spec `in-progress`,
   `gateImplementPassCount(parentSpec, binding) >= 1` — the prior PASS bound to the SAME exact
   PLAN signal, so a continuation that re-plans the outcome is not a continuation (that is scope
   growth, routed by the orchestrator's Phase 3 "return to phase 1"),
   `gateImplementPassCount(spec, binding) === gateImplementPassCount(parentSpec, binding) + 1`,
   and the entry added is in continuation form.
3. `gate-catalogue.md` § GATE-IMPLEMENT: a "Continuation" paragraph stating the input state it
   takes (`in-progress`, when § Decision sequences delivery) and its criteria as a plain numbered
   list — a prior GATE-IMPLEMENT PASS present; § Decision sequences delivery and names this PR's
   artifacts; the preceding PR's merge commit is an ancestor of the branch base; Task binding and
   PLAN signal unchanged; the whole-worktree inventory as for the first form — recorded with the
   status line above. It adds no second `- [ ]` worktree item and no second
   `**Evidence to record on PASS:**` paragraph (the test file pins exactly one of each). The
   entry-format block declares the parenthetical annotation. The prior-gate map gains the row
   `GATE-IMPLEMENT (continuation) | GATE-IMPLEMENT | in-progress`.
4. `backlog-execution.md` § Pre-implementation planning checkpoint: one paragraph — a work unit
   whose spec sequences delivery MUST open each later PR's branch with a continuation checkpoint,
   committed alone with the pair before any implementation path; the first checkpoint on the base
   does not bind a later branch.
5. `backlog-pipeline/SKILL.md` § State Machine: the conditional row, whose condition names the
   observable the dispatcher reads — `git log <base>..HEAD -- .agents/spec-docs/active/<ID>.md`
   is empty (no checkpoint of this pair on this branch); `backlog-execution-orchestrator` Phase
   2.5: the continuation entry point.
6. `evaluatePlanTexts`' refusal names both forms it judged.
7. Fixture cases in the test file; a catalogue-binding assertion that the status line the scan
   accepts is present verbatim in the catalogue's GATE-IMPLEMENT section; the existing shape
   assertions (one worktree item, one evidence paragraph) stay green.

## Affected Files

| File                                                                | Change                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `scripts/harness/scan-user-execution-plan-order.mjs`                | continuation status line accepted; continuation checkpoint branch                               |
| `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` | continuation acceptance, refusals, staged mirror, catalogue binding                             |
| `.agents/specs/gate-catalogue.md`                                   | § GATE-IMPLEMENT continuation paragraph + criteria; format-block annotation; prior-gate map row |
| `.agents/rules/backlog-execution.md`                                | § Pre-implementation planning checkpoint: the continuation mandate                              |
| `.agents/skills/backlog-pipeline/SKILL.md`                          | § State Machine: the conditional continuation row                                               |
| `.agents/skills/backlog-execution-orchestrator/SKILL.md`            | Phase 2.5: the continuation entry point                                                         |

## Completion Criteria

- [x] **TC-01** Continuation accepted: a fixture base holding an `in-progress` pair with one bound
      PASS; a branch whose first commit is pair-only and appends a second bound PASS in continuation
      form, then an implementation commit → `findHistoryFindings` returns `[]`, examined 2. Red
      before the fix (`implementation exists with no planning checkpoint`).
      **Evidence (2026-08-28):** `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` at `8f493f1bd` → "accepts a continuation checkpoint on a pair already in-progress at the base (HARNESS-131)" ✓, `Tests 91 passed (91)`; tests-only against the unpatched scan (throwaway worktree at `c59e9d028`): this case red (`expected [ {…}, {…} ] to deeply equal []`) with TC-02, TC-03 and TC-05's cases — 4 red, 87 green; `HARNESS_BASE_REF=origin/develop node scripts/harness/check-regression-red-proof.mjs --base origin/develop` → `red-proof-ok (assertion-fail)`.
- [x] **TC-02** Refusals survive: implementation committed before the continuation → refused as
      `changed before the planning checkpoint` (the continuation is the checkpoint); two
      continuation commits on one branch → `multiple planning checkpoint candidates`; a second PASS
      in first form (`approved → in-progress`) on an `in-progress` parent → not a checkpoint, the
      implementation refused; a continuation whose Task changes the PLAN signal (the prior PASS is
      bound to another signal) → not a checkpoint, the implementation refused.
      **Evidence (2026-08-28):** same run → "keeps refusing around a continuation: implementation before it, two of them, and a first-form entry (HARNESS-131)" ✓ — four arms: `changed before the planning checkpoint`; `multiple planning checkpoint candidates`; first-form second entry → `implementation exists with no planning checkpoint`; re-planned PLAN signal (`automatable | 1` on a `not-applicable | 0` prior PASS) → `no planning checkpoint`.
- [x] **TC-03** Staged mirror: with the continuation committed, `findStagedFindings` on staged
      implementation → `[]`; without it → `staged implementation has no planning checkpoint
ancestor` (unchanged); the continuation itself staged (spec-only, the hook's shape) → `[]`. A
      staged spec-only entry in the FIRST form on an `in-progress` pair is a discovered candidate that fails the form, and its refusal names both forms — it begins
      `checkpoint is neither the first GATE-IMPLEMENT PASS` and contains
      `nor one continuation PASS` (Solution step 6).
      **Evidence (2026-08-28):** same run → "mirrors the continuation on the staged path (HARNESS-131)" ✓ — without the continuation `staged implementation has no planning checkpoint ancestor`; the continuation itself staged → `[]`; with it committed and implementation staged → `[]`; a staged first-form entry → message matching `/checkpoint is neither the first GATE-IMPLEMENT PASS .* nor one continuation PASS/`.
- [x] **TC-04** Live: in a throwaway worktree at THIS branch's tip after the fix commit (so the
      pre-commit hook judges with the fixed scan; the hook is never bypassed), with
      `HARNESS_BASE_REF=<tip>` exported: a continuation entry appended to the real RULE-016 spec is
      committed through the hook (the staged proposal path, live), then PR 2's held patch is staged
      → the scan run FROM the worktree reports no finding, `::examined:: 12 staged path(s)`, exit 0;
      tip SHA and continuation SHA recorded.
      **Evidence (2026-08-28):** throwaway worktree at this branch's fix commit `4e575b73c` (the same tree as `8f493f1bd`, which only re-typed the message `feat` → `fix`), `HARNESS_BASE_REF=4e575b73c`: the continuation entry (`held/rule016-continuation.md`) appended to the real `.agents/spec-docs/active/RULE-016-…md` and committed THROUGH the pre-commit hook → `cda92c928` (parent `4e575b73c`; the hook's own fixed scan accepted the spec-only staged continuation); PR 2's held patch applied and staged → scan run FROM the worktree: no finding, `::examined:: 12 staged path(s)`, exit 0.
- [x] **TC-05** Catalogue binding: the test reads `.agents/specs/gate-catalogue.md` § GATE-IMPLEMENT
      and asserts the continuation status line the scan accepts appears there verbatim; removing
      the sentence from the catalogue makes the test red. The existing shape assertions (exactly
      one `- [ ]` worktree item, one `**Evidence to record on PASS:**` paragraph) stay green.
      `backlog-execution.md` § Pre-implementation planning checkpoint contains the MUST sentence,
      `backlog-pipeline/SKILL.md` the continuation row, the orchestrator skill the Phase 2.5 entry
      (`grep -c continuation` ≥ 1 in each, recorded). The rule paragraph is prose under the
      existing § Pre-implementation planning checkpoint, which `new-rule-declares-enforcement`
      does not judge (it judges added sections and bullets — 0 sections judged on this diff);
      its enforcement is that section's existing `Enforced by: user-execution-plan-order` line.
      **Evidence (2026-08-28):** same run → "accepts the continuation status line the catalogue declares (HARNESS-131)" ✓ (red in the tests-only run: the catalogue lacked the line); the pre-existing shape assertions (one `- [ ]` worktree item, one `**Evidence to record on PASS:**` paragraph) ✓ in the same run. `grep -c continuation`: `.agents/rules/backlog-execution.md` → 2, `.agents/skills/backlog-pipeline/SKILL.md` → 1, `.agents/skills/backlog-execution-orchestrator/SKILL.md` → 2 (recorded at `8f493f1bd`); `new-rule-declares-enforcement` judges 0 sections on this diff (prose paragraph under the existing section, whose `Enforced by: user-execution-plan-order` line stands).
- [x] **TC-06** Applied-check mutation: removing the continuation branch from
      `isCheckpointTransition` makes the TC-01 case, the TC-02 refusals case (its
      implementation-before-continuation arm, whose premise is that the continuation is the
      checkpoint) and the TC-03 case red — three cases, all HARNESS-131 cases — and no case outside
      them; `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      passes; `pnpm harness:scan` exit 0.
      **Evidence (2026-08-28):** continuation branch of `isCheckpointTransition` replaced by `return false` at `8f493f1bd` → `3 failed | 88 passed (91)`: exactly the TC-01, TC-02 and TC-03 cases; unbinding the parent PASS (`gateImplementPassCount(parentSpec) >= 1`) → `1 failed | 90 passed`: the TC-02 case (its re-planned arm); restored → `91 passed (91)`, `git status` clean. `HARNESS_BASE_REF=origin/develop pnpm harness:scan` → see the GATE-VERIFY entry for the count and exit code.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                           | Notes                                                                                                                                                                                                                                                                         |
| ----- | ----------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration | vitest, fixture repository with a continuation commit then implementation                                 | **Test written:** `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs > user-execution PLAN order — branch history > accepts a continuation checkpoint on a pair already in-progress at the base (HARNESS-131)`; red-proof recorded before the branch is added |
| TC-02 | Integration | vitest, the four refusal fixtures                                                                         | **Test written:** `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs > … > keeps refusing around a continuation: implementation before it, two of them, and a first-form entry (HARNESS-131)` (four arms)                                                     |
| TC-03 | Integration | vitest, staged path with and without the continuation; a staged first-form entry's refusal text           | **Test written:** `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs > … > mirrors the continuation on the staged path (HARNESS-131)`                                                                                                                         |
| TC-04 | Integration | the fixed scan run inside a worktree on the real RULE-016 pair with PR 2 staged                           | **Test skipped:** a live run on the real RULE-016 pair through the pre-commit hook in a throwaway worktree is not a fixture — recorded once with the tip and continuation SHAs in the TC-04 evidence                                                                          |
| TC-05 | Unit        | vitest reads the catalogue section and asserts the accepted status line; grep the rule and the two skills | **Test written:** `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs > … > accepts the continuation status line the catalogue declares (HARNESS-131)`; the rule/skill greps recorded in the TC-05 evidence                                                    |
| TC-06 | Mutation    | remove the continuation branch, run the file, restore; suite + `harness:scan`                             | **Test skipped:** a mutation of the shipped source cannot be a committed test — both mutations recorded in the TC-06 evidence; `git diff --stat` empty after restore                                                                                                          |

## Tasks

- [x] `.agents/tasks/completed/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` — done 2026-08-28

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-28

**Status remains:** draft
**Failed criteria:**

- Problem — concrete symptom: the quoted measurement does not reproduce as quoted. The document states "PR 2's twelve paths staged (the held patch `pr2.patch`: ten modified files, the new memory record, and the `verify-like-ci` test corrected after the first run — re-measured 2026-08-28 against that patch)" and quotes `::examined:: 12 staged path(s)`. Re-run by this guard in a throwaway worktree detached at `origin/develop` `c59e9d028` (`pnpm install --offline --frozen-lockfile --ignore-scripts`, `git apply` of the held `pr2.patch` — mtime 2026-08-28 21:54:48, 12 `diff --git` entries — then `git add -A`; `git status` showed nothing outside the patch): `HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs --staged` printed `✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.` verbatim, then `::examined:: 12 staged path(s)`, exit 1. The staged set is the patch's 12 paths (`.agents/memory/MEMORY.md`, `.agents/memory/pr-body-background-first-no-session-link.md`, `.agents/rules/agent-conduct.md`, `.agents/rules/backlog-execution.md`, `.agents/specs/harness-composition-inventory.md`, `.github/required-status-checks.json`, `.github/workflows/review-gate.yml`, `scripts/harness/__tests__/check-pr-body.test.mjs`, `scripts/harness/__tests__/verify-like-ci.test.mjs`, `scripts/harness/ci-mirror-map.mjs`, `scripts/harness/promote.mjs`, `scripts/harness/verify-like-ci.mjs`). The refusal is real; the count the document quotes is not what the cited artifact produces, and TC-04 fixes its expected observable at `::examined:: 12 staged path(s)`, which the held patch cannot yield.
  **Required action:** re-measure against the held patch and quote the actual output (or hold the eleven-path patch the measurement was taken from and say which paths it contains); align TC-04's expected examined count with the artifact it names.
- Architecture Review — Alternatives Considered has ≥2 entries with pro/con for each: A1 carries `Pro:` and `Con:`; A2 carries an argument for it ("literally IS an ancestor") and a `Rejected:` con; A3 and A4 carry only `Rejected: …` with no stated benefit.
  **Required action:** give A3 and A4 (and A2 explicitly) a Pro line stating what each would have bought, so the rejection is a weighed trade rather than a bare dismissal.

Criteria met (recorded so the re-run can diff against them):

- Ordering: entry gate, no prior gate required; `status: draft` at `.agents/spec-docs/draft/` matches `spec-workflow.md` § Spec-Document Status and Lifecycle Folders (draft → `draft/`). Document was moved from `backlog/` to `draft/` by the orchestrator before this entry; content unchanged (12773 bytes, 201 lines). Evidence Log was empty (0 prior `### [GATE-` entries) — first run.
- Frontmatter: file opens with `---`; `status: draft`; `type: RULE` (one of the 11); `tags: [harness, testing]`.
- Problem — reproduction condition: present ("Any spec whose § Decision sequences delivery across more than one PR, at the branch of its second or later PR"). No `TBD`/`TODO` anywhere in the file.
- Problem — other cited facts verified on `c59e9d028`: `isCheckpointTransition` is `scan-user-execution-plan-order.mjs:813-824` and the quoted seven-conjunct body matches; `completeGateImplementEntry` is `:430-439` with the single accepted line `approved → in-progress` at `:432`; call sites `:862`, `:1162`, `:1299`, `:1419` exist; `gate-catalogue.md:77` is the `GATE-IMPLEMENT | GATE-APPROVAL | approved` row; RULE-016 spec is `active/`, `status: in-progress`, carries GATE-WRITE ×3 (lines 349/365/381), GATE-APPROVAL (397), GATE-IMPLEMENT ×1 (412); its § "Delivery — two sequenced PRs, and why" is at line 183; the approval entry (line 405) records the owner's "확인 — spec 하나, 게이트 하나 (권장)"; `backlog-execution.md:344` carries "sequential PRs on the same seam"; `active/` holds exactly 5 `in-progress` specs (A2's figure); issue #2418 OPEN, issue #2403 OPEN, issue #2394 OPEN, PR #2409 MERGED 2026-08-28 into develop.
- Prior Art Research: section present; explicit `Waived: the defect and its remedy are internal to this repository's own scan and gate catalogue…` line — opt-out form per `research.md:36`. Research-feeds-Decision: N/A under the waiver; the Decision rests on verified repository facts instead.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan `[x]` with `N/A for new-surface placement` and named sibling readers — verified: `completeGateImplementEntry` is referenced only inside `scan-user-execution-plan-order.mjs`; `scan-standing-delegation-evidence.mjs` matches `[GATE-APPROVAL]` only. Decision names the trade (binding survives sequenced delivery via a guardian-recorded re-run; cost is one more parser-accepted line pending HARNESS-128). New-surface placement: N/A — one scan, its test file, one catalogue section; no package/app/surface or layer reclassification.
- Completion Criteria: TC-01…TC-06 all prefixed; parser form, checkpoint branch, staged mirror, live run, catalogue binding, and mutation each have a criterion; command/observable form throughout; none of "works correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: present; 6 rows for 6 TC-N (count matches); every row has a Test Type and Tool/Approach, no "TBD"; no row uses a `manual` tool, so the Notes rule is N/A.
- Structure: `## Tasks` present with the unchecked task-path placeholder; `## Evidence Log` present and was empty; no `## Status` or `## Classification` body sections (sections: Problem, Prior Art Research, User Execution Test Scenarios, Depth verdict, Architecture Review, Fallback & Degradation Declaration, Solution, Affected Files, Completion Criteria, Test Plan, Tasks, Evidence Log).

### [GATE-WRITE] — ❌ FAIL | 2026-08-28

**Status remains:** draft
**Failed criteria:**

- Completion Criteria — at least 1 criterion per distinct feature or sub-item: § Solution step 6 ("`evaluatePlanTexts`' refusal names both forms it judged") has no TC. Today that refusal is `scan-user-execution-plan-order.mjs:863-864`, `checkpoint does not add the first GATE-IMPLEMENT PASS while transitioning the exact Task/spec pair into in-progress.`; step 6 changes its text, and no TC-01…TC-06 asserts what the changed text must contain. TC-02's third arm ("a second PASS in first form … on an `in-progress` parent → not a checkpoint, the implementation refused") names no message, while its first two arms do (`changed before the planning checkpoint`, `multiple planning checkpoint candidates`). Steps 1–5 and 7 each map to a TC (1/2 → TC-01–TC-03, 3–5 → TC-05, 7 → TC-01/TC-02/TC-05, plus TC-04 live and TC-06 mutation); step 6 alone could be skipped with every TC green.
  **Required action:** add a TC (or an arm of TC-02) stating the observable of step 6 — the refusal text an `in-progress` pair with a non-checkpoint entry receives, naming both accepted forms — and its Test Plan row; or remove step 6 from § Solution if it is not part of this item.

Criteria met on this run (second GATE-WRITE run; first entry above kept):

- Ordering: entry gate, no prior gate required. `status: draft` in frontmatter; file at `.agents/spec-docs/draft/`, which `spec-workflow.md:167` maps to `draft`. Branch `fix/2418-plan-order-continuation-checkpoint` at `c59e9d028` = `origin/develop`; the spec and its paired Task are the only untracked paths; nothing implemented.
- Frontmatter: opens with `---`; `status: draft`; `type: RULE` (one of the 11); `tags: [harness, testing]`.
- Problem — concrete symptom, re-measured by this guard (first run's failure): throwaway worktree detached at `origin/develop` `c59e9d028`, `git apply` of the held `pr2.patch` (mtime 2026-08-28 21:54:48, 39133 bytes, 12 `diff --git` entries), `git add -A` → 11 `M` + 1 `A` (`.agents/memory/pr-body-background-first-no-session-link.md`), nothing else in `git status`; `HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs --staged` run FROM the worktree printed `✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.` then `::examined:: 12 staged path(s)`, exit 1 — matches the quoted block verbatim; "ten modified files, the new memory record, and the `verify-like-ci` test" = 12 is consistent with the staged set. Worktree removed after the run. Reproduction condition present (line 50–51). No `TBD`/`TODO` in the body; the only occurrences are quotations inside the first evidence entry.
- Problem — other cited facts re-verified on `c59e9d028`: `isCheckpointTransition` `:813-824` matches the quoted body; `completeGateImplementEntry` `:430-439`, single accepted line at `:432`; call sites `:862`, `:1162`, `:1299`, `:1419`; `activePairCandidates` `:124-138` intersects Task paths with `active/` spec paths in the same path list (the "both paths in the diff" claim); `gate-catalogue.md:77` is `GATE-IMPLEMENT | GATE-APPROVAL | approved`, lines 7–9 the "states no new mandate" charter; the test file pins exactly one worktree `- [ ]` item (`:2054-2059`) and exactly one `**Evidence to record on PASS:**` paragraph (`:2067-2071`); RULE-016 spec in `active/`, `status: in-progress`, GATE-WRITE ×3 (349/365/381), GATE-APPROVAL (397, owner selected "확인 — spec 하나, 게이트 하나 (권장)" at 405), GATE-IMPLEMENT ×1 (412), § "Delivery — two sequenced PRs, and why" at 183; `active/` holds exactly 5 `in-progress` specs; `backlog-execution.md:372` § Pre-implementation planning checkpoint with `Enforced by: \`user-execution-plan-order\``at`:392`and "sequential PRs on the same seam" at`:344`; `backlog-pipeline/SKILL.md:47`§ State Machine (dispatch table by status, one row per status, no conditional row today);`backlog-execution-orchestrator/SKILL.md:76`§ Phase 2.5 — Planning checkpoint;`scan-new-rule-declares-enforcement.mjs`exists and matches`Enforced by:` (`:49`); issues #2418, #2420, #2394, #2403 OPEN; PR #2409 MERGED 2026-08-28T12:50:45Z.
- Prior Art Research: section present with an explicit `Waived: the defect and its remedy are internal to this repository's own scan and gate catalogue…` line — the opt-out form `research.md` § Enforcement names. Research-feeds-Decision: N/A under the waiver; the Decision rests on the verified repository facts above.
- Architecture Review Checklist: all 4 items `[x]`. Item 1 names six surfaces (one scan, its test file, the catalogue, one rule section, two skills) — matches the six Affected Scope bullets and the six § Affected Files rows. Sibling scan `[x]` with `N/A for new-surface placement` plus named sibling readers, verified: `completeGateImplementEntry` is referenced by no other script under `scripts/`; `scan-standing-delegation-evidence.mjs` matches `[GATE-APPROVAL]` only. Alternatives: A1 `Pro:`/`Con:`; A2 `Pro:` ("no new form, no guardian run, nothing to write") / `Rejected:`; A3 `Pro:` ("no scan or catalogue change at all") / `Rejected:`; A4 `Pro:` ("one line, no fixture") / `Rejected:` — first run's second failure resolved. Decision names the trade (same gate NAME so one fact has one parser, a distinct status line and criteria list; cost is one more parser-accepted line pending HARNESS-128) and states each fact's owner (mandate → rule, form/criteria → catalogue, dispatch → pipeline + Phase 2.5, recognition → scan). New-surface placement: N/A — no package/app/presentation/interface surface, no layer reclassification.
- Completion Criteria — other items: TC-01…TC-06 all prefixed; every criterion in command or observable form; none of "works correctly" / "no errors" / "implemented" / "displays correctly" in the body (checked case-insensitively; `implemented` absent).
- Test Plan: present; 6 rows for 6 TC-N (count matches); every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses a `manual` tool, so the Notes requirement is N/A.
- Structure: `## Tasks` present with the unchecked task-path placeholder; `## Evidence Log` present — not empty because this is a re-run, and it holds only the prior GATE-WRITE FAIL (no other gate's evidence), which is what a second run expects; no `## Status` or `## Classification` body sections (sections: Problem, Prior Art Research, User Execution Test Scenarios, Depth verdict, Architecture Review, Fallback & Degradation Declaration, Solution, Affected Files, Completion Criteria, Test Plan, Tasks, Evidence Log).

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Ordering: entry gate, no prior gate required. `status: draft` in frontmatter; file at `.agents/spec-docs/draft/`, which `spec-workflow.md:167` maps to `draft`. Branch `fix/2418-plan-order-continuation-checkpoint` at `c59e9d028` = `origin/develop`; the spec and its paired Task (`status: todo`, `SCENARIO DRAFTED: not-applicable | 0` at Task line 81) are the only untracked paths; nothing implemented. Third GATE-WRITE run; both prior FAIL entries kept above.
- Frontmatter: file opens with `---`; `status: draft`; `type: RULE` (one of the 11); `tags: [harness, testing]`.
- Problem — concrete symptom, re-measured by this guard: throwaway worktree detached at `c59e9d028`, `git apply` of the held `pr2.patch` (mtime 2026-08-28 21:54:48, 39133 bytes, 12 `diff --git` entries), `git add -A` → 11 `M` + 1 `A` (`.agents/memory/pr-body-background-first-no-session-link.md`), nothing else staged; `HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs --staged` run from the worktree printed `✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.` then `::examined:: 12 staged path(s)`, exit 1 — the quoted block verbatim. Worktree removed; this tree unchanged. Reproduction condition present ("Any spec whose § Decision sequences delivery across more than one PR, at the branch of its second or later PR"). No `TBD`/`TODO` in the body.
- Problem — other cited facts re-verified on `c59e9d028`: `isCheckpointTransition` `:813-824` matches the quoted seven-conjunct body; `completeGateImplementEntry` `:430-439`, single accepted line `approved → in-progress` at `:432`; call sites `:862`, `:1162`, `:1299`, `:1419`; `activePairCandidates` `:124-138` requires Task and `active/` spec paths in the same path list; `evaluatePlanTexts` refusal at `:863-864` is `checkpoint does not add the first GATE-IMPLEMENT PASS while transitioning the exact Task/spec pair into in-progress.` and `findStagedFindings` surfaces `stagedCheckpoint(...).problems` as findings (`:1437-1438`), so a staged candidate's form refusal is an observable of the staged path; `gate-catalogue.md:77` is `GATE-IMPLEMENT | GATE-APPROVAL | approved`, lines 7–9 the "states no new mandate" charter; RULE-016 spec in `active/`, `status: in-progress`, GATE-WRITE ×3 (349/365/381), GATE-APPROVAL (397, owner selected "확인 — spec 하나, 게이트 하나 (권장)" at 405), GATE-IMPLEMENT ×1 (412), § "Delivery — two sequenced PRs, and why" at 183; `active/` holds exactly 5 `in-progress` specs of 6; `backlog-execution.md:372` § Pre-implementation planning checkpoint, `Enforced by: \`user-execution-plan-order\``at`:392`, "sequential PRs on the same seam" at `:344`; `backlog-pipeline/SKILL.md:47`§ State Machine (no continuation row today);`backlog-execution-orchestrator/SKILL.md:76`§ Phase 2.5 (no continuation entry today);`scan-new-rule-declares-enforcement.mjs:49`matches`Enforced by:`; the test file pins exactly one worktree `- [ ]`item and one`**Evidence to record on PASS:**` paragraph (`:2054-2071`); issues #2418, #2420, #2394, #2403 OPEN; PR #2409 MERGED 2026-08-28T12:50:45Z into develop.
- Prior Art Research: section present with the explicit `Waived: the defect and its remedy are internal to this repository's own scan and gate catalogue…` line — the opt-out form `research.md:36` names. Research-feeds-Decision: N/A under the waiver; the Decision rests on the verified repository facts above.
- Architecture Review Checklist: all 4 items `[x]`. Item 1 names six surfaces, matching the six Affected Scope bullets and six § Affected Files rows. Sibling scan `[x]` with `N/A for new-surface placement` plus named sibling readers, verified: `completeGateImplementEntry` is referenced only in `scan-user-execution-plan-order.mjs`; `scan-standing-delegation-evidence.mjs` matches `[GATE-APPROVAL]` only. Alternatives: A1 `Pro:`/`Con:`; A2, A3, A4 each `Pro:`/`Rejected:` (4 entries, pro and con on every one). Decision names the trade (same gate NAME so one fact has one parser; a distinct status line and criteria list; cost is one more parser-accepted line pending HARNESS-128) and each fact's owner (mandate → rule, form/criteria → catalogue, dispatch → pipeline + Phase 2.5, recognition → scan). New-surface placement: N/A — no package/app/presentation/interface surface, no layer reclassification.
- Completion Criteria: TC-01…TC-06 all prefixed. One criterion per sub-item, including the one the second run failed on: § Solution step 6 (`evaluatePlanTexts`' refusal names both forms) is now stated as an arm of TC-03 — a staged spec-only entry in the first form on an `in-progress` pair is a discovered candidate that fails the form, refused with `checkpoint is neither the first GATE-IMPLEMENT PASS … nor one continuation PASS (\`in-progress → in-progress (continuation)\`) on a pair already in-progress`, cross-referenced "(Solution step 6)". Map: steps 1/2 → TC-01–TC-03, 3–5 → TC-05, 6 → TC-03, 7 → TC-01/TC-02/TC-05; TC-04 live, TC-06 mutation. Every criterion in command or observable form; none of "works correctly" / "no errors" / "implemented" / "displays correctly" in the body (case-insensitive).
- Test Plan: present; 6 rows for 6 TC-N (count matches). TC-03's row names the new arm ("a staged first-form entry's refusal text"). Every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses a `manual` tool, so the Notes requirement is N/A.
- Structure: `## Tasks` present with the unchecked task-path placeholder; `## Evidence Log` present — holds only the two prior GATE-WRITE FAIL entries (no other gate's evidence), as a third run expects; no `## Status` or `## Classification` body sections (sections: Problem, Prior Art Research, User Execution Test Scenarios, Depth verdict, Architecture Review, Fallback & Degradation Declaration, Solution, Affected Files, Completion Criteria, Test Plan, Tasks, Evidence Log).

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (re-run on the revised text; no transition — fourth run, after `proposal-reviewer` round-2 REVISE; the third PASS above made the `draft → review-ready` transition and this entry records no new one)

- Ordering: entry gate, no prior gate required. `status: review-ready` under `.agents/spec-docs/backlog/` agrees with the folder table (`node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0, PASS). Branch `fix/2418-plan-order-continuation-checkpoint` at `c59e9d028` = `origin/develop`; `git status --porcelain` shows exactly two untracked paths — this spec and `.agents/tasks/HARNESS-131-…md` (`status: todo`, `**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\`` at Task line 82); nothing implemented. All three prior GATE-WRITE entries kept above.
- Frontmatter: file opens with `---`; `type: RULE` (one of the 11); `tags: [harness, testing]`. `status: draft` NOT present — `status: review-ready` is what the third PASS assigned; judged N/A on a re-run, as the RULE-016 second and third entries did, reasoning carried rather than skipped.
- Problem — concrete symptom: the measured block (lines 32–48) is unchanged since the third run, which re-produced it verbatim from the held `pr2.patch` (`::examined:: 12 staged path(s)`, exit 1); not re-measured on this run. Cited code facts re-verified on `c59e9d028`: `isCheckpointTransition` `:813-824` matches the quoted seven-conjunct body; `completeGateImplementEntry` `:430-439`, single accepted line `approved → in-progress` at `:432`; `gateImplementPassCount(spec, binding)` `:796-801` filters `canonicalPassEntries` through `completeGateImplementEntry(body, binding)`, whose binding branch (`:446-461`) requires the exact Task path, a `todo`/`active` spec path and the exact `SCENARIO DRAFTED` outcome+count; RULE-016 spec in `active/`, `status: in-progress`, exactly 1 `[GATE-IMPLEMENT] — ✅ PASS`; `active/` holds 5 `in-progress` specs of 6; issues #2418 and #2420 OPEN. Reproduction condition present (lines 50–51). `grep -i "TBD\|TODO"` over the body → no match.
- Prior Art Research: section present with the explicit `Waived: the defect and its remedy are internal to this repository's own scan and gate catalogue…` line; `node scripts/harness/scan-spec-research.mjs` → "spec-research scan passed" (19 documents). Research-feeds-Decision: N/A under the waiver; the Decision rests on the verified repository facts above.
- Architecture Review Checklist: all 4 items `[x]`. Item 1 names six surfaces, matching the six Affected Scope bullets and six § Affected Files rows. Sibling scan `[x]` with `N/A for new-surface placement` plus named sibling readers (verified in the third run; text unchanged). Alternatives: A1 `Pro:`/`Con:`; A2, A3, A4 each `Pro:`/`Rejected:`. Decision names the trade (same gate NAME so one fact has one parser; distinct status line and criteria list; cost is one more parser-accepted line pending HARNESS-128) and each fact's owner. New-surface placement: N/A — no package/app/presentation/interface surface, no layer reclassification.
- Revised claims verified against `c59e9d028`: (1) § Solution step 2's `gateImplementPassCount(parentSpec, binding) >= 1` is a supported call shape — the binding branch above makes a parent PASS bound to another signal count 0, so "a continuation that re-plans the outcome is not a continuation" follows from the code; its route, the orchestrator's Phase 3 row "The scope grows beyond the endorsed recommendation → **Return to phase 1**", exists in `backlog-execution-orchestrator/SKILL.md`. (2) TC-05's enforcement claim: `scan-new-rule-declares-enforcement.mjs` opens a judged section only on an added `+###` heading (`RULE_HEADING`, `:52`) or an added list item whose first clause carries a normative keyword (`ADDED_RULE_BULLET`, `:84`, requires a `-`/`*` marker); a prose paragraph under the existing § Pre-implementation planning checkpoint opens neither, so "0 sections judged on this diff" holds for a paragraph — it would NOT hold if the mandate were written as a `MUST` bullet, which step 4 does not do. `backlog-execution.md` `Enforced by: \`user-execution-plan-order\``at`:392`is the line TC-05 names. (3) TC-04's "committed through the hook": the scan's header documents`--staged` as the Husky pre-commit mode (`:14`) and the test file pins the hook line `node scripts/harness/scan-user-execution-plan-order.mjs --staged || exit 1` (`:2174`, `:2184`), so the live staged-proposal path is real; `HARNESS_BASE_REF`is the env the measured command already uses. (4) TC-03's staged-proposal arm:`findStagedFindings`surfaces`stagedCheckpoint(...).problems` (`:1437-1438`, verified third run). (5) § Solution step 5's observable (`git log <base>..HEAD -- .agents/spec-docs/active/<ID>.md`empty) is a command;`backlog-pipeline/SKILL.md` § State Machine today dispatches by status alone (no conditional row), so the row is new. (6) § Depth verdict now names the rule section and the two skill sections, matching Affected Scope.
- Completion Criteria: TC-01…TC-06 all prefixed (6 `- [ ] **TC-` items). One criterion per sub-item after the revision: step 1 → TC-01/TC-03; step 2 (incl. the same-signal binding) → TC-01, TC-02 (fourth arm: re-planned PLAN signal → not a checkpoint); step 3 → TC-05; step 4 → TC-05 (MUST sentence, enforcement named); step 5 → TC-05 (row and Phase 2.5 grep); step 6 → TC-03 (refusal begins `checkpoint is neither the first GATE-IMPLEMENT PASS`, contains `nor one continuation PASS`); step 7 → TC-01/TC-02/TC-05/TC-06; TC-04 live. Every criterion in command or observable form; `grep -i "works correctly\|no errors\|implemented\|displays correctly"` over the body → no match.
- Test Plan: present; 6 rows for 6 TC-N (count matches). Every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses a `manual` tool, so the Notes requirement is N/A. Observation (not a GATE-WRITE criterion; recorded for the next gate): TC-02's row still reads "the three refusal fixtures" while the revised TC-02 enumerates four refusal arms (implementation-before-continuation, two continuations, first-form on an `in-progress` parent, re-planned PLAN signal) — the row's count was not updated with the arm.
- Structure: `## Tasks` present with the unchecked task-path placeholder; `## Evidence Log` present and non-empty — N/A by the catalogue's "(first GATE-WRITE run)" wording; this is the fourth run and it holds only the three prior GATE-WRITE entries (no other gate's evidence). No `## Status` / `## Classification` body sections (sections: Problem, Prior Art Research, User Execution Test Scenarios, Depth verdict, Architecture Review, Fallback & Degradation Declaration, Solution, Affected Files, Completion Criteria, Test Plan, Tasks, Evidence Log).

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 (권장)"
**Given:** 2026-08-28, this conversation

- Ordering: prior gate GATE-WRITE shows `✅ PASS` twice (entries at lines 309 and 323, both dated 2026-08-28; the third run made `draft → review-ready`, the fourth re-ran on the revised text with no transition; the two FAIL entries at 267 and 289 precede them). `status: review-ready` under `.agents/spec-docs/backlog/` is the state this gate takes as input (`spec-workflow.md:168`; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0, PASS). Branch `fix/2418-plan-order-continuation-checkpoint` at `c59e9d028` = `origin/develop` (`git rev-list --count origin/develop..HEAD` → 0); `git status --porcelain` → exactly two untracked paths, this spec and `.agents/tasks/HARNESS-131-…md` (`status: todo`, `SCENARIO DRAFTED: not-applicable | 0`); no staged or unstaged change. Context, not a criterion: after the fourth GATE-WRITE PASS two editorial corrections landed — the TC-02 Test Plan row now reads "the four refusal fixtures" (line 255; the fourth run recorded the stale "three" as an observation), and TC-06 (line 243–248) plus the Task's mutation line (Task line 77) now state the mutation reds the TC-01, TC-02 and TC-03 cases and none outside HARNESS-131. Neither touches § Architecture Review or the frontmatter; the catalogue requires no GATE-WRITE re-run for this gate.
- Route DIRECT / explicit approval in the current conversation: the dispatching orchestrator reports that on 2026-08-28, in this conversation, the owner was asked a structured question headed "GATE-APPROVAL", beginning "HARNESS-131 (issue #2418, blocks-landing) GATE-APPROVAL — Route DIRECT. spec: `.agents/spec-docs/backlog/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md`. 문제: plan-order 스캔은 첫 체크포인트(…) 한 형태만 인정하므로 (…) 결정 A1 — **계속 체크포인트** (…) 이 spec을 승인하시겠습니까?", with options "승인 (권장)" / "보류 — 질문 있음" / "거절 — A3로", and selected "승인 (권장)". "승인" is on the catalogue's explicit list. Provenance stated plainly: this guard did not observe the selection; it is the quote the `backlog-pipeline` dispatch carries into this gate run, reported as given in this document's own conversation — not relayed from another session, agent run, or document.
- Route DIRECT / directed at this spec document: the question names HARNESS-131, issue #2418 (`gh issue view 2418` → OPEN, "plan-order recognises only a first checkpoint, so the second PR of a sequenced spec cannot pass the scans check" — the paired Task's `issue:`), this file's exact path, and the chosen alternative "결정 A1 — 계속 체크포인트", which is § Decision on disk ("A1." — the continuation checkpoint, a GATE-IMPLEMENT re-run on the `in-progress` document with status line `in-progress → in-progress (continuation)`); the "거절 — A3로" option is the A3 of § Alternatives Considered (one PR per spec). No other spec document is named in the question. Route CLASS not claimed and unavailable: `parseRegistry` over `backlog-execution.md` § Delegated Approval Classes → size 0 (one placeholder row).
- No Architecture Review or frontmatter type/tags modified after approval: the spec is untracked (no git history). Its mtime is 2026-08-28T13:26:26Z, the paired Task's 13:26:26Z (same second — the round-3 restatement of TC-06 and the Task's mutation line, which the dispatch states were applied before the approval question); this gate runs at 13:29Z, and this entry is the only write after that. Frontmatter reads `type: RULE`, `tags: [harness, testing]` — identical to what every GATE-WRITE entry recorded. Checklist: 4 of 4 `[x]`; § Alternatives Considered A1–A4 and § Decision (A1) are the text the approval question summarised.
- Independent architecture validation (conditional): N/A — the condition is not met. § Affected Scope names one existing scan, its existing test file, one catalogue section, one rule section and two skill sections; no package, app, presentation or interface surface is introduced and no layer or product-family boundary is reclassified (the fourth GATE-WRITE run judged new-surface placement N/A on the same text). Recorded as context: the dispatch reports `proposal-reviewer` round 3 confirmed the design (REVISE on one TC-06 sentence only, since applied); no ENDORSE verdict is recorded in this log, and this conditional criterion is the only one that would require one.
- Evidence form: route, verbatim instruction and date carried in the `backlog-execution.md` § Delegated Approval Classes DIRECT shape; `parseEvidenceForm` → `{"route":"Approval route","instruction":"Instruction (verbatim)","classField":"Class"}`; `standingVerdict` over this file selects this entry and `classifyApproval` returns `{"route":"DIRECT"}` (1 `[GATE-APPROVAL]` entry in this file, this one); `node scripts/harness/scan-standing-delegation-evidence.mjs` → "227 approved spec document(s); 9 DIRECT, 0 CLASS, 218 frozen (218 of them with no route at all); 0 registered class(es)", exit 0, this document among the 9.
- NON-COMPLIANCE trigger (implementation before this gate): none. `grep -c continuation` → 0 in `scan-user-execution-plan-order.mjs`, `gate-catalogue.md`, `backlog-execution.md`, `backlog-pipeline/SKILL.md`, `backlog-execution-orchestrator/SKILL.md`; the test file's 10 matches are pre-existing unrelated wording (file identical to `origin/develop`); `completeGateImplementEntry` `:432` still accepts the single line `approved → in-progress`. Nothing of § Solution exists in the tree.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28

**Status upgrade:** approved → in-progress

- Ordering — prior gate: `[GATE-APPROVAL] — ✅ PASS | 2026-08-28` above (line 337), route `DIRECT`, instruction "승인 (권장)" quoted verbatim, with per-criterion evidence lines and a `classifyApproval` → `{"route":"DIRECT"}` parse result — not a bare PASS.
- Ordering — input state: frontmatter `status: approved`; file under `.agents/spec-docs/todo/`, which `spec-workflow.md:169` maps to `approved`; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → `violations=0 result=PASS`. Branch `fix/2418-plan-order-continuation-checkpoint`, HEAD `9fb289eca` (one commit on `origin/develop` `c59e9d028`; `git diff --stat origin/develop...HEAD` → exactly this spec 350/0 and the Task 95/0).
- Task file created: `.agents/tasks/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` exists, tracked in `9fb289eca` (95 lines), `status: todo`, `issue: …/2418` (`gh issue view 2418` → OPEN, "plan-order recognises only a first checkpoint, so the second PR of a sequenced spec cannot pass the scans check"), H1 begins `HARNESS-131:`, and its `## Bound spec document` names this file's exact path.
- Tasks file path recorded in `## Tasks`: yes — the single row names `.agents/tasks/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md`, bound to `.agents/spec-docs/todo/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` (this document; the pair binds both ways).
- Tasks correspond to Completion Criteria: the Task carries no checkbox plan (per `.agents/tasks/README.md` a Task is the problem record, not a breakdown — the reading the HARNESS-129 entry of 2026-08-28 applied); its `## Test Plan` holds 6 bullets mapping one-to-one to the 6 TC-Ns — bullet 1 (history fixture: `in-progress` pair with one bound PASS at the base, pair-only continuation commit, then implementation → no finding; red before the fix) → TC-01; bullet 2 (four refusals: implementation before the continuation, two continuation commits, a first-form second PASS on an `in-progress` parent, a continuation whose Task changes the PLAN signal) → TC-02; bullet 3 (staged path accepted with the continuation committed, refusal unchanged without it) → TC-03; bullet 4 (live throwaway worktree at this branch's tip, `HARNESS_BASE_REF=<tip>`, RULE-016 continuation committed through the hook, PR 2's patch staged, examined count and exit code recorded) → TC-04; bullet 5 (catalogue binding assertion, the rule MUST sentence, pipeline row and Phase 2.5 entry by grep, `new-rule-declares-enforcement` passes) → TC-05; bullet 6 (mutation reds TC-01, TC-02, TC-03 and nothing outside HARNESS-131; `pnpm harness:scan` exit 0) → TC-06. Observed drift, not a gap: bullet 3 omits TC-03's two further arms (the continuation itself staged → `[]`; a staged first-form entry's refusal text naming both forms).
- Task `## Test Plan` ≥ 50 chars: section is 1878 bytes; `node scripts/harness/scan-test-plan.mjs` → exit 0, 37 documents checked (11 live incl. `todo/`) [AF-24].
- Exact PLAN outcome: the Task's `## User Execution Test Scenarios` carries exactly one `**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\`` line (`grep -c`of the exact line → 1; the form`exactPlanSignal`at`:807`parses) followed by the concrete reason (one additional checkpoint form in a repository verification scan, its fixture and the catalogue sentence; no package, app, CLI, TUI or published API change; the capability is reachable only through the scan's own invocation), which matches the Task README's not-applicable rule; a`DONE-GATE-STAGE-1`PASS is not required for`not-applicable`. Subject-bound PLAN ledger record present, uncommitted, in `.agents/loop-runs/user-execution-scenario.jsonl` (`git diff --numstat`→`1 0`; the only HARNESS-131 record in the file): `runId r20260828125845`, `opened 2026-08-28T12:58:45.767Z`, `closed 2026-08-28T12:58:50.261Z`, `terminal converged`, `roundFindings [0]`, `extensions {}`, `ref`=`.agents/tasks/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md`(exact Task path; satisfies`validLoopRecord`, `successfulLoopRecord`and`exactSubjectRef`). Not retrospective: the record closed at 12:58Z, before the GATE-APPROVAL run (13:29Z per its entry) and before the pair commit `9fb289eca` (13:31:06Z).
- Whole worktree path inventory (`git status --porcelain --untracked-files=all`, all paths): ` M .agents/loop-runs/user-execution-scenario.jsonl` — one appended line; nothing else staged, unstaged, untracked, renamed or deleted. Committed beyond the base (`git diff --stat origin/develop...HEAD`): `.agents/spec-docs/todo/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` 350/0 and `.agents/tasks/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` 95/0 — exactly the paired Task/spec planning artifacts and the subject-bound PLAN ledger record.
- NON-COMPLIANCE trigger (implementation before this gate): not fired — `git diff origin/develop --name-only -- scripts/` is empty; `grep -ci continuation` → 0 in `scan-user-execution-plan-order.mjs`, `gate-catalogue.md`, `backlog-execution.md`, `backlog-pipeline/SKILL.md` and `backlog-execution-orchestrator/SKILL.md`; `completeGateImplementEntry` (`:430-439`) still accepts only `approved → in-progress`; `HARNESS_BASE_REF=origin/develop node scripts/harness/scan-user-execution-plan-order.mjs` → `::examined:: 1 topic commit(s)`, exit 0.

### [GATE-VERIFY] — ✅ PASS | 2026-08-28

**Status upgrade:** in-progress → verifying

- Ordering — prior gate: `[GATE-IMPLEMENT] — ✅ PASS | 2026-08-28` above (line 358), committed as the planning checkpoint `437293234`, with per-criterion evidence lines (Task path, TC↔Test-Plan mapping, exact PLAN outcome `not-applicable | 0` with ledger record `r20260828125845`, whole-worktree inventory) — not a bare PASS.
- Ordering — input state: at HEAD `8f493f1bd` the committed frontmatter is `status: in-progress` and the file sits under `.agents/spec-docs/active/` (`spec-workflow.md:170`). The working tree carries an uncommitted edit to `status: verifying` plus the six ticked TC-N lines and the Test Plan references; this anticipates the verdict, is not committed, and matches the HARNESS-126 precedent ("recorded after the state was reached"). Branch `fix/2418-plan-order-continuation-checkpoint`, base `origin/develop` `c59e9d028`, three commits (`9fb289eca`, `437293234`, `8f493f1bd`).
- All tasks in `.agents/tasks/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` complete: the Task carries no checkbox list (a Task is the problem record per `.agents/tasks/README.md`; the same reading as the GATE-IMPLEMENT entry and the HARNESS-126 record, which also had 0 checkboxes). Its `## Test Plan` holds six bullets mapping one-to-one to TC-01..TC-06; each is delivered in `8f493f1bd` and re-verified below. Observed, not a criterion of this gate: the spec's `## Tasks` pointer row is `- [ ]` (unticked); the Task's `status: in-progress` is the state this gate expects (terminal status is the GATE-COMPLETE handoff).
- No tasks blocked or pending: `grep -i -E 'blocked|pending|\[ \]'` on the Task → no match; `depends_on: []`; every Test Plan bullet has a matching Completion Criteria `[x]` with an `**Evidence (2026-08-28):**` line.
- Build (`pnpm build`): N/A — `git diff --name-only origin/develop...HEAD | grep -c '^packages/'` → `0`; the change set is `scripts/harness/scan-user-execution-plan-order.mjs`, its test file, and five `.agents/` documents (9 paths, none under `packages/` or `apps/`); root `build` targets `./packages/**` only and there is nothing to build for plain `.mjs` scripts.
- Tests: `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` on the working tree → `Tests 91 passed (91)`, exit 0 (the four HARNESS-131 cases — TC-01 acceptance, TC-02 four-arm refusals, TC-03 staged mirror, TC-05 catalogue binding — among them). `HARNESS_BASE_REF=origin/develop node scripts/harness/check-regression-red-proof.mjs --base origin/develop` (run alone) → `red-proof-ok (assertion-fail)`, exit 0, tree restored (`git status` unchanged). `HARNESS_BASE_REF=origin/develop pnpm harness:scan` → `146 scans passed, 1 skipped (97 declared what they examined)`, exit 0 (receipt not written because this spec is dirty — expected).
- TC-06 mutations reproduced in a throwaway detached worktree at `8f493f1bd` (removed afterwards): continuation branch of `isCheckpointTransition` replaced by `return false` → `3 failed | 88 passed (91)`, exactly the three HARNESS-131 cases (TC-01 `:417`, TC-02 `:427`, TC-03 `:484`), nothing outside them; `gateImplementPassCount(parentSpec, binding) >= 1` → `gateImplementPassCount(parentSpec) >= 1` → `1 failed | 90 passed (91)`, the TC-02 case only (`:467`, the re-planned-signal arm); restored → `git diff --stat` empty.
- TC-04 reproduced live in the same worktree (`core.hooksPath` = `.husky/_`, the repo's own; no `--no-verify`): `HARNESS_BASE_REF=8f493f1bd` (tree identical to `4e575b73c`, tree hash `21d9fa56e`), the held continuation entry appended to `.agents/spec-docs/active/RULE-016-…md` and committed through the pre-commit hook → `9ee246555` (exit 0); `git apply --index held/pr2.patch` → 12 staged paths; `node scripts/harness/scan-user-execution-plan-order.mjs --staged` → no finding, `::examined:: 12 staged path(s)`, exit 0. Control: `HARNESS_BASE_REF=9ee246555` (range excludes the continuation) → `staged implementation has no planning checkpoint ancestor`, exit 1 — the acceptance is the continuation's doing.
- TC-05 greps re-measured: `grep -c continuation` → `.agents/rules/backlog-execution.md` 2, `.agents/skills/backlog-pipeline/SKILL.md` 1, `.agents/skills/backlog-execution-orchestrator/SKILL.md` 2; the catalogue's § GATE-IMPLEMENT continuation paragraph, the format-block annotation and the prior-gate map row `GATE-IMPLEMENT (continuation)` are present at `8f493f1bd`.
- Worktree inventory at judgement (`git status --short`): ` M .agents/loop-runs/backlog-execution-orchestrator.jsonl` (one appended ledger line, `r20260828133854`) and ` M` this spec; nothing else staged, unstaged or untracked.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-28

**Command:** `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` on the working tree at `8f493f1bd`.
**Output:** `Test Files 1 passed (1)`, `Tests 91 passed (91)`, duration 9.79s — exit 0.

`user-execution PLAN order — branch history > accepts a continuation checkpoint on a pair already in-progress at the base (HARNESS-131)` (test file `:412`, assertion `:417` `expect(findHistoryFindings(root, base)).toEqual([])`) is among the 91. Red-before-fix stands on the GATE-VERIFY guard's own re-run: `HARNESS_BASE_REF=origin/develop node scripts/harness/check-regression-red-proof.mjs --base origin/develop` → `red-proof-ok (assertion-fail)`, exit 0. **Test reference:** the TC-01 row (`**Test written:**`, that describe > it name) — matches.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-28

Same command, same run (91/91, exit 0): `… > keeps refusing around a continuation: implementation before it, two of them, and a first-form entry (HARNESS-131)` (`:421`; arms asserted at `:427` `changed before the planning checkpoint`, `:467` the re-planned PLAN signal) ✓. The Task-changes-the-signal arm is the one only the binding clause `gateImplementPassCount(parentSpec, binding) >= 1` (`scan-user-execution-plan-order.mjs:883`) protects — shown by the TC-06 mutant 2 below. **Test reference:** the TC-02 row (`**Test written:**`, four arms) — matches.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-28

Same command, same run (91/91, exit 0): `… > mirrors the continuation on the staged path (HARNESS-131)` (`:472`; `:484` `expect(findStagedFindings(proposal.root, proposal.base)).toEqual([])`) ✓. The both-forms refusal text is the literal at `scan-user-execution-plan-order.mjs:928` (`checkpoint is neither the first GATE-IMPLEMENT PASS … nor one continuation PASS`). **Test reference:** the TC-03 row (`**Test written:**`) — matches.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-28

**Skip reason recorded (Test Plan row):** a live run on the real RULE-016 pair through the pre-commit hook is not a fixture — accepted; the run is recorded with SHAs.
**Verification of the record:** both live continuation commits exist as objects in this repository: `cda92c928` (parent `4e575b73c`, the author's run) and `9ee246555` (parent `8f493f1bd`, the GATE-VERIFY guard's run); `git rev-parse '4e575b73c^{tree}' '8f493f1bd^{tree}'` → both `21d9fa56e…` (identical trees, as the TC-04 evidence line states). Each commit changes exactly `.agents/spec-docs/active/RULE-016-…md` (+10 lines) and their hunks are identical (`diff` of the `+`/`-` lines → no difference): a `### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28` entry with `**Status upgrade:** in-progress → in-progress (continuation)` and the five catalogue-enumerated lines.
**Re-run by this guard** (throwaway detached worktree at `9ee246555`, `node_modules` linked, removed afterwards; the held `pr2.patch` is not reachable from this session, so a one-file staged implementation `scripts/harness/harness-131-probe.mjs` stands in for it): `HARNESS_BASE_REF=8f493f1bd node scripts/harness/scan-user-execution-plan-order.mjs` → `::examined:: 1 topic commit(s)`, exit 0 (the continuation commit alone is accepted as the checkpoint on the history path); `HARNESS_BASE_REF=8f493f1bd … --staged` → `::examined:: 1 staged path(s)`, exit 0; control `HARNESS_BASE_REF=9ee246555 … --staged` → `✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.`, `::examined:: 1 staged path(s)`, exit 1. The 12-path figure (`::examined:: 12 staged path(s)`, exit 0, with the same exit-1 control) is the GATE-VERIFY guard's recorded observation against the held patch; the mechanism it depends on reproduces here.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-28

Same vitest run (91/91, exit 0): `… > accepts the continuation status line the catalogue declares (HARNESS-131)` (`:506`) reads `.agents/specs/gate-catalogue.md` between `### GATE-IMPLEMENT` and `### GATE-VERIFY` and asserts `CONTINUATION_STATUS_LINE`; the catalogue holds `**Status upgrade:** in-progress → in-progress (continuation)` at `:243`, the format-block annotation at `:66`, and the prior-gate map row `GATE-IMPLEMENT (continuation)` at `:82`. `grep -c continuation` re-measured: `.agents/rules/backlog-execution.md` → 2, `.agents/skills/backlog-pipeline/SKILL.md` → 1, `.agents/skills/backlog-execution-orchestrator/SKILL.md` → 2. `HARNESS_BASE_REF=origin/develop node scripts/harness/scan-new-rule-declares-enforcement.mjs` → `::examined:: 0 new rule sections`, `new-rule-declares-enforcement scan passed (0 new rule section(s); …)`, exit 0. **Test reference:** the TC-05 row (`**Test written:**` plus the greps recorded here) — matches.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-28

**Skip reason recorded (Test Plan row):** a mutation of the shipped source cannot be a committed test — accepted; both mutations recorded.
**Re-run by this guard** in a throwaway detached worktree at `8f493f1bd` (`node_modules` linked; the main tree untouched; worktree removed afterwards). Mutant 1 — `return false;` inserted at `scan-user-execution-plan-order.mjs:880`, ahead of the continuation `return (…)`: `./node_modules/.bin/vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → `Tests 3 failed | 88 passed (91)`, exit 1; the three failures are exactly the TC-01, TC-02 and TC-03 cases named above, none outside HARNESS-131. Restored from `git show 8f493f1bd:<path>` → `git diff --stat` empty. Mutant 2 — `:883` `gateImplementPassCount(parentSpec, binding) >= 1` → `gateImplementPassCount(parentSpec) >= 1`: → `Tests 1 failed | 90 passed (91)`, exit 1; the one failure is the TC-02 case (its re-planned-signal arm). Restored → `git diff --stat` empty. Unmutated, main tree: 91/91, exit 0 (TC-01 entry). `HARNESS_BASE_REF=origin/develop pnpm harness:scan` run alone on the main tree → `146 scans passed, 1 skipped (97 declared what they examined)`, exit 0 (receipt not written: this spec and the orchestrator ledger are dirty — expected). `git status --short` after all runs: only ` M .agents/loop-runs/backlog-execution-orchestrator.jsonl` and ` M` this spec.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-28

**Status upgrade:** verifying → done

- Ordering — prior gate: `[GATE-VERIFY] — ✅ PASS | 2026-08-28` above (line 372) with per-criterion evidence lines (its own vitest 91/91, red-proof, harness:scan 146/0, both TC-06 mutants, TC-04 live with an exit-1 control) — not a bare PASS.
- Ordering — input state: frontmatter `status: verifying` (uncommitted edit over the committed `in-progress`), file under `.agents/spec-docs/active/`, which `spec-workflow.md:171` maps to `verifying` (no folder change). Branch `fix/2418-plan-order-continuation-checkpoint`, HEAD `8f493f1bd`, three commits over `origin/develop` `c59e9d028` (`9fb289eca`, `437293234`, `8f493f1bd`).
- Per TC-N checkbox: TC-01…TC-06 are all `[x]` in `## Completion Criteria`, each carrying an `**Evidence (2026-08-28):**` line.
- Per TC-N `[GATE-COMPLETE: TC-N]` entry with command, observed output and exit code: six entries above (TC-01…TC-06), each re-run by this guard where the command is re-runnable (vitest 91/91 exit 0; both mutants exact; `harness:scan` 146/0 exit 0; `new-rule-declares-enforcement` exit 0; the greps; the live continuation mechanism on `9ee246555` with an exit-1 control).
- Per Test Plan row — test reference or skip reason: TC-01, TC-02, TC-03, TC-05 `**Test written:**` naming `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs > user-execution PLAN order — branch history > <it name> (HARNESS-131)` — all four `it` names exist (`:412`, `:421`, `:472`, `:506`) and pass; TC-04 and TC-06 `**Test skipped:**` with a concrete reason each (live hook run is not a fixture; a source mutation cannot be a committed test). No row is silently unaddressed.
- `## Completion Criteria` all `[x]`: yes (6/6). `## Test Plan` updated for all rows: yes (6/6).
- `## Tasks` names the exact active task path: `.agents/tasks/HARNESS-131-plan-order-has-no-continuation-checkpoint-for-a-sequenced-spec.md` — exists, tracked, its `## Bound spec document` names this file. Observed, not a criterion: the pointer row is `- [ ]`; the archived-task pointer is a post-PASS output.
- Active task completion-ready: the Task has 0 checkboxes (`grep -c '^\s*- \[ \]'` → 0; a Task is the problem record per `.agents/tasks/README.md`, the reading GATE-IMPLEMENT and GATE-VERIFY applied); its six `## Test Plan` bullets map one-to-one to TC-01…TC-06, each demonstrated above; `grep -i -E 'blocked|pending'` → no match; `depends_on: []`. `status: in-progress` is the expected input; the terminal status/date, archival and the `active → done` move are the orchestrator's Phase 5 handoff.
