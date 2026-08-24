---
status: review-ready
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

- [ ] TC-01: The verifier contract queries `gh pr checks <n> --required` for the merged PR and names
      fail, cancel, and pending current required results as blocking.
- [ ] TC-02: The verifier contract states that unfiltered/historical checks are diagnostic only and
      that acknowledgement is consumed through the required `review-gate`, never as a blanket bypass.
- [ ] TC-03: `node scripts/harness/scan-review-findings.mjs` exits 1 when either TC-01 or TC-02 is
      removed from a fixture and exits 0 on the compliant fixture.
- [ ] TC-04: The targeted Vitest file and the full harness contract tier exit 0, and live read-only
      verification shows PR #2160 has a green required set despite its retained raw CodeQL failure.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                              | Notes |
| ----- | --------- | ------------------------------------------------------------ | ----- |
| TC-01 | INFRA     | `scan-review-findings.test.mjs` fail/cancel/pending fixtures |       |
| TC-02 | INFRA     | `scan-review-findings.test.mjs` raw-history/ack fixture      |       |
| TC-03 | INFRA     | scan CLI green and deliberate-red fixtures                   |       |
| TC-04 | INFRA     | targeted Vitest, contract tier, `gh pr checks --required`    |       |

## Tasks

- [ ] `.agents/tasks/HARNESS-119-merge-verifier-rejects-acknowledged-or-superseded-check-failures.md`
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
