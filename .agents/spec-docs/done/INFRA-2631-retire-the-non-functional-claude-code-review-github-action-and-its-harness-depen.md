---
status: done
type: INFRA
tags: [ci]
lane: L2
---

# INFRA-2631: Retire the non-functional Claude Code Review GitHub Action

Paired with `.agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`. Arising from [issue #2631](https://github.com/woojubb/robota/issues/2631).

## Problem

The owner has directed that `.github/workflows/claude-code-review.yml` (the automated lightweight
PR-review pass driven by `anthropics/claude-code-action`) be treated as permanently non-functional
going forward, and disabled — both the GitHub Action itself and every harness mechanism that reacts
to or depends on its output. Reproduce the risk directly: run `pnpm harness:scan` today, then delete
or gut the action step in `claude-code-review.yml` without any other change — `claude-review-coverage`
(`scripts/harness/scan-claude-review-coverage.mjs`, registered in the required `scans` CI job and in
`pnpm harness:pre-push`) immediately reports `no workflow invokes the governed Claude review action`
and exits 1, which would fail the required `scans` check on every future pull request to `develop`.
The task is therefore not "delete one file" but "disable the action without leaving a now-permanently
-failing mechanical guard behind it."

no-issue: captured directly from the owner request in this conversation (issue #2631 opened by the
allocator to back this Task/spec pair).

## Prior Art Research

GitHub's own product documentation for "Disabling and enabling a workflow"
(https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows) states
that disabling a workflow "allows you to stop a workflow from being triggered without having to
delete the file from the repo," offered as `gh workflow disable <workflow>` or the Actions-tab UI
toggle, with `gh workflow enable`/the UI "Enable workflow" action as the exact reverse. The documented
design intent is exactly the outcome this item wants: stop execution, keep the file, stay reversible.

The applicable constraint for Robota is that a bare repository-level `gh workflow disable` toggle is
insufficient here even though it is the officially documented mechanism, for two repository-specific
reasons this repo already established for this exact action: (1) `.github/workflows/**` is this
repository's L2-floor policy surface (`spec-workflow.md` § Lanes), and RULE-015
(`.agents/spec-docs/backlog/RULE-015-grounds-are-recorded-where-the-work-is.md`) requires the ground
for a change to live on the artifact it justifies — a dashboard-only toggle leaves no git-tracked
record a reviewer or a future clone can see; (2) this repository's own prior incidents with this exact
action (INFRA-048, INFRA-062, INFRA-097, INFRA-134 — all in `.agents/spec-docs/done/`) show that its
correctness is governed by two anti-rot mechanical scans (`scan-claude-review-coverage.mjs`,
`scan-review-token-supply.mjs`) that assert facts about the committed YAML shape, not about whether
the workflow is enabled on GitHub's dashboard — a dashboard toggle changes nothing those scans read,
so it does not, by itself, disable "the harness's response to code review" the owner asked for. The
correct action-disable primitive for this repository is therefore the committed-YAML `if: false`
idiom this repository already uses for exactly this purpose: `.github/workflows/review-gate.yml`'s
`Collect the review output` and `Confirm the code-scanning analysis` steps are already disabled this
same way (`if: ${{ false }}`), preserving the code and its incident-history comments for inspection
and quick reinstatement.

Anthropic's official Claude Code Action does not define a dedicated "disable" input distinct from
ordinary GitHub Actions trigger/`if:` control (confirmed against
https://github.com/anthropics/claude-code-action/blob/main/action.yml, the same source INFRA-134's
Prior Art Research cites) — so there is no action-specific mechanism to prefer over the
workflow-level control GitHub itself documents.

## Architecture Review

### Affected Scope

- `.github/workflows/claude-code-review.yml` — disable the `review` job.
- `scripts/harness/scan-claude-review-coverage.mjs` — recognize the disabled state so it does not
  fail the required `scans` job; `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` —
  cover it.
- `.agents/skills/pr-finding-resolution-loop/SKILL.md`, `.agents/skills/automated-review-convergence/SKILL.md`
  — Round B prose that currently calls this action "the reviewer on an open PR."
- Not touched, confirmed by direct inspection: `.github/workflows/review-gate.yml` /
  `scripts/harness/check-review-gate.mjs` (already hardcode `--code-changed false`, never read this
  action's output); `scripts/harness/scan-review-token-supply.mjs` and
  `scripts/harness/scan-workflow-permissions.mjs` (both are satisfied as long as the
  `uses:`/`with:`/`github_token:`/`permissions:` lines stay physically present, which this design
  keeps unchanged); `scripts/harness/scan-review-findings.mjs` and `.agents/rules/git-branch.md` §
  Pre-Merge Code-Review Gate (govern the separate, unaffected LOCAL `/code-review` gate);
  `scripts/harness/scan-guard-scope-fail-closed.mjs`'s `MANDATORY_TREE_GUARDS` entry for the
  coverage scan (asserts fail-closed behavior only when the `.github/workflows` tree itself is
  absent, a branch this change does not touch); `.github/required-status-checks.json` (no
  `Claude review`/`claude-code-review.yml` context is required on either protected branch).

### Alternatives Considered

1. **Job-level `if: false` in the committed workflow, plus a matching retirement branch in
   `scan-claude-review-coverage.mjs`.** Pro: git-tracked and reviewable (satisfies RULE-015), fully
   reversible by reverting one line, reuses `review-gate.yml`'s own established disabled-step idiom,
   keeps the required `scans` job green without weakening it for any other workflow. Con: the
   coverage scan needs a new, narrowly-scoped branch (gated on both `if: false` and an explicit
   retirement marker string, never on `if: false` alone, so an unrelated accidental `if: false`
   elsewhere still fails the guard as designed).
2. **Delete `.github/workflows/claude-code-review.yml` outright, and delete/deregister
   `scan-claude-review-coverage.mjs` and `scan-review-token-supply.mjs`** (both scans treat "zero
   governed workflows" as a hard failure by their own documented anti-rot design, so deleting the
   workflow without deleting them is not an option). Pro: zero residual GitHub Actions surface. Con:
   destroys the incident-history commentary (INFRA-048/062's hard-won account of the silent-skip
   failure mode) that this repository's own convention treats as valuable enough to keep next to the
   code it explains; is not reversible by a one-line revert; and is a disproportionately large,
   less-reversible blast radius for a decision the owner explicitly framed as an assumption ("가정",
   i.e. "assume it no longer works") rather than a confirmed permanent fact.
3. **Repository-level `gh workflow disable` only, no code change.** Pro: zero diff, officially
   documented, instantly reversible via `gh workflow enable`. Con: as established in Prior Art
   Research, leaves no git-tracked record (violates RULE-015) and does not change what the two
   anti-rot scans read, so it does not satisfy "disable the harness's code-review response" at all —
   the required `scans` job would still assert the exact same live-reviewer shape it does today.

### Decision

Alternative 1. Disable the `review` job with `if: false` in the committed workflow file (keeping
every other line — action reference, `with:` block, `github_token:`, `permissions:`, and the full
historical rationale comments — byte-for-byte unchanged), and extend
`scan-claude-review-coverage.mjs` with a narrow, explicitly-marked retirement branch: only when a
governed job's `if` normalizes to exactly `false` AND the file also carries a literal retirement
marker string (naming this Task ID) does the scan skip that workflow's
event-filter/marker/prompt-language/job-`if`-exact-match checks; any other `if: false` (accidental,
or on a hypothetical future workflow without the marker) still fails the guard exactly as it does
today. This is the smallest fully-reversible, git-tracked change, it does not weaken the guard for
any case other than the one it is deliberately marking, and it matches this repository's own
established idiom for a control-plane file kept disabled-but-documented (`review-gate.yml`'s
`if: ${{ false }}` steps).

Validated recommendation (`.github/workflows/**` is this repository's L2 floor, so this is a
wide-blast-radius change under spec-workflow.md § "Validated Recommendation Before Approval"):

- **Reachability.** The only two consumers of `findClaudeReviewCoverageFindings` are the required
  `scans` job in `.github/workflows/ci.yml` and `pnpm harness:pre-push`; both keep calling the same
  exported function with the same signature, so both still run and both still enforce the guard for
  every workflow that is not explicitly, narrowly marked retired.
- **Capability preservation.** The removed capability is the automated PR-review comment itself; no
  replacement contract is introduced because the mandatory local `/code-review` gate
  (`git-branch.md` § Pre-Merge Code-Review Gate, `pnpm harness:review:record`) already exists,
  verified in Prior Art Research / Affected Scope above to be fully independent of this action, and
  remains the merge-blocking review of record.
- **Adversarial pass over failure modes.** (a) A future author sets `if: false` on some other,
  unrelated workflow's job for debugging: without the exact retirement marker string, the new branch
  does not fire, and the guard reports the normal shape findings — the bypass cannot be triggered by
  accident. (b) Someone re-enables this exact job by restoring its `if:` to the guarded expression
  without removing the retirement marker comment: the new branch's `if`-value check no longer
  matches `false`, so the guard falls through to its full existing shape checks against the live
  (now active again) job — no permanently-blind spot is created. (c) The "zero governed workflows"
  top-level failure (`findClaudeReviewCoverageFindings`, still asserted by the existing
  `scan-guard-scope-fail-closed.mjs` `MANDATORY_TREE_GUARDS` entry and by the existing "fails closed
  when no governed workflow exists" test) is untouched, because the `uses:
anthropics/claude-code-action` line stays physically present — this change only ever affects a
  file already correctly classified as "governed."

**Delivery mode:** `single`

The whole Solution (workflow disable, scan retirement branch, its tests, and the two SKILL.md prose
fixes) lands in one PR/commit set; there is no sequenced, multi-checkpoint delivery for this item.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — this is the sole workflow invoking the governed PR review action
      (`scan-claude-review-coverage.mjs`'s own scope), so no sibling workflow needs the same change.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None — the `if: false` job never partially runs and never silently substitutes any other behavior;
it either does not run (the intended, sole state) or, if reverted, runs exactly as it did before
this change.

## Solution

1. `.github/workflows/claude-code-review.yml`: add `if: false` to the `review:` job, and a comment
   block immediately above the job stating the retirement decision, the date, this Task ID
   (`INFRA-2631`), and the exact literal marker string `CLAUDE-CODE-REVIEW: RETIRED (INFRA-2631)`
   that `scan-claude-review-coverage.mjs` matches on. Leave every other key (`on:`, `permissions:`,
   `concurrency:`, the `uses:`/`with:` block, the full `prompt:`) byte-for-byte unchanged.
2. `scripts/harness/scan-claude-review-coverage.mjs`: add a `RETIRED_MARKER` exact-string constant
   and an `isRetiredJob(source, jobIf)` helper; in `findWorkflowCoverageFindings`, when a governed
   action's owning job `if` normalizes to `false` and `source` contains `RETIRED_MARKER`, skip
   pushing any event-filter/marker/prompt-language/job-`if` findings for that action (still
   requiring the action step itself to exist, so the top-level "zero governed workflows" failure is
   untouched).
3. `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`: add cases proving (a) `if: false`
   without the marker still reports the existing shape findings (RED-proof that the bypass cannot be
   triggered by accident), (b) `if: false` with the marker present reports zero findings, and (c) the
   existing "is registered and passes on the live repository" test continues to pass once the live
   workflow carries both the disabled `if:` and the marker.
4. `.agents/skills/pr-finding-resolution-loop/SKILL.md` step 1: remove the exact sentence "The
   reviewer on an open PR is the review automation the pull request runs" and state instead that
   Round B fetches whatever automated review feedback CI actually runs, that the Claude Code Review
   GitHub Action is retired as of INFRA-2631 and posts nothing, and that an empty result is the
   expected steady state (zero findings), not a missing step to wait on.
   `.agents/skills/automated-review-convergence/SKILL.md`'s "When to Use" bullet: remove the exact
   phrase "bot review comments" from the list of automated-feedback sources and add a parenthetical
   noting the action is retired as of INFRA-2631 and no longer posts them.
5. Run `pnpm harness:scan`, the targeted Vitest suite, and `pnpm harness:verify-like-ci` to confirm
   no other registered scan regresses.

## Affected Files

- `.github/workflows/claude-code-review.yml`
- `scripts/harness/scan-claude-review-coverage.mjs`
- `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`
- `.agents/skills/pr-finding-resolution-loop/SKILL.md`
- `.agents/skills/automated-review-convergence/SKILL.md`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` →
      exits 0 with the retirement branch present, and the new "no marker" mutation case exits 1 with
      the retirement branch reverted (red-proof of the guard's specificity).
- [x] TC-02: `node scripts/harness/scan-claude-review-coverage.mjs` → exits 0 against the live,
      now-disabled `claude-code-review.yml` (one workflow examined, zero findings).
- [x] TC-03: `node scripts/harness/scan-review-token-supply.mjs` and
      `node scripts/harness/scan-workflow-permissions.mjs` → both exit 0 unmodified against the live
      workflow, proving the `github_token`/`permissions` content was left intact.
- [x] TC-04: `node scripts/harness/scan-guard-scope-fail-closed.mjs` → exits 0, confirming its
      `MANDATORY_TREE_GUARDS` assertion for the coverage scan still holds. (The full `pnpm
harness:scan` has pre-existing, unrelated red findings on files this change never touches —
      confirmed via `git diff --stat` and stash-isolated reproduction on clean `origin/develop`; see
      GATE-VERIFY evidence.)
- [x] TC-05: the repository's pinned actionlint invocation (the same command `ci.yml` owns) → exits 0
      for the edited `claude-code-review.yml`.
- [x] TC-06: `! (tr '\n' ' ' < .agents/skills/pr-finding-resolution-loop/SKILL.md | tr -s ' ' | grep -qF "The reviewer on an open PR is the review automation the pull request runs") && ! (tr '\n' ' ' < .agents/skills/automated-review-convergence/SKILL.md | tr -s ' ' | grep -qF "bot review comments") && (tr '\n' ' ' < .agents/skills/pr-finding-resolution-loop/SKILL.md | tr -s ' ' | grep -qF "retired as of INFRA-2631") && (tr '\n' ' ' < .agents/skills/automated-review-convergence/SKILL.md | tr -s ' ' | grep -qF "retired as of INFRA-2631") && echo "TC-06: PASS"`
      → exits 0 and prints `TC-06: PASS`; whitespace is normalized (`tr '\n' ' ' | tr -s ' '`) before
      each check so a soft-wrapped sentence cannot make the negated half vacuously true — confirmed
      today, against the live unfixed files, that this exact command does NOT print `TC-06: PASS`
      (exit 1), i.e. the red-proof is real, not vacuous. Fails unless BOTH outdated phrases are gone
      AND the retirement statement is present in both files.

## Test Plan

| TC-ID | Test Type                 | Tool / Approach                                                                       | Notes                                                                                                                                                                                                                                    |
| ----- | ------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | CI contract unit test     | Vitest against `findWorkflowCoverageFindings` / `findClaudeReviewCoverageFindings`    | Test written: `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `rejects a bare if: false with no retirement marker (INFRA-2631)` and `accepts if: false only when the retirement marker is also present (INFRA-2631)`. |
| TC-02 | CI pipeline smoke test    | `node scripts/harness/scan-claude-review-coverage.mjs`                                | Test written: `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` > `is registered and passes on the live repository` (re-run live for this TC).                                                                            |
| TC-03 | CI pipeline smoke test    | `node scripts/harness/scan-review-token-supply.mjs` / `scan-workflow-permissions.mjs` | Test skipped: these two scans are pre-existing and unmodified by this change (no new test needed); verified directly by live command run, recorded in GATE-COMPLETE evidence.                                                            |
| TC-04 | Repository contract test  | `node scripts/harness/scan-guard-scope-fail-closed.mjs`                               | Test skipped: pre-existing meta-scan, unmodified by this change; verified directly by live command run, recorded in GATE-COMPLETE evidence.                                                                                              |
| TC-05 | Workflow syntax test      | Pinned actionlint invocation from `.github/workflows/ci.yml`                          | Test skipped: CI-owned pinned external tool with no repository test wrapper (same precedent as INFRA-134 TC-04); verified directly by live command run.                                                                                  |
| TC-06 | Doc/process contract test | Negated + positive `grep -qF` chain over the two Round B `SKILL.md` files             | Test skipped: a doc-prose contract check, not application code; verified directly by live command run, recorded in GATE-COMPLETE evidence.                                                                                               |

## User Execution Test Scenarios

Not applicable.

**Reason:** this item disables a repository-owned GitHub Actions review workflow and adjusts
internal harness enforcement scripts and skill prose. It delivers no runnable behavior through the
canonical Robota CLI, TUI, browser UI, or public SDK/example surfaces; a hosted PR's absence of an
automated review comment is repository CI/governance evidence, not a shipped Robota product
interface, so verification stays in the engineering Test Plan above (same precedent as INFRA-134). No
product capability is hidden behind an unwired seam.

## Tasks

- [x] `.agents/tasks/completed/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` — complete

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Failed criteria:**

- Completion Criteria — At least 1 criterion per distinct feature or sub-item (`semantic`): `## Solution`
  step 4 and `## Affected Files` both name two skill-prose edits —
  `.agents/skills/pr-finding-resolution-loop/SKILL.md` and
  `.agents/skills/automated-review-convergence/SKILL.md` — correcting Round B prose that currently
  calls the retired action "the reviewer on an open PR" / a source of "bot review comments." This is a
  distinct, separately-scoped deliverable (prose content in two governance documents, not covered by
  any scan or test that touches `.github/workflows/**` or `scripts/harness/scan-claude-review-coverage.mjs`).
  None of TC-01 through TC-05 verifies it: TC-01 covers the coverage-scan test suite, TC-02 covers the
  live coverage scan, TC-03 covers the two untouched scans, TC-04 covers the full `pnpm harness:scan`
  suite, and TC-05 covers actionlint against the YAML — none reads or asserts anything about the two
  `SKILL.md` files. The skill-prose correction can therefore be silently skipped, half-done, or left
  stale and still show all five TC-N boxes checked at GATE-COMPLETE.
  **Required action:** Add a completion criterion (e.g. TC-06) in Command or Observable-behavior form
  that verifies the two `SKILL.md` files no longer describe `claude-code-review.yml` as an active
  reviewer/comment source (e.g. a grep/scan command with an expected exit code or match count), and add
  the matching row to `## Test Plan`.

**Other semantic criteria checked (all met):**

- Problem section concrete symptom: met — `pnpm harness:scan` then deleting/gutting the action step
  reproduces `claude-review-coverage` reporting `no workflow invokes the governed Claude review action`
  and exiting 1.
- Problem section reproduction condition: met — the exact when/where is stated ("delete or gut the
  action step in `claude-code-review.yml` without any other change").
- Research feeds Alternatives/Decision: met — GitHub's documented `gh workflow disable` mechanism and
  this repo's own `review-gate.yml` `if: ${{ false }}` precedent, both surfaced in Prior Art Research,
  are the explicit basis for Alternative 1/3's pros/cons and for the Decision's chosen idiom.
- Decision references the trade-off: met — Decision explicitly weighs git-tracked reversibility against
  the narrower guard-scope cost, against Alternative 2's destructive/irreversible blast radius and
  Alternative 3's RULE-015 violation.
- New-surface placement (conditional): met — correctly marked N/A; no new package/app/surface or
  layer/product-family reclassification is introduced by this change.
- Each Completion Criterion uses Command/Observable-behavior form: met — TC-01 through TC-05 each name
  an exact command and an expected exit code or observable count.

**Judged by:** backlog-gate-guard (semantic criteria only; mechanical criteria already PASSED per
`node scripts/harness/gate.mjs judge --gate GATE-WRITE`).

### [GATE-WRITE] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Re-run context:** re-judgement after the bounded correction adding TC-06 + its Test Plan row.
`node scripts/harness/gate.mjs judge --gate GATE-WRITE` re-confirms 20 PASS / 0 FAIL / 7
PENDING-GUARDIAN (same 27-criterion set as the prior run). All 7 semantic criteria re-judged fresh
against the current document text (blob `1d555a75f98531edec3f7868b02dc5b488b38a57`), not re-affirmed
from the prior entry.

**Failed criteria:**

- Completion Criteria — At least 1 criterion per distinct feature or sub-item (`semantic`): TC-06 was
  added (`grep -l "INFRA-2631" .agents/skills/pr-finding-resolution-loop/SKILL.md
.agents/skills/automated-review-convergence/SKILL.md | wc -l` → `2`), and it is in command form and
  does target the correct pair of files, so the previous FAIL's narrow gap ("no TC-N names the two
  SKILL.md files at all") is closed. But the required action recorded in the prior FAIL entry asked
  specifically for a criterion that **"verifies the two `SKILL.md` files no longer describe
  `claude-code-review.yml` as an active reviewer/comment source"** — i.e., a check on the actual prose
  defect named in `## Solution` step 4 ("correct the Round B prose that currently describes this
  action as 'the reviewer on an open PR' / a source of 'bot review comments'"). TC-06's command
  verifies neither of those things: it only asserts that the literal substring `INFRA-2631` occurs
  somewhere in each file. That is satisfiable by inserting an unrelated one-line comment or footnote
  (e.g. "see INFRA-2631") into each file while leaving the actual sentences calling the retired action
  "the reviewer on an open PR" / a source of "bot review comments" completely untouched — TC-06 would
  still report `2` and the checkbox could be ticked at GATE-COMPLETE. This is the identical "silently
  skipped, half-done, or left stale" failure mode the original FAIL named for this same sub-item; TC-06
  gives it a TC-N number but does not close it, because the command it specifies measures presence of
  an ID marker, not correction of the cited prose. The distinct sub-item ("the Round B prose no longer
  describes a retired action as an active reviewer") therefore still has no criterion that actually
  verifies it.
  **Required action:** Replace or supplement TC-06 with a check whose command establishes the claim
  its own text makes — e.g. asserting the absence of the specific outdated phrases (`"the reviewer on
an open PR"`, `"bot review comments"`, or the exact strings actually used in each SKILL.md today) in
  both files, in addition to (or instead of) the bare marker-presence count, then update the matching
  `## Test Plan` row and Notes to describe what the command asserts.

**Other semantic criteria checked (all met, re-verified against current document text):**

- Problem section concrete symptom: met — unchanged from the prior entry; `pnpm harness:scan` then
  deleting/gutting the action step reproduces `claude-review-coverage` reporting `no workflow invokes
the governed Claude review action` and exiting 1.
- Problem section reproduction condition: met — unchanged; the exact when/where is stated ("delete or
  gut the action step in `claude-code-review.yml` without any other change").
- Research feeds Alternatives/Decision: met — unchanged; GitHub's documented `gh workflow disable`
  mechanism and this repo's own `review-gate.yml` `if: ${{ false }}` precedent, both surfaced in Prior
  Art Research, are the explicit basis for Alternative 1/3's pros/cons and the Decision's chosen idiom.
- Decision references the trade-off: met — unchanged; Decision explicitly weighs the narrowly-scoped
  guard-branch cost against full reversibility and git-tracked review, against Alternative 2's
  destructive/irreversible blast radius and Alternative 3's RULE-015 violation.
- New-surface placement (conditional): met — unchanged; correctly marked N/A, and no new
  package/app/surface or layer/product-family reclassification is introduced by this change.
- Each Completion Criterion uses Command/Observable-behavior form: met at the surface-form level —
  TC-01 through TC-06 each name an exact command and an expected exit code, count, or output; TC-06's
  form defect (command doesn't establish its own parenthetical claim) is scored under the "at least 1
  criterion per distinct feature or sub-item" criterion above rather than double-counted here, since
  the form itself (command + expected output) is present.

**Judged by:** backlog-gate-guard (semantic criteria only; mechanical criteria already PASSED per
`node scripts/harness/gate.mjs judge --gate GATE-WRITE` — 20 PASS / 0 FAIL / 7 PENDING-GUARDIAN).
**Judged at:** HEAD `c651c769e27c9a0ee147be8ffda937cbc1072610` · document
`.agents/spec-docs/draft/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`
blob `1d555a75f98531edec3f7868b02dc5b488b38a57` (untracked).

### [GATE-WRITE] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Re-run context:** re-judgement after TC-06 was rewritten to the negated+positive `grep -qF` chain
(`! grep -qF "The reviewer on an open PR is the review automation the pull request runs" .agents/skills/pr-finding-resolution-loop/SKILL.md && ! grep -qF "bot review comments" .agents/skills/automated-review-convergence/SKILL.md && grep -qF "retired as of INFRA-2631" ... && grep -qF "retired as of INFRA-2631" ...`).
`node scripts/harness/gate.mjs judge --gate GATE-WRITE` re-confirms 20 PASS / 0 FAIL / 7
PENDING-GUARDIAN (same 27-criterion set as both prior runs). All 7 semantic criteria re-judged fresh
against the current document text (blob `1d555a75f98531edec3f7868b02dc5b488b38a57`) and against the
live content of the two named `SKILL.md` files as they exist today (not taken on the spec's word).

**Failed criteria:**

- Completion Criteria — At least 1 criterion per distinct feature or sub-item (`semantic`): direct
  verification of TC-06's two named target files shows one of its two negated-grep halves is **not a
  real check**. In `.agents/skills/pr-finding-resolution-loop/SKILL.md`, the sentence Solution step 4
  names — "The reviewer on an open PR is the review automation the pull request runs" — is present in
  the file's rendered prose today (line 126–127), but the file's raw text soft-wraps it across two
  physical lines: line 126 ends `...The reviewer on an open PR is the review` and line 127 continues
  `   automation the pull request runs;...` (confirmed by direct read and by
  `grep -n "The reviewer on an open PR" .agents/skills/pr-finding-resolution-loop/SKILL.md`, one hit,
  the wrapped line). `grep -qF` matches per physical line, never across a newline, so
  `grep -qF "The reviewer on an open PR is the review automation the pull request runs" .agents/skills/pr-finding-resolution-loop/SKILL.md`
  reports **no match today** — verified directly: `PHRASE1: NOT FOUND`. That means
  `! grep -qF "The reviewer on an open PR is the review automation the pull request runs" ...` is
  **already true right now, with zero edits applied to that sentence**. Running the exact TC-06
  chain unmodified against the current files confirms the overall chain still fails today only because
  of the _other_ three conditions (phrase 2 is still present, and the retirement marker is absent from
  both files) — but the specific sub-check meant to prove _this file's_ flagged sentence was corrected
  is vacuously satisfied and would remain satisfied even if an implementer left that exact sentence
  completely untouched and only added the `retired as of INFRA-2631` marker text somewhere else in the
  file plus removed the unrelated "bot review comments" phrase from the _other_ file. This is the
  identical failure mode named in both prior FAIL entries for this criterion — "satisfiable by an
  unrelated/trivial edit that leaves the actual outdated sentence untouched" — recurring in a new form:
  not because the check targets the wrong text, but because the check's mechanism (line-based literal
  grep) cannot see a target string that is itself split across a line wrap in the source file. The
  second named phrase, `"bot review comments"` in `.agents/skills/automated-review-convergence/SKILL.md`
  line 31, IS genuinely present on a single physical line (verified: `PHRASE2: FOUND`) — that half of
  TC-06 is a real red-proof — but one of the two required checks failing to function makes the
  criterion as a whole still unmet for the `pr-finding-resolution-loop/SKILL.md` sub-item: it has no
  criterion that actually verifies its correction, only one that reads as if it does.
  **Required action:** Rewrite the phrase-1 half of TC-06 so it is robust to the file's existing line
  wrap — e.g. normalize whitespace/newlines before matching (`tr -s '\n' ' ' < file | grep -qF "..."`),
  use a multi-line-aware match (`grep -Pzo` / `perl -0777`), or split the assertion into two
  single-line substrings that jointly and uniquely identify the flagged sentence's presence (each
  confirmed first to occur on one physical line in the file today, the same way `PHRASE2` was
  confirmed here) — then re-verify against the live, unfixed file that the rewritten check reports the
  phrase as present (not vacuously absent) before relying on its negation as a red-proof, and update
  the `## Test Plan` TC-06 row and Notes to describe the corrected command.

**Other semantic criteria checked (all met, re-verified fresh against current document text and file
content):**

- Problem section concrete symptom: met — `pnpm harness:scan` then deleting/gutting the action step
  reproduces `claude-review-coverage` reporting `no workflow invokes the governed Claude review action`
  and exiting 1 (Problem section, verbatim).
- Problem section reproduction condition: met — the exact when/where is stated ("delete or gut the
  action step in `claude-code-review.yml` without any other change").
- Research feeds Alternatives/Decision: met — GitHub's documented `gh workflow disable` mechanism and
  this repo's own `review-gate.yml` `if: ${{ false }}` precedent (Prior Art Research, with source URLs)
  are the explicit stated basis for Alternative 1/3's pros/cons and the Decision's chosen idiom
  ("matches this repository's own established idiom for a control-plane file kept disabled-but-documented").
- Decision references the trade-off: met — Decision and the Validated Recommendation explicitly weigh
  the narrowly-scoped guard-branch cost against full reversibility and git-tracked review, against
  Alternative 2's destructive/irreversible blast radius and Alternative 3's RULE-015 violation.
- New-surface placement (conditional): met — correctly marked N/A ("no new package, app, presentation
  or interface surface, and no layer or product-family reclassification is introduced"); re-confirmed
  this change introduces no new surface.
- Each Completion Criterion uses Command/Observable-behavior form: met at the surface-form level —
  TC-01 through TC-06 each name an exact command and an expected exit code, count, or printed output;
  TC-06's substantive defect (one of its two grep conditions does not actually detect the target text)
  is scored under the "at least 1 criterion per distinct feature or sub-item" criterion above, per the
  scoring convention this document's own prior FAIL entry established, rather than double-counted here.

**Verification performed directly (not taken on the document's word):**

- `grep -n "The reviewer on an open PR" .agents/skills/pr-finding-resolution-loop/SKILL.md` → one hit,
  line 126, confirmed by direct file read to wrap onto line 127 (`automation the pull request runs`).
- `grep -qF "The reviewer on an open PR is the review automation the pull request runs" .agents/skills/pr-finding-resolution-loop/SKILL.md` → no match (exit 1) against the live, unfixed file.
- `grep -qF "bot review comments" .agents/skills/automated-review-convergence/SKILL.md` → match (exit 0), confirming that half is a genuine red-proof.
- `grep -qF "retired as of INFRA-2631"` against both files → no match in either (exit 1 each), confirming the positive-grep halves are not yet vacuously true.
- Full TC-06 chain run unmodified against the live files today → exits 1 (does not print `TC-06: PASS`), consistent with the retirement statement being genuinely absent — but this does not establish that the phrase-1 negated-grep half would ever function as intended, since it already reports "absent" independent of any fix.

**Judged by:** backlog-gate-guard (semantic criteria only; mechanical criteria already PASSED per
`node scripts/harness/gate.mjs judge --gate GATE-WRITE` — 20 PASS / 0 FAIL / 7 PENDING-GUARDIAN).
**Ordering check:** GATE-WRITE is the catalogue's entry gate (`gate-catalogue.md` § Prior-gate map:
"GATE-WRITE has no prior status gate (it is the entry gate)") — exempt from the prior-gate/status-input
check; not evaluated further.
**Judged at:** HEAD `c651c769e27c9a0ee147be8ffda937cbc1072610` · document
`.agents/spec-docs/draft/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`
blob `263c2c85b99e4a19e9a5df0cc1c92d56747bf353` (untracked).

### [GATE-WRITE] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → review-ready

**Per-criterion results (machine-parseable):**

- GATE-WRITE — Ordering check (entry gate, exempt): PASS — GATE-WRITE has no prior status gate per gate-catalogue.md § Prior-gate map, exempt from the prior-gate/status-input check
- GATE-WRITE — Mechanical criteria (20/20): PASS — frontmatter, status, type, tags, Problem, Prior Art Research, Architecture Review Checklist, Alternatives, Completion Criteria, Test Plan, Tasks, and Evidence Log all present and well-formed per `node scripts/harness/gate.mjs judge --gate GATE-WRITE` (20 PASS, 0 FAIL, 7 PENDING-GUARDIAN)
- GATE-WRITE — Problem section concrete symptom: PASS — exact command and exact output cited (`pnpm harness:scan` then delete/gut the action step, `claude-review-coverage` reports `no workflow invokes the governed Claude review action`, exit 1)
- GATE-WRITE — Problem section reproduction condition: PASS — exact when/where stated ("delete or gut the action step in claude-code-review.yml without any other change")
- GATE-WRITE — Research feeds Alternatives/Decision: PASS — GitHub's workflow-disable docs and this repo's own `review-gate.yml` `if: ${{ false }}` precedent trace directly into Alternative 1's pro and the Decision's closing clause
- GATE-WRITE — Decision references the trade-off: PASS — Decision and Validated Recommendation weigh the narrow guard-branch cost against reversibility, against Alternative 2's destructive/irreversible blast radius and Alternative 3's RULE-015 violation
- GATE-WRITE — New-surface placement (conditional): PASS (N/A) — no new package/app/surface or layer/product-family reclassification is introduced; N/A correctly applies
- GATE-WRITE — At least 1 criterion per distinct feature/sub-item: PASS — TC-06 independently re-verified with normalized-whitespace grep against the live, unfixed SKILL.md files, closing the gap named in the three preceding FAIL entries
- GATE-WRITE — Completion Criteria Command/Observable-behavior form: PASS — TC-01 through TC-06 each name an exact command (or command chain) and an expected exit code, count, or literal printed output

**Re-run context:** re-judgement after TC-06's phrase-1 half was rewritten to normalize whitespace
before matching (`tr '\n' ' ' < <file> | tr -s ' ' | grep -qF "<phrase>"`, applied to all four
sub-checks) so that `.agents/skills/pr-finding-resolution-loop/SKILL.md`'s soft line-wrap of the
flagged sentence across lines 126–127 can no longer make the negated half vacuously true — the exact
defect the immediately preceding FAIL entry named.
`node scripts/harness/gate.mjs judge --gate GATE-WRITE` re-confirms 20 PASS / 0 FAIL / 7
PENDING-GUARDIAN (same 27-criterion set as every prior run this document). All 7 semantic criteria
re-judged fresh against the current document text (blob `86ce15307e2878f73bae408fba59c7421015bfcc`,
distinct from the blob judged in the immediately preceding FAIL entry) and against the live content of
the two named `SKILL.md` files as they exist today.

**Ordering check:** GATE-WRITE is the catalogue's entry gate (`gate-catalogue.md` § Prior-gate map:
"GATE-WRITE has no prior status gate (it is the entry gate)") — exempt from the prior-gate/status-input
check; not evaluated further.

**Mechanical criteria (20/20 PASS):** frontmatter block, `status: draft`, `type: INFRA` (one of the 11
allowed values), `tags:` present; Problem section has no TBD/TODO; `## Prior Art Research` present and
substantiated (two documentation-source URLs cited: GitHub's workflow-disable docs and the
`claude-code-action` repo's `action.yml`); Architecture Review Checklist 5/5 `[x]` with completion
evidence on the Sibling scan item; 3 numbered Alternatives each with Pro/Con; all 6 Completion Criteria
carry a `TC-NN:` prefix and none uses banned vague phrasing; `## Test Plan` present with exactly 6 rows
(TC-01…TC-06) matching the 6 Completion Criteria 1:1, each with non-empty Test Type/Tool and no "TBD",
0 manual rows; `## Tasks` placeholder present; `## Evidence Log` present (non-empty, as this is the
4th GATE-WRITE run on this document — the "first run" mechanical check is satisfied per `gate.mjs`'s
own report of 0 FAIL, since it recognizes prior entries as none being from a later gate); no
`## Status`/`## Classification` body sections.

**Semantic criteria (7/7 met) — each re-checked fresh, independent of the prior entries' findings:**

1. **Problem section concrete symptom — met.** `## Problem` states: run `pnpm harness:scan` today,
   then delete/gut the action step in `claude-code-review.yml` — `claude-review-coverage` "immediately
   reports `no workflow invokes the governed Claude review action` and exits 1." A specific command and
   a specific output/exit code, not a vague description.
2. **Problem section reproduction condition — met.** The exact when/where is stated verbatim: "delete
   or gut the action step in `claude-code-review.yml` without any other change."
3. **Research feeds Alternatives/Decision — met.** Prior Art Research cites GitHub's own
   "Disabling and enabling a workflow" doc and this repo's own `review-gate.yml` `if: ${{ false }}`
   precedent plus `claude-code-action`'s `action.yml`. Alternative 1's pro ("reuses `review-gate.yml`'s
   own established disabled-step idiom") and the Decision's closing clause ("matches this repository's
   own established idiom for a control-plane file kept disabled-but-documented") both trace directly to
   that research, not to an unsupported assertion.
4. **Decision references the trade-off — met.** Decision and the attached Validated Recommendation
   explicitly weigh the narrow guard-branch cost (a new, marker-gated retirement branch in the coverage
   scan) against full git-tracked reversibility, and contrast both against Alternative 2's destructive/
   irreversible blast radius and Alternative 3's RULE-015 violation.
5. **New-surface placement (conditional) — met (N/A correctly applies).** Direct check of `## Affected
Scope`/`## Solution`: every touched path is an existing workflow file, an existing scan script, its
   existing test file, and two existing skill documents — no new package, app, or interface surface,
   and no layer/product-family reclassification. N/A is the correct disposition, not a dodge.
6. **At least 1 criterion per distinct feature/sub-item — met, including the previously-failing
   sub-item.** Enumerated the Solution's 5 steps against the 6 TC-N criteria: step 1 (workflow `if:
false` + marker) → TC-02/TC-05; step 2 (scan script retirement branch) → TC-01/TC-02; step 3 (test
   cases) → TC-01; step 5 (full-suite regression check) → TC-03/TC-04. Step 4 (the two `SKILL.md`
   prose corrections) → TC-06, independently re-verified as follows rather than taken on the document's
   word:
   - Ran the exact TC-06 command, copied verbatim from the document (not retyped from memory), against
     the live, still-unfixed repository files: exit code **1**, no `TC-06: PASS` printed — matches the
     document's own claim.
   - Isolated the phrase-1 negated-grep half and ran it alone, normalized, against the live unfixed
     `pr-finding-resolution-loop/SKILL.md`: `tr '\n' ' ' < <file> | tr -s ' ' | grep -qF "The reviewer
on an open PR is the review automation the pull request runs"` → **matches** (exit 0, "FOUND
     (normalized)"). This is the decisive check: it proves the negated half is now a real, functioning
     assertion against today's unfixed prose (the file's sentence does soft-wrap across physical lines
     126–127, per direct read: line 126 ends "...is the review" and line 127 continues "automation the
     pull request runs;"), rather than the vacuously-true failure mode recorded in the immediately
     preceding FAIL entry, where the un-normalized `grep -qF` never matched a newline-split string and
     so reported "not present" regardless of whether the sentence had been fixed.
   - Confirmed the phrase-2 half (`"bot review comments"` in `automated-review-convergence/SKILL.md`
     line 31) is on one physical line and matches directly — genuine, unaffected by this issue.
   - Confirmed `"retired as of INFRA-2631"` is absent from both files today (normalized-grep, no
     match), so the positive-grep halves are not vacuously true either — the full chain fails today
     for the correct reason (the fix is not yet applied), and would only print `TC-06: PASS` once all
     four conditions are genuinely satisfied.
   - Read the surrounding prose in both files directly to confirm the matched substrings are the exact
     flagged clauses, not partial or coincidental matches: `pr-finding-resolution-loop/SKILL.md` line
     126–127 reads "...The reviewer on an open PR is the review automation the pull request runs; this
     loop RESOLVES what it reports." (target substring is the complete clause up to the semicolon);
     `automated-review-convergence/SKILL.md` line 31 reads "...automated review feedback — bot review
     comments, inline annotations, or static-analysis alerts..." (target substring is the complete
     phrase). Neither is a false-positive/false-negative-prone partial match.
     This closes the gap named in all three prior FAIL entries for this criterion: TC-06 now names the
     correct pair of files, targets the correct flagged sentences, and its check mechanism (normalized
     whitespace before matching) is verified — not merely asserted — to detect the target text correctly
     even though it is soft-wrapped in the source file.
7. **Each Completion Criterion uses Command/Observable-behavior form — met.** TC-01 through TC-06 each
   name an exact command (or command chain) and an expected exit code, count, or literal printed
   output (`TC-06: PASS`); no vague language.

**Verification performed directly (not taken on the document's word):**

- `! (tr '\n' ' ' < .agents/skills/pr-finding-resolution-loop/SKILL.md | tr -s ' ' | grep -qF "The
reviewer on an open PR is the review automation the pull request runs") && ! (tr '\n' ' ' <
.agents/skills/automated-review-convergence/SKILL.md | tr -s ' ' | grep -qF "bot review comments")
&& (tr '\n' ' ' < .agents/skills/pr-finding-resolution-loop/SKILL.md | tr -s ' ' | grep -qF "retired
as of INFRA-2631") && (tr '\n' ' ' < .agents/skills/automated-review-convergence/SKILL.md | tr -s ' '
| grep -qF "retired as of INFRA-2631") && echo "TC-06: PASS"` — copied verbatim from the document and
  run against the live tree → exit **1**, no `TC-06: PASS` output.
- `tr '\n' ' ' < .agents/skills/pr-finding-resolution-loop/SKILL.md | tr -s ' ' | grep -qF "The reviewer
on an open PR is the review automation the pull request runs"` (isolated) → exit 0, match found —
  proves the previously-vacuous negated half now functions.
- `grep -n "The reviewer on an open PR" .agents/skills/pr-finding-resolution-loop/SKILL.md` → line 126,
  confirmed by direct read to wrap onto line 127.
- `grep -n "bot review comments" .agents/skills/automated-review-convergence/SKILL.md` → line 31,
  single physical line, genuine match.
- `grep -n "retired as of INFRA-2631" .agents/skills/pr-finding-resolution-loop/SKILL.md
.agents/skills/automated-review-convergence/SKILL.md` → no output (absent from both), confirming the
  positive-grep halves are not vacuously true.
- `node scripts/harness/gate.mjs judge --gate GATE-WRITE` → `27 criteria judged — 20 PASS, 0 FAIL, 7
PENDING-GUARDIAN`.
- `git rev-parse HEAD` → `c651c769e27c9a0ee147be8ffda937cbc1072610` (unchanged from the prior entry —
  the document is untracked working-tree content, not a new commit). `git hash-object` on the document
  → `86ce15307e2878f73bae408fba59c7421015bfcc` (distinct from the `263c2c85…` blob judged in the
  immediately preceding FAIL entry, confirming this run reads the corrected content).

**Judged by:** backlog-gate-guard (semantic criteria judged fresh in this run; mechanical criteria
PASSED per `node scripts/harness/gate.mjs judge --gate GATE-WRITE` — 20 PASS / 0 FAIL / 7
PENDING-GUARDIAN).
**Judged at:** HEAD `c651c769e27c9a0ee147be8ffda937cbc1072610` · document
`.agents/spec-docs/draft/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`
blob `86ce15307e2878f73bae408fba59c7421015bfcc` (untracked).

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "더이상 claude code review github action이 작동하지 않는다고 가정하고, 하네스에서 코드리뷰에 대한 대응 부분을 비활성화 또는 주석처리해 주세요. 그 후 github action에서 claude code review action을 비활성화 작업을 완료해서 origin/main 브랜치에 머지해줘. 그런 후 이게 main브랜치에 있으면 작동하는거면 main브랜치에만 머지되면 되고, origin/develop 브랜치에도 내용이 필요하면 origin/develop 브랜치에도 머지해줘."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 9c548f49254f (review fd291308, type/tags 06ee2339)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9c548f49254f) equals the document's current fingerprint

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/backlog/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `f38d3b2772fc` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "모두 승인합니다."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 9c548f49254f (review fd291308, type/tags 06ee2339)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9c548f49254f) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document (`semantic`, guardian-judged): MET. `"모두 승인합니다."` ("[I] approve everything.") contains the exact word ("승인") the catalogue's "What counts as explicit approval — Route DIRECT" list gives as example language, strengthened by "모두" into an unqualified whole-document sign-off; no hedge, no clarifying-question form, no category/prefix phrasing that would instead mark it Route CLASS. Given 2026-09-06, this conversation — after GATE-WRITE's PASS, i.e. after the document's Alternatives/Decision/Solution/Completion Criteria already existed in final form. A separate, earlier `[GATE-APPROVAL] — ✅ PASS` entry (superseded by this one, `standingVerdict()`'s last-PASS-wins rule) had instead recorded the user's original task-kickoff instruction as its `**Instruction (verbatim):**` field — text given at the very start of this conversation, before this spec document existed, from which the Problem/Solution were subsequently derived. Judged independently on its own terms: that earlier instruction could not have satisfied this criterion, since a statement made before a document exists cannot confirm — and so is not "directed at" — that document's later-authored design (the specific choice of `if: false` + a marker-gated retirement branch over deleting the workflow outright or a bare `gh workflow disable`, both considered and rejected; the `RETIRED_MARKER`/`isRetiredJob` mechanism; the two SKILL.md prose corrections; the six TC-N criteria — none of it named or yet existing when that instruction was given). Because the standing entry is this one, not that one, the criterion is met on the record as it actually stands.
- GATE-APPROVAL — The item is inside the class as the registry defines it (`semantic`, Route CLASS only, guardian-judged): N/A, correctly so — this entry records `**Approval route:** \`DIRECT\``, no `**Class:**` field is present, and no delegated-class registry entry (`backlog-execution.md` § Delegated Approval Classes) is invoked anywhere in this document; the Route CLASS criteria block does not apply to a DIRECT-routed approval.
- GATE-APPROVAL — Independent architecture validation (conditional) (`semantic`, guardian-judged): N/A, correctly so — direct check of `## Affected Scope` / `## Affected Files` confirms every touched path is an existing workflow file, an existing scan script and its existing test file, and two existing skill documents; no new package/app/interface surface and no layer/product-family reclassification is introduced, so the conditional does not trigger.

**Guardian note on this run:** a first attempt to record this judgement mistakenly appended a second, separate `✅ PASS`-headed GATE-APPROVAL entry lacking the route/instruction/fingerprint fields; because `standingVerdict()` reads whichever `[GATE-APPROVAL] — ✅ PASS` heading is LAST regardless of its fields, that malformed entry briefly became the standing entry and broke `gate.mjs judge`'s mechanical parse (it reported "GATE-APPROVAL names no approval route"), which in turn auto-appended a spurious `❌ FAIL` entry. Both the malformed entry and the resulting spurious FAIL entry have been removed from this log; the guardian's semantic findings are instead merged into this entry's own criteria list, in the form `scripts/harness/gate.mjs`'s own `mergeIntoLastApprovalEntry` uses for a GATE-APPROVAL PASS, so exactly one well-formed standing entry remains. Verified after the fix: `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL` reports `9 criteria judged — 9 PASS, 0 N/A counted apart, 0 FAIL, 0 PENDING-GUARDIAN` is not literally how N/A prints, but the mechanical 6 criteria plus this entry's 3 guardian dispositions leave no PENDING criterion outstanding, and re-running the ordering/mechanical judge no longer errors on a missing route.

**Judged by:** backlog-gate-guard (5 mechanical criteria PASS per `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL`'s original run against this entry; 3 semantic criteria judged fresh by the guardian and merged in above).
**Judged at:** HEAD `c651c769e27c9a0ee147be8ffda937cbc1072610` · base `origin/develop@c651c769e27c9a0ee147be8ffda937cbc1072610` · document `.agents/spec-docs/backlog/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `7f95d7a5aa8cd0739b537c51aaf0a7e28a9c347a` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-06; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 6 checkbox tasks for 6 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 627 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md",
  "specPath": ".agents/spec-docs/todo/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Disable the `review` job in `.github/workflows/claude-code-review.yml` with a job-level `if: false` and a rationale comment, keeping the `uses:`/`with:`/`prompt:` content intact for provenance and quick re-enable."
    },
    {
      "kind": "checkbox",
      "value": "Extend `scripts/harness/scan-claude-review-coverage.mjs` to recognize a job-level `if: false` as a deliberate retirement and skip its shape/marker/prompt-language findings for that workflow, instead of failing the required `scans` job."
    },
    {
      "kind": "checkbox",
      "value": "Update `scripts/harness/scan-guard-scope-fail-closed.mjs`'s `MANDATORY_TREE_GUARDS` entry/tests for the coverage scan if its fail-closed assertion needs adjustment for the new retired-state branch."
    },
    {
      "kind": "checkbox",
      "value": "Add/adjust Vitest coverage in `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` for the retired (`if: false`) case, and confirm `scan-review-token-supply.mjs` and `scan-workflow-permissions.mjs` stay green unmodified (YAML content, including `github_token:` and `permissions:`, is left in place)."
    },
    {
      "kind": "checkbox",
      "value": "Update `.agents/skills/pr-finding-resolution-loop/SKILL.md` and `.agents/skills/automated-review-convergence/SKILL.md` Round B prose so they no longer describe the retired action as \"the reviewer on an open PR\"."
    },
    {
      "kind": "checkbox",
      "value": "Run `pnpm harness:scan`, the affected Vitest suites, and `pnpm harness:verify-like-ci` to confirm nothing else regresses."
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md",
    ".agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/todo/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `f12a321c05b1` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-06

**Status upgrade:** in-progress → verifying

`node scripts/harness/gate.mjs judge --gate GATE-VERIFY --doc <this path> --verify-cmd "pnpm build" --verify-cmd "pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs"` reported 5 criteria judged — 3 PASS, 0 FAIL, 2 PENDING-GUARDIAN; the two pending are judged below by the guardian, directly against the paired Task's `## Plan` section and the live tree (not taken on the Task's word).

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: PASS — last recorded `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-06` entry above; document frontmatter reads `status: in-progress`, the exact input state `gate-catalogue.md`'s GATE-VERIFY row requires.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` is marked complete (`[x]`) (`task-plan-items`): PASS — direct read of the Task file confirms all 6 `## Plan` items are `- [x]` with no unchecked box.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — none of the 6 items contains blocked/pending language, and each item's substantive claim was independently re-verified against the live tree rather than accepted on the Task's word:
  - Item 1 (disable the `review` job): confirmed by direct read of `.github/workflows/claude-code-review.yml` — job carries `if: false`, the exact literal marker `CLAUDE-CODE-REVIEW: RETIRED (INFRA-2631)`, and the `uses:`/`with:`/`prompt:` block is unchanged.
  - Item 2 (extend the coverage scan): confirmed by `git diff -- scripts/harness/scan-claude-review-coverage.mjs` — exports `RETIRED_MARKER` and `isRetiredJob(source, jobIf)`, gated in `findWorkflowCoverageFindings` before the shape/marker/prompt-language checks.
  - Item 3 (guard-scope-fail-closed needs no change): confirmed by reading `scan-guard-scope-fail-closed.mjs`'s `MANDATORY_TREE_GUARDS` entry for the coverage scan (only fires when `.github/workflows` itself is absent, untouched by this diff) and by running `node scripts/harness/scan-guard-scope-fail-closed.mjs` directly → exit 0, `93 guard(s) proven fail-closed by execution`.
  - Item 4 (Vitest coverage + sibling scans stay green): ran `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` directly → exit 0, 22/22 tests passed, including the new retired-marker cases; ran `node scripts/harness/scan-review-token-supply.mjs` and `node scripts/harness/scan-workflow-permissions.mjs` directly → both exit 0 against the live, disabled workflow.
  - Item 5 (SKILL.md prose): `git diff` on both files confirms the flagged sentence ("The reviewer on an open PR is the review automation the pull request runs") and phrase ("bot review comments") are gone, replaced with prose stating the action is retired as of INFRA-2631.
  - Item 6 (full-suite regression check): ran `pnpm harness:scan` (full) directly → 8 of 159 scans fail: `reference-kind-qualified`, `task-path-citations`, `spec-user-execution-section`, `work-run-measurement`, `unearned-done-claims`, `task-plan-items`, `backlog-placement`, `file-size`. Every finding under every one of these 8 names a file this change does not touch (`INFRA-162`, `INFRA-160`, `TEST-013`, `PROC-028` records; `allocate-work-item-id.mjs`/`new-spec.mjs`/`scan-guard-scope-fail-closed.mjs`/`work-run-store.mjs`/`run-all-scans.mjs` file-size baseline drift; a 345-item archived-Task baseline). `claude-review-coverage` itself shows `✓` in this run. Also ran `node scripts/harness/run-all-scans.mjs --affected --context pr --base-ref origin/develop` directly → 6 of 86 scans fail, the same unrelated-file pattern (`task-path-citations`, `spec-user-execution-section`, `work-run-measurement`, `unearned-done-claims`, `task-plan-items`, `backlog-placement`). Note for the record: the Task's own item-6 text names a slightly different, stale enumeration (it says `unearned-done-claims, task-plan-items, backlog-placement, dist, and file-size`, omitting `reference-kind-qualified`/`task-path-citations`/`spec-user-execution-section`/`work-run-measurement` and wrongly naming `dist`, which passes `✓` in this run) — the substantive claim (no red finding traces to a file this change touches) still holds under independent verification, but the specific list drifted since the item was written.
  - Independently verified the separately-flagged `pnpm harness:test` full-suite claim (not part of this Task's Plan, but load-bearing for "no regression"): 7 files fail (`classify-changed-paths.test.mjs`, `gate.test.mjs`, `guards-pass-silently.test.mjs`, `merge-gate-disposition.test.mjs`, `scan-spec-user-execution-section.test.mjs`, `scan-unearned-done-claims.test.mjs`, `task-complete.test.mjs`), none of which import `scan-claude-review-coverage.mjs` (`grep -l` returns no hits) and none of which this diff touches (`git diff --stat HEAD` lists only the 7 files named in item 6's Affected Scope). Ran `task-complete.test.mjs` and `gate.test.mjs` directly: both reproduce the identical `ENOENT: no such file or directory, scandir '.../scripts/harness'` trace at `discovery-loader.mjs:20` (`candidateFiles`) → `discoverAdditionalScans` → `loadScanCommands` → `run-all-scans.mjs:1346`, against a temp fixture lacking a `scripts/harness` subdirectory; `discovery-loader.mjs` itself carries no uncommitted diff (`git diff --stat HEAD -- scripts/harness/discovery-loader.mjs` is empty) and its last change was commit `3381a7d4a` ("discover self-declared scan entrypoints", already on `develop`, unrelated to and preceding this work). `gate.test.mjs` has 76/93 failing tests in this run; 65 show the identical ENOENT trace directly, and the remaining 11 fail on downstream symptoms of the same crash (e.g. `expect(judge(...).status).toBe(0)` receiving `1`, or `expect(result.stdout).toMatch(...)` receiving `''`) rather than a distinct defect — consistent with the shared root cause, not a second regression.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): PASS — ran `pnpm build` directly → `✓ done`, `✓ All build:types complete.`, exit 0.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): PASS — ran `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` directly → `Test Files 1 passed (1)`, `Tests 22 passed (22)`, exit 0. (The pre-existing, unrelated `pnpm harness:test` failures documented above are not "tests for affected packages" under this criterion — none of the 7 failing files, nor the module raising the shared ENOENT, is touched by this change — and this criterion's own scope, per `gate.mjs`'s own verify-cmd contract, is the caller-supplied test command, which passes.)

**Judged by:** backlog-gate-guard (3 mechanical criteria PASS per `node scripts/harness/gate.mjs judge --gate GATE-VERIFY`; 2 PENDING-GUARDIAN criteria judged fresh above, directly against the Task file and the live tree).
**Judged at:** HEAD `c651c769e27c9a0ee147be8ffda937cbc1072610` · base `origin/develop@c651c769e27c9a0ee147be8ffda937cbc1072610` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `9c66511a918f0a0d55cf8973050e453ccc151e48` (untracked; the blob of the content immediately BEFORE this entry's own append, hashed at read time — this entry's append is the record of that judgement, not part of the judged content)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
3:25:20 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-6

 ✓ scripts/harness/__tests__/scan-claude-review-coverage.test.mjs (22 tests) 16ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  15:25:20
   Duration  242ms (transform 44ms, setup 0ms, collect 55ms, tests 16ms, environment 0ms, prepare 38ms)
```

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `d3bd50810853` (untracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/scan-claude-review-coverage.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 1 governed workflow(s)
claude-review-coverage: PASS
```

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `70497d32fd52` (untracked)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/scan-review-token-supply.mjs; node scripts/harness/scan-workflow-permissions.mjs`
**Exit:** 0
**Output:** (last 5 of 5 line(s))

```
::examined:: 1 workflow files
review-token-supply scan passed: every claude-code-action step in .github/workflows/claude-code-review.yml supplies github_token.
---
::examined:: 10 write scopes read from workflows on disk
workflow-permissions scan passed: 10 declared write scope(s), each justified. (offline — live default not read)
```

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `142a1d77a5af` (untracked)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/scan-guard-scope-fail-closed.mjs`
**Exit:** 0
**Output:** (last 5 of 5 line(s))

```
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
fatal: not a git repository (or any of the parent directories): .git
::examined:: 93 pinned guards
guard-scope-fail-closed scan passed (93 guard(s) proven fail-closed by execution; 3 measured VACUOUS and recorded unfixed in HARNESS-052, 14 fail closed but are not pinned here). This is not a claim that no guard can be satisfied vacuously.
```

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `20493e990df7` (untracked)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-06

**Command:** `actionlint -color .github/workflows/claude-code-review.yml (pinned v1.7.7)`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```

```

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `75d4ef297869` (untracked)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-06

**Command:** `grep chain over the two Round B SKILL.md files (see Completion Criteria)`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
TC-06: PASS
```

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `c028520249a2` (untracked)

### [GATE-COMPLETE] — ❌ FAIL | 2026-09-06

**Status remains:** verifying
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02, TC-03, TC-04, TC-05, TC-06: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02, TC-03, TC-04, TC-05, TC-06: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02, TC-03, TC-04, TC-05, TC-06: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `110464df9222` (untracked)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-06

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-06; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (6)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 6/6 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (6) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 6/6 tasks `[x]` in .agents/tasks/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md

**Judged at:** HEAD `c651c769e27c` · base `origin/develop@c651c769e27c` · document `.agents/spec-docs/active/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md` blob `51e3b9ab62ca` (untracked)
