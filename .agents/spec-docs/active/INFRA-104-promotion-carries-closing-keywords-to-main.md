---
status: in-progress
type: INFRA
tags: [ci]
---

# INFRA-104: a merged `Closes #N` never reaches `main`, so finished issues stay open

## Problem

**Symptom.** Work PRs write a closing keyword in their body and it does nothing.

- PR #1802 body, first line: `Closes #1750.` — merged into `develop` 2026-08-16. **#1750 is still OPEN.**
- PR #1816 body, first line: `Closes #1722.` — merged into `develop` 2026-08-17. **#1722 is still OPEN.**
- Both Tasks are in `.agents/tasks/completed/` (`ARCH-029-…md`, `CORE-043-…md`). The work landed.

**Reproduction condition.** Every work PR in this repository, always. GitHub interprets closing keywords
only for a PR that targets the **default branch**: _"If the pull request targets any other branch, then
these keywords are ignored, no links are created, and merging the PR has no effect on the issues."_
(<https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>).
The default branch here is `main`; `git-branch.md` routes all work `feature → develop → main`. So the
keyword is ignored on every work PR, and the `develop → main` promotion PR — the only PR that does target
the default branch — carries no keyword of its own.

**Two consequences, both measured.**

1. **Closing is unowned manual labour.** Issues #1758 and #1788 were closed by a `commented` → `closed`
   timeline pair one second apart, days after their work merged. PR #1804's title is the batch itself:
   `fix(triage): close seven open GitHub issues from the priority triage`.
2. **The stale queue corrupts the priority signal.** The session-start hook reports open issues as
   _"these outrank unfiled backlog work"_. On 2026-08-17 it listed #1750 (CORE-043) and #1722 (ARCH-029)
   — both finished — at the top of that list. The mechanism that is supposed to order the next session's
   work is being fed issues that are done.

**Not the problem.** "We cannot tell which issues are in progress." Assignees and a Projects board are a
separate question and are explicitly out of scope here; an issue that never closes makes every downstream
status scheme wrong regardless of which one is chosen.

## Prior Art Research

**GitHub — closing keywords are bound to the default branch.** Cited above. There is no repository setting
that extends them to another branch; the constraint is structural, not configurable.

