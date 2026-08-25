---
status: done
type: INFRA
tags: [async]
---

# HARNESS-119: Merge verifier rejects acknowledged or superseded check failures

## Problem

The mandatory post-merge verifier tells its worker to inspect unfiltered `gh pr checks <n>` output
and treats a red required result as a finding. That output can retain historical or advisory failures
that are not the effective required-check decision GitHub used to authorize the merge.

PR #2160 reproduces the contradiction. It merged with required `review-gate` green, an explicit
`review-findings-acknowledged` label, and a recorded disposition. `gh pr checks 2160` still prints a
historical CodeQL failure, while `gh pr checks 2160 --required` reports all 11 required contexts green.
A verifier following the current prose can therefore return FAIL after the merge gate legally passed.
The opposite error must remain impossible: a current required failure, cancellation, or pending result
must never be hidden by a historical success or by an acknowledgement applied to a different finding.

## Prior Art Research

### References consulted

- [GitHub CLI: `gh pr checks`](https://cli.github.com/manual/gh_pr_checks) provides `--required` to
  select only required checks and classifies results as pass, fail, pending, skipping, or cancel.
- [GitHub: Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
  states that required checks must pass for the latest relevant commit SHA; earlier-commit results do
  not satisfy the requirement.
- [GitHub REST API: Check runs](https://docs.github.com/en/rest/checks/runs) defaults check-run listing
  to `filter=latest`; callers request historical runs explicitly with `filter=all`.
- [GitHub Actions: Re-running workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
  keeps a retry bound to the original `GITHUB_SHA` and `GITHUB_REF`, presents the latest attempt, and
  retains previous attempts for inspection.
- [GitHub: Resolving code-scanning alerts](https://docs.github.com/en/enterprise-cloud@latest/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts)
  records an accepted dismissal and preserves the closed history rather than deleting the finding.
- [GitLab: Auto-merge pipeline success](https://docs.gitlab.com/user/project/merge_requests/auto_merge/#pipeline-success-for-auto-merge)
  and [GitLab CI `allow_failure`](https://docs.gitlab.com/ci/yaml/#allow_failure) likewise separate an
  effective merge disposition from retained failed-attempt or warning history.

### Observed common behavior and Robota constraints

CI systems separate historical observations from the effective decision used by the merge gate. A
successful latest retry can replace a failed attempt for merge eligibility while the failed attempt
remains inspectable. Explicitly accepted findings retain audit evidence but stop blocking only through
a recorded disposition.

Robota must evaluate the same required-check projection and exact PR head before and after merge.
Unfiltered checks remain diagnostics, not the verdict. A current required failure, cancellation, or
pending result, an indeterminate required-check set, or missing disposition evidence must fail closed.
`review-findings-acknowledged` is not a blanket verifier bypass: its effect is represented by the
required `review-gate` result that already validated and recorded the disposition.

### Recommendation

Use GitHub's current required-check projection (`gh pr checks <n> --required`) as the post-merge CI
verdict for the exact merged PR head. Keep unfiltered checks and previous attempts only as supplemental
diagnostics. Mechanically guard the verifier contract so it cannot regress to raw history, and prove
both directions: PR #2160 passes from its effective required set, while any current required failure,
cancellation, or pending state prevents `MERGE VERIFIED: PASS`.

## Architecture Review

> **Contained — HARNESS-120.** GATE-APPROVAL has no independent-review criterion for a universal
> workflow contract unless it is also a new surface; the active HARNESS-120 Task and issue #2326 own
> the wide-blast classification and guardian fixture.

### Affected Scope

- `.claude/agents/merge-verifier.md` — post-merge CI evidence and verdict contract.
- `scripts/harness/scan-review-findings.mjs` — mechanical presence floor for the verifier's effective
  required-check contract.
- `scripts/harness/__tests__/scan-review-findings.test.mjs` — green/red semantic fixtures.
- `.agents/tasks/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md`
  — work record and verification result.

No package, public API, application surface, or dependency direction changes.

### Alternatives Considered

1. **Use GitHub's effective required-check projection and retain raw checks only as diagnostics.**
   Pro: matches branch protection, review-gate replacement semantics, exact-head retries, and documented
   provider behavior. Con: a non-required check cannot independently block post-merge verification; it
   must first be promoted into the required gate or reported as a separate finding.
2. **Fetch every check run and manually fold names, suites, attempts, SHAs, labels, and conclusions.**
   Pro: maximum diagnostic control. Con: duplicates GitHub's merge-eligibility logic and is likely to
   drift on reruns, app-provided checks, skipped states, or renamed contexts.
3. **Keep unfiltered `gh pr checks` and add exceptions for known historical failures and labels.**
   Pro: smallest prose edit. Con: exception order becomes a second merge policy, and an acknowledgement
   risks becoming a blanket bypass rather than the input to the required review gate.

### Decision

Choose alternative 1. The trade-off is deliberate: post-merge verification checks whether the merge
that GitHub authorized landed correctly, so the provider's current required projection is the canonical
decision. Raw history is still reported for diagnosis but cannot override the required projection. The
required `review-gate` owns acknowledgement validation; the verifier consumes its green/red result rather
than reimplementing label semantics. A scan plus red/green fixtures guard both the `--required` selection
and the fail-closed treatment of non-success required states.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `review-gate`, `ci-gate-watch`, `post-merge-cycle`, and the existing
      `review-findings` scan all inspected; no second merge-decision owner is introduced.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## User Execution Test Scenarios

> **Contained — HARNESS-121.** The author returned not-applicable only after implementation had begun;
> the active HARNESS-121 Task and issue #2327 own the durable pre-implementation ordering signal that
> current final-state scans lack.

Not applicable. HARNESS-119 changes only internal repository governance: the post-merge verifier
contract and its harness scan/tests. It introduces no runnable Robota CLI, TUI, browser, or public SDK
behavior. Harness commands and `gh pr checks` are engineering verification rather than user-execution
scenarios, so inventing one would misclassify an internal guard as a product surface.

## Solution

Revise the merge-verifier's CI check so it records the PR head, queries the current required contexts
with `gh pr checks <n> --required`, and returns FAIL for any required fail, cancel, or pending state.
It may also inspect unfiltered output, previous attempts, and acknowledgement metadata, but labels and
historical runs are explanatory evidence only; they cannot independently turn a required failure green
or a required success red.

Extend the existing `review-findings` mechanical floor to read the merge-verifier definition and require
the effective required-check selection plus explicit fail-closed wording. Add fixture tests that go red
when `--required` is dropped, when raw history becomes verdict-bearing, or when current required
non-success states are permitted.

## Affected Files

- `.claude/agents/merge-verifier.md`
- `scripts/harness/scan-review-findings.mjs`
- `scripts/harness/__tests__/scan-review-findings.test.mjs`
- `.agents/tasks/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md`

## Completion Criteria

- [x] TC-01: The verifier contract queries `gh pr checks <n> --required` for the merged PR and names
      fail, cancel, and pending current required results as blocking.
- [x] TC-02: The verifier contract states that unfiltered/historical checks are diagnostic only and
      that acknowledgement is consumed through the required `review-gate`, never as a blanket bypass.
- [x] TC-03: `node scripts/harness/scan-review-findings.mjs` exits 1 when either TC-01 or TC-02 is
      removed from a fixture and exits 0 on the compliant fixture.
- [x] TC-04: The targeted Vitest file and the full harness contract tier exit 0, and live read-only
      verification shows PR #2160 has a green required set despite its retained raw CodeQL failure.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                              | Notes                                                                                                                                                                                                                                                                                                                                                 |
| ----- | --------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | INFRA     | `scan-review-findings.test.mjs` exact-head/fail-closed cases | Test written: `scripts/harness/__tests__/scan-review-findings.test.mjs` > `flags a verifier that dropped the required-check projection`, `flags a verifier that no longer reads the exact PR head`, `flags a verifier that permits a current required non-success state`, and `flags a verifier that does not fail closed on an indeterminate query`. |
| TC-02 | INFRA     | `scan-review-findings.test.mjs` raw-history/ack cases        | Test written: `scripts/harness/__tests__/scan-review-findings.test.mjs` > `flags a verifier that lets raw or historical checks decide the verdict` and `flags a verifier that treats acknowledgement as a blanket bypass`.                                                                                                                            |
| TC-03 | INFRA     | scan CLI green and deliberate-red fixtures                   | Test written: `scripts/harness/__tests__/scan-review-findings.test.mjs` > `scan-review-findings CLI` plus the seven deliberate-red merge-verifier cases; the current targeted suite contains 16 tests.                                                                                                                                                |
| TC-04 | INFRA     | targeted Vitest, contract tier, live GitHub comparison       | Test skipped for the external retained-history state: a local fixture cannot prove GitHub's stored PR #2160 check history. Read-only live commands verified it, while the targeted and full automated tiers cover the repository-owned behavior.                                                                                                      |

## Tasks

- [x] `.agents/tasks/completed/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md`
      — issue-to-backlog conversion created the Task; GATE-IMPLEMENT must validate its TC mapping.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-25

**Status upgrade:** draft → review-ready

- Frontmatter opening block: the file begins with a delimited YAML frontmatter block.
- Frontmatter status: `status: draft` is present.
- Frontmatter type: `type: INFRA` is one exact value from the allowed prefix list.
- Frontmatter tags: `tags: [async]` is present.
- Problem concrete symptom: the verifier can return FAIL after a legal merge because retained raw CodeQL history conflicts with the effective required-check decision.
- Problem reproduction condition: PR #2160 and the differing `gh pr checks 2160` versus `gh pr checks 2160 --required` results identify when and where the symptom occurs.
- Problem specificity: the section is multi-sentence, concrete, and contains no prohibited placeholder tokens.
- Prior Art Research section: `## Prior Art Research` is present.
- Research substantiation: the section cites GitHub CLI, GitHub documentation/API/Actions/code-scanning documentation, and GitLab CI documentation.
- Research waiver: N/A because comparable documentation sources were found and cited; no waiver is required.
- Research-to-decision trace: the observed effective-decision-versus-history behavior feeds the alternatives and the recommendation to use the required-check projection.
- Architecture checklist completeness: all four checklist items are marked `[x]`.
- Sibling scan: marked `[x]` and names `review-gate`, `ci-gate-watch`, `post-merge-cycle`, and the existing `review-findings` scan as inspected siblings.
- Alternatives: three alternatives each state a concrete pro and con.
- Decision trade-off: the Decision explicitly chooses provider-required projection accuracy while retaining raw history only for diagnosis.
- New-surface placement: N/A because the spec changes an existing agent contract and harness scan only; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- Completion Criteria prefixes: all four criteria use sequential `TC-01` through `TC-04` prefixes.
- Completion Criteria coverage: the verifier contract, diagnostic/acknowledgement semantics, mechanical regression floor, and targeted/full/live verification each have a distinct criterion.
- Completion Criteria observability: each criterion names an inspectable contract statement, command exit result, fixture behavior, or live check result.
- Completion Criteria wording: none uses the prohibited vague completion phrases.
- Test Plan section: `## Test Plan` is present.
- Test Plan count: four rows map one-to-one to the four Completion Criteria (`TC-01` through `TC-04`).
- Test Plan detail: every row has a non-empty Test Type and Tool / Approach with no placeholder value.
- Manual-test notes: N/A because no Test Plan row uses `manual` as its tool.
- Tasks structure: `## Tasks` is present with an unchecked task-file placeholder for GATE-IMPLEMENT validation.
- Evidence structure: `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Body metadata structure: no `## Status` or `## Classification` body section is present.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-25

**Status remains:** review-ready
**Failed criteria:**

- Explicit approval in the current conversation: the user stated `지금부터 이 브랜치의 규칙과 스킬과 훅의 모순을 찾고 평가해서 강제화 되지 않은 것이라던지 유명무실 한것들을 찾아내어 수정해서 pr을 등록하며 pr프로세스에 맞게 처리하고 머지하면서 문제를 모두 해결할 때까지 반복하세요.` This authorizes the overall rule/skill/hook audit and remediation campaign, but it does not confirm the design recorded later in this specific spec document.
  **Required action:** Present this review-ready HARNESS-119 design to the user and obtain an explicit statement approving this document's recommendation and authorizing its implementation, then re-run GATE-APPROVAL.
- Direct, unambiguous statement directed at this spec document: the supplied statement names the campaign scope but neither names HARNESS-119 nor confirms its required-check-projection design; it therefore does not meet the document-directed approval criterion.
  **Required action:** Obtain a direct approval of HARNESS-119 after the user has been presented with this spec's recommendation.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-25

**Status upgrade:** review-ready → approved

- Explicit approval in the current conversation: after the specific HARNESS-119 recommendation and the prior GATE-APPROVAL failure were presented, the user stated verbatim `모두 포괄적 승인할게`.
- Direct, unambiguous statement directed at this spec document: in that immediate context, `모두` covers the presented HARNESS-119 design and scope, while `승인할게` explicitly confirms it and authorizes implementation; this is neither silence nor an answer to a clarifying question.
- Post-approval document integrity: no Architecture Review or frontmatter type/tags modification occurred after the approval statement; the document remains `status: review-ready`, `type: INFRA`, and `tags: [async]` with its reviewed recommendation intact.
- Independent architecture validation: N/A because HARNESS-119 changes an existing merge-verifier agent contract and existing harness scan only; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- Premature implementation check: no implementation diff or commit exists for `.claude/agents/merge-verifier.md`, `scripts/harness/scan-review-findings.mjs`, or `scripts/harness/__tests__/scan-review-findings.test.mjs`; the approval gate therefore ran before implementation.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-25

**Status upgrade:** approved → in-progress

- Task existence: `.agents/tasks/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md` exists.
- Task path recording: the spec's `## Tasks` section records that exact active Task path.
- TC-01 mapping: the Task requires defining the fail-closed effective-required-check source of truth, corresponding to the spec's required-check query and blocking-state contract.
- TC-02 mapping: the Task requires historical/advisory checks not to override the source of truth while current required non-success remains blocking, corresponding to the spec's diagnostic-only and acknowledgement semantics.
- TC-03 mapping: the Task requires a semantic harness regression test for unfiltered history and current required failures, corresponding to the spec's deliberate-red and compliant fixture criterion.
- TC-04 mapping: the Task requires live verification against PR #2160 and a current all-green PR, corresponding to the spec's targeted, full-tier, and live comparison criterion.
- Task coverage: four Task plan items provide at least one item for each of `TC-01` through `TC-04`.
- Task Test Plan: `## Test Plan` is present and contains substantially more than 50 characters, covering unit/contract fixtures, targeted and full harness verification, and the live read-only GitHub comparison.

### [GATE-VERIFY] — ✅ PASS | 2026-08-25

**Status upgrade:** in-progress → verifying

- Task completion state: all four Plan items in `.agents/tasks/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md` are marked `[x]` and map to `TC-01` through `TC-04`.
- Blocked or pending tasks: none; the linked Task contains no unchecked Plan item and records completion evidence for every planned item.
- Affected-package build: N/A because the actual diff changes only repository-governance surfaces under `.claude/agents`, `scripts/harness`, and `.agents`; no package source or package build target is affected.
- Targeted contract verification: `pnpm exec vitest run scripts/harness/__tests__/scan-review-findings.test.mjs` was independently re-run by this guardian and exited 0 with 1 file and 14/14 tests passing.
- Required-section regression: `pnpm exec vitest run scripts/harness/__tests__/scan-spec-user-execution-section.test.mjs` was independently re-run by this guardian and exited 0 with 1 file and 12/12 tests passing.
- Full affected test tier: `pnpm harness:test:contracts` exited 0 with 177 test files and 3802 tests passing, as recorded in the linked Task's Evidence section.
- Full mechanical verification: `pnpm harness:scan` completed with 143 scans passing, 2 policy-defined skips, and 0 failures, as recorded in the linked Task's Evidence section.

### [GATE-COMPLETE: TC-01] — ✅ VERIFIED | 2026-08-25

- Action: inspected `.claude/agents/merge-verifier.md`, then ran `pnpm exec vitest run scripts/harness/__tests__/scan-review-findings.test.mjs`.
- Result: the contract uses `gh pr checks <n> --required`, binds it to `headRefOid`, and blocks current required fail, cancel, and pending states; the required-projection and non-success red fixtures passed.
- Exit code: 0; targeted result was 14/14 tests passed.
- Test reference: `scripts/harness/__tests__/scan-review-findings.test.mjs` > `flags a verifier that dropped the required-check projection` and `flags a verifier that permits a current required non-success state`.

### [GATE-COMPLETE: TC-02] — ✅ VERIFIED | 2026-08-25

- Action: inspected `.claude/agents/merge-verifier.md` and ran the same targeted Vitest command.
- Result: unfiltered and historical checks are diagnostic only; acknowledgement is consumed only through required `review-gate` and is never a blanket bypass; both semantic red fixtures passed.
- Exit code: 0; targeted result was 14/14 tests passed.
- Test reference: `scripts/harness/__tests__/scan-review-findings.test.mjs` > `flags a verifier that lets raw or historical checks decide the verdict` and `flags a verifier that treats acknowledgement as a blanket bypass`.

### [GATE-COMPLETE: TC-03] — ✅ VERIFIED | 2026-08-25

- Action: ran `node scripts/harness/scan-review-findings.mjs` and `pnpm exec vitest run scripts/harness/__tests__/scan-review-findings.test.mjs`.
- Result: the live scan reported `review-findings scan passed`; the CLI green fixture exited 0, deliberate-red fixtures exited 1 and named the dropped contracts, and all 14 tests passed.
- Exit code: 0 for the compliant scan and targeted suite; the fixture assertions confirmed exit 1 for contract removal.
- Test reference: `scripts/harness/__tests__/scan-review-findings.test.mjs` > `scan-review-findings CLI` and the five merge-verifier RED cases.

### [GATE-COMPLETE: TC-04] — ✅ VERIFIED | 2026-08-25

- Action: ran `pnpm harness:test:contracts`, `pnpm harness:scan`, `gh pr checks 2160`, `gh pr checks 2160 --required`, and `gh pr checks 2304 --required`.
- Result: 177/177 contract files and 3802/3802 tests passed; 143 harness scans passed with 2 policy-defined skips and zero failures. Raw PR #2160 checks retained a CodeQL failure and exited 1, while all 11 required contexts passed and exited 0; PR #2304's 11 required contexts also passed and exited 0.
- Exit code: 0 for both repository gates and both required-check queries; 1 was the expected raw-history diagnostic result for PR #2160.
- Test reference: automated repository behavior is covered by `scripts/harness/__tests__/scan-review-findings.test.mjs`; an automated test for GitHub's stored PR #2160 history was skipped because that external immutable state cannot be reproduced by a local fixture, so the read-only live commands provide the evidence.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-25

**Status upgrade:** verifying → done

- Ordering and input state: `GATE-VERIFY` has a specific recorded PASS, the frontmatter is `status: verifying`, and the document is under `.agents/spec-docs/active/`.
- Completion Criteria: `TC-01`, `TC-02`, `TC-03`, and `TC-04` are all marked `[x]`.
- TC-01 evidence: exactly one `[GATE-COMPLETE: TC-01]` entry records the inspection/action, observed required-projection and blocking-state result, exit code 0, 14/14 targeted tests, and exact test references.
- TC-02 evidence: exactly one `[GATE-COMPLETE: TC-02]` entry records the inspection/action, observed diagnostic-only and acknowledgement result, exit code 0, 14/14 targeted tests, and exact test references.
- TC-03 evidence: exactly one `[GATE-COMPLETE: TC-03]` entry records both commands, observed compliant and deliberate-red behavior, exit codes 0 and expected 1, and exact test references.
- TC-04 evidence: exactly one `[GATE-COMPLETE: TC-04]` entry records the repository and live GitHub commands, observed contract/scan and required/raw results, their exit codes, and the external-state test disposition.
- Test Plan TC-01: references `scripts/harness/__tests__/scan-review-findings.test.mjs` and the two exact required-projection/non-success test names.
- Test Plan TC-02: references the same durable test file and the two exact raw-history/acknowledgement test names.
- Test Plan TC-03: references the durable test file's CLI suite and five deliberate-red cases.
- Test Plan TC-04: records an explicit skip reason for GitHub's immutable stored PR #2160 history, which a local fixture cannot reproduce, and records the read-only live verification used instead; repository-owned behavior remains covered by the durable test file.
- Active Task pointer: `## Tasks` names the exact path `.agents/tasks/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md`, and that file exists under `.agents/tasks/`.
- Task completion readiness: all four linked Task Plan items are marked `[x]`; no unchecked, blocked, or pending work item remains.