**GitLab — the same constraint, independently.** _"Issues are closed when either the commit is pushed to a
project's default branch, or the commit or merge request is merged into the default branch."_
(<https://docs.gitlab.com/administration/issue_closing_pattern/>). Requests to lift it for non-default
branches are open and unimplemented (<https://gitlab.com/gitlab-org/gitlab/-/issues/14289>). So the
behaviour is not a GitHub quirk to route around — **both major forges bind auto-close to the default
branch**, and a GitFlow repository is expected to bridge the gap itself rather than expect the forge to.

**semantic-release — the bridge is placed at the release boundary, not the merge boundary.**
`@semantic-release/github` _"adds a comment to each GitHub Issue or Pull Request resolved by the release
and closes issues"_ (<https://github.com/semantic-release/github>). The closing act is attached to the
release, i.e. to the moment the work reaches the released line — not to the moment a feature branch merged.

**semantic-release + GitFlow needs an explicit bridging step.** _"semantic-release in its core is not
intended to be used with Git Flow where a stable (master/main) branch and an unstable branch
(develop/next) exist"_; `@saithodev/semantic-release-backmerge` exists specifically to carry state across
that boundary (<https://saitho.github.io/semantic-release-backmerge/>).

**Observed common behaviour.** Where a two-branch flow meets a default-branch-only auto-close, the
industry answer is a **deliberate step at the release/promotion boundary that re-states what the merged
work claimed** — not a per-merge hook on the unstable branch, and not manual triage.

**Constraint that applies to Robota.** `main` _is_ this repository's release line, and
`scripts/harness/promote.mjs` already _is_ the release-boundary step: it builds the promotion branch,
enforces the A1/A2/A3 ancestry gate, and prints the exact `gh pr create` command that opens the only PR
targeting the default branch. The bridge every reference places at the release boundary therefore has an
existing, single, already-gated home here. Nothing new needs to be introduced to hold it.

## Architecture Review

### Affected Scope

- `scripts/harness/promotion-closes.mjs` — **new.** Derives the closing-keyword block for a promotion.
- `scripts/harness/promote.mjs` — emit the block in its `Next` output.
- `scripts/harness/scan-promotion-closes.mjs` — **new.** The guard: a `main`-based PR body must carry
  every keyword its carried commits imply.
- `scripts/harness/__tests__/promotion-closes.test.mjs`, `…/scan-promotion-closes.test.mjs` — **new.**
- `scripts/harness/__tests__/promote.test.mjs` — extended.
- `.github/workflows/ci.yml` — a job that runs the guard on a PR whose base is `main`.
- `.agents/rules/release-operations.md` — record that the promotion PR body carries the block.
- `.github/required-status-checks.json` — the new context under `branches.main` (D1: required).

Not in scope: `.github/PULL_REQUEST_TEMPLATE.md` (work PRs keep writing `Closes #N`; that line becomes the
input this item reads rather than a no-op), assignees, labels, and GitHub Projects.

### Alternatives Considered

**Alt 1 — the promotion PR body carries the aggregated closing keywords.** `promote.mjs` derives
`Closes #N` for every issue referenced by the PRs the promotion carries, and prints it for the promotion
PR body; GitHub closes them when the promotion merges into `main`.
_Pro:_ uses GitHub's own mechanism, so the issue shows the standard "closed by #1814" provenance; closing
coincides with the work actually reaching the release line; the branch model is untouched; the derivation
has an existing single home that is already gated.
_Con:_ the promotion PR body becomes load-bearing, so it needs a guard of its own (this item adds one).

**Alt 2 — a workflow calls `gh issue close` when a PR merges into `develop`.**
_Pro:_ closes within minutes of the work landing; no dependence on the promotion body.
_Con:_ **it lies about state** — the issue reads closed while the fix exists only on `develop` and has not
shipped. It also needs `issues: write` on a workflow triggered by merged PR content, and it replaces
GitHub's native linkage with a bespoke one, so the issue loses the "closed by #N" provenance.

**Alt 3 — retarget work PRs at `main` so the keyword fires directly.**
_Pro:_ zero new machinery.
_Con:_ abolishes the branch model. `ci.yml`'s `main-pr-source-guard` exists to refuse exactly this after
incident #1216, and `protect-main` requires promotion-only gates. Rejected outright.

**Alt 4 — status quo: periodic manual triage batches (PR #1804).**
_Pro:_ no code.
_Con:_ measured to lag by days and to have already corrupted the session-start priority signal. It is the
defect, not an alternative to it.

### Decision

**Alt 1.** The reference implementations agree on the placement — the closing act belongs at the boundary
where work reaches the released line — and this repository already has that boundary implemented, gated
and single (`promote.mjs` + the `promotion ancestry` required check). Alt 2's earlier closure is bought by
asserting something false, which is the failure shape this repository's own rules name repeatedly
(`enforcement-architecture.md` § "Silence is not success"); the days Alt 1 costs are the days between
merge and release, which is the truth.

The design is validated on the two facts that decide whether it can work at all, both measured:

- **The keyword source is the PR body, not the commit.** `git log -1 --format=%B 93d061dd3` (the squash of
  PR #1802) contains no `Closes` line — GitHub's squash body is the concatenated commit messages, not the
  PR description. So the derivation must read PR bodies, reached via the `(#NNNN)` suffix GitHub puts on
  every squash subject. Reading commit messages instead would silently produce an empty block.
- **A `Closes` line is not always an issue reference.** PR #1801's body opens `Closes PROV-007.` — a Task
  ID. Only the `#<digits>` form may contribute, and each candidate is confirmed against the issues API
  before it is emitted.

Failure is loud in both directions: an unreadable PR body aborts the derivation rather than emitting a
short block, and the guard fails a promotion PR whose body omits a keyword its commits imply.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `promote.mjs` 및 `scan-promotion-ancestry.mjs` 확인: 승격 경계에 이미 존재하는
      단일 진입점과 그 가드 쌍을 재사용하며, 새로운 승격 경로를 만들지 않음
- [x] 대안 최소 2개 검토 완료 (4개)
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None.

Two sites could be mistaken for one and are deliberately not:

- **A PR body that cannot be read** aborts the derivation with a non-zero exit naming the PR. It does not
  emit a partial block. "I could not read it" and "it referenced nothing" are the two answers this item
  exists to keep apart.
- **An already-closed issue contributes no line.** That is a domain filter over a fully-read input, not a
  degraded path taken on error.

## Solution

1. **`promotion-closes.mjs --base <ref> --head <ref>`** — enumerate the commits `base..head`; take the
   `(#NNNN)` suffix of each subject; read each PR body (paginated per `api-pagination`); extract
   `(Closes|Fixes|Resolves) #<digits>` case-insensitively; dedupe; drop numbers that are not OPEN issues in
   this repository; print one `Closes #N` line per survivor, newest-first, or nothing when there are none.
   Any unreadable input is a non-zero exit, never a shorter block.
2. **`promote.mjs`** calls it and prints the block inside its existing `Next (…)` output, so the operator
   pastes it into the promotion PR body along with the `gh pr create` command already printed there.
3. **`scan-promotion-closes.mjs --pr <n>`** — the guard. For a PR whose base is `main`, re-derive the block
   from the PR's own commits and fail when the body is missing any line it implies. Runs as a `ci.yml` job
   gated on `github.base_ref == 'main'`.

## Affected Files

| File                                                       | Change                                  |
| ---------------------------------------------------------- | --------------------------------------- |
| `scripts/harness/promotion-closes.mjs`                     | new — derivation                        |
| `scripts/harness/scan-promotion-closes.mjs`                | new — guard                             |
| `scripts/harness/promote.mjs`                              | print the block in `Next`               |
| `scripts/harness/__tests__/promotion-closes.test.mjs`      | new                                     |
| `scripts/harness/__tests__/scan-promotion-closes.test.mjs` | new                                     |
| `scripts/harness/__tests__/promote.test.mjs`               | extend                                  |
| `.github/workflows/ci.yml`                                 | job, gated on base `main`               |
| `.agents/rules/release-operations.md`                      | the promotion PR body carries the block |
| `.github/required-status-checks.json`                      | new `main` required context (D1)        |

## Completion Criteria

- [ ] TC-01: `node scripts/harness/promotion-closes.mjs --base main --head develop` exits `0` and prints
      exactly one `Closes #<n>` line per OPEN issue referenced by a carried PR body.
- [ ] TC-02: given a carried PR whose body cannot be read, the command exits non-zero, names that PR on
      stderr, and prints **no** `Closes` line.
- [ ] TC-03: a carried PR body containing `Closes PROV-007.` contributes no line (Task IDs are not issues).
- [ ] TC-04: a carried PR body referencing an already-CLOSED issue contributes no line.
- [ ] TC-05: `node scripts/harness/promote.mjs` output contains the derived block above its `gh pr create` line.
- [ ] TC-06: `node scripts/harness/scan-promotion-closes.mjs --pr <n>` exits non-zero for a `main`-based PR
      whose body omits a `Closes #N` its commits imply, and `0` when the body carries all of them.
- [ ] TC-07: the guard exits `0` (not-applicable) for a PR whose base is not `main`.
- [ ] TC-08: `pnpm harness:scan` and the harness unit suite are green.
- [ ] TC-09: `node scripts/harness/scan-main-required-checks.mjs` exits `0` with the new context present
      in `branches.main`, proving it resolves to a job that runs and can fail on a `main`-based PR.
- [ ] TC-10 (user-execution): the promotion PR opened after this item merges carries the block, and every
      issue it names is CLOSED by GitHub — not by hand — once that PR merges. `#1722` is the first case.

## Test Plan

INFRA + `ci` → CI pipeline smoke test, plus command-form unit assertions over the two new modules.

| TC-ID | Test Type   | Tool / Approach                                                                       | Notes                                                                                                                                         |
| ----- | ----------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest over `promotion-closes.mjs` with a stubbed API reader                          |                                                                                                                                               |
| TC-02 | unit        | vitest — reader throws; assert non-zero exit and empty stdout                         | fail-closed edge                                                                                                                              |
| TC-03 | unit        | vitest — fixture body `Closes PROV-007.`                                              | measured on PR #1801                                                                                                                          |
| TC-04 | unit        | vitest — fixture issue state `closed`                                                 |                                                                                                                                               |
| TC-05 | integration | call `promote.mjs`'s `main()` with injected readers, assert stdout contains the block | extends `promote.test.mjs`                                                                                                                    |
| TC-06 | unit        | vitest over `scan-promotion-closes.mjs`, both directions                              | the guard must be able to fail                                                                                                                |
| TC-07 | unit        | vitest — base `develop` → exit 0                                                      | not-applicable ≠ unreadable                                                                                                                   |
| TC-08 | CI smoke    | `pnpm harness:scan` exit 0                                                            |                                                                                                                                               |
| TC-09 | CI smoke    | `node scripts/harness/scan-main-required-checks.mjs` exit 0                           | a required context that cannot fail is the vacuity INFRA-055 measured                                                                         |
| TC-10 | manual      | observe the next promotion PR and `gh issue view 1722 --json state`                   | Infeasible to automate: the criterion is a real merge into the default branch by an owner-approved release action, which no test may perform. |

## User Execution Test Scenarios

**Not applicable — this item delivers no runnable user-facing product behavior.**

Reason, against the product-surface list in
[backlog-execution.md](../../rules/backlog-execution.md) § User Execution Test Scenario Rule: the whole
change lives in the release harness and the CI configuration — a derivation module, a guard, a CI job,
the required-check declaration, and a rule. Its two surfaces are `node scripts/harness/promote.mjs`
(a maintainer's release step) and a GitHub status check on a promotion pull request. Neither is the
Robota CLI, the TUI, the browser UI, or the public SDK, and no `robota …` invocation behaves any
differently after this item than before it. Inventing a scenario over a harness script would assert a
product surface this work does not touch.

Verification evidence therefore lives in the engineering **Test Plan** above: TC-01…TC-04 and TC-06/TC-07
over the two new modules, TC-05 over `promote.mjs`'s output, TC-08/TC-09 as CI smoke.

The one criterion no test may perform is recorded as TC-10 and is not a user-execution scenario: it
requires a real merge into the default branch by an owner-approved release action, and it is observed on
the next promotion rather than executed here.

## Owner Decisions (answered 2026-08-18)

- **D1 — the guard IS a required check on `protect-main`. APPROVED.** `scan-promotion-closes` is added to
  `branches.main.required_status_checks` in `.github/required-status-checks.json`, which that file declares
  is the SOURCE and not a mirror. Two consequences this item must satisfy rather than assume:
  `scan-main-required-checks.mjs` asserts offline that the new context resolves to a workflow job that
  **actually runs and can fail** on a PR whose base is `main` — so the job must not be skipped there — and
  the live `protect-main` ruleset must be updated in the same change, which is a GitHub API action the
  owner performs (`ruleset-drift.yml` reconciles it on a schedule).
- **D2 — one-time reconciliation. APPROVED, scoped to finished work only.** Owner directive 2026-08-18:
  _"현재 다른데서 처리중인건 임의로 건드리지말고 끝난거 위주로 우선 처리해"_ — do not touch anything being
  worked elsewhere; close only what is finished.

  **Measured 2026-08-18, and the result is that the reconciliation list is empty.** Every open issue was
  checked against whether its work is on `main`:

  - `#1750` (CORE-043) — the case that motivated this item. Carried by promotion #1814, **already closed
    by hand** before this measurement. Nothing left to do.
  - `#1722` (ARCH-029) — work merged to `develop` in PR #1816, but `origin/main` is at `b9fa24dc8`
    (promotion #1814), which **predates** it. The work has not reached the release line, so under this
    item's own design it closes at the next promotion — by GitHub, not by hand. Closing it now would
    assert exactly the falsehood Alt 2 was rejected for.
  - Every other open issue is either unstarted or **in flight in another working tree** and is not touched:
    `#1805` (ARCH-037, `robota-2`), `#1807`–`#1812` (PEER-002, `robota`), plus `#1820`, `#1806`, `#1787`,
    `#1785`, `#1784`, `#1719`, and the newly filed `#1844`, `#1846`, `#1849`, `#1851`, `#1852`.

  So this item performs **no manual closes**. `#1722` becoming the first issue GitHub closes on its own is
  TC-10, and it is the reconciliation — the mechanism doing the work the batch used to do by hand.

## Tasks

- [ ] `.agents/tasks/completed/INFRA-104-promotion-carries-closing-keywords-to-main.md` — 생성됨 (TC-01…TC-10 전부 Plan 항목으로 존재)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-18

**Status upgrade:** draft → review-ready

- Frontmatter: `status: draft`, `type: INFRA` (one of the 11 prefixes), `tags: [ci]` present.
- Problem: concrete symptom (PR #1802 `Closes #1750` merged, #1750 still OPEN; PR #1816 `Closes #1722`
  merged, #1722 still OPEN) and reproduction condition (every work PR, because the keyword is only read on
  a default-branch PR). No TBD/TODO.
- Prior Art Research: substantiated with 4 documentation citations (GitHub linking docs, GitLab issue
  closing pattern, GitLab issue 14289, semantic-release/github, semantic-release-backmerge). Findings feed
  Alternatives and Decision — the placement argument in Decision is taken from them, not asserted.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` naming `promote.mjs` /
  `scan-promotion-ancestry.mjs`; 4 alternatives each with pro/con; Decision names the trade-off (earlier
  closure bought by asserting a falsehood).
- New-surface placement: N/A — no new package, app, presentation or interface surface; the change adds two
  modules inside the existing `scripts/harness/` layer and one `ci.yml` job.
- Completion Criteria: TC-01…TC-10, every item TC-N prefixed, each in command or observable form.
- Test Plan: 10 rows, one per TC-N — count matches. The single `manual` row (TC-10) carries its
  infeasibility justification.
- Structure: `## Tasks` placeholder present; `## Evidence Log` was empty before this entry; no `## Status`
  or `## Classification` body sections.

**Deviation recorded:** this gate was evaluated inline by the main loop, not by a dispatched
`backlog-gate-guard`, because subagent dispatch is disabled for this session. Every criterion above was
checked against the document; the deviation is in who ran the gate, not in whether it ran.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-18

**Status upgrade:** review-ready → approved

- Explicit user approval, verbatim: _"모두 승인. 현재 다른데서 처리중인건 임의로 건드리지말고 끝난거 위주로
  우선 처리해"_ (2026-08-18). It answers the two open decisions D1 and D2 directly and authorizes
  implementation.
- The `## Architecture Review` section and the frontmatter `type`/`tags` were not modified after that
  approval. The `## Owner Decisions` section records the approval's content; the ID was renumbered
  INFRA-103 → INFRA-104 before approval because open issue #1846 already claims INFRA-103.
- Independent architecture validation: not required — the conditional applies only to a spec introducing a
  new package/app/surface or reclassifying a layer boundary, and this one does neither (see GATE-WRITE).

**Deviation recorded:** evaluated inline rather than by a dispatched guard, for the reason stated above.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-18

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/completed/INFRA-104-promotion-carries-closing-keywords-to-main.md`
  (frontmatter `status: in-progress`, `created: 2026-08-18`, `priority: high`, `urgency: now`).
- Its path is recorded in the `## Tasks` section above.
- Its `## Plan` carries one task per TC-N — TC-01 through TC-10, ten items, matching the ten Completion
  Criteria one for one.
- Its `## Test Plan` section is present and is ~950 characters, above the `test-plans` scan's 50-character
  floor; it names the test tier per criterion and states why TC-10 cannot be automated.
- No implementation commits exist ahead of this gate: the working tree carries only the spec document and
  the tasks file at this point.

**Deviation recorded:** evaluated inline by the main loop rather than by a dispatched
`backlog-gate-guard`, because subagent dispatch is disabled for this session.
