---
status: draft
type: INFRA
tags: [async]
---

# HARNESS-120: Recommendation endorsement is required but unenforced

## Problem

The Recommendation Gate universally requires an independent `proposal-reviewer` verdict before work may
advance, and the orchestrator requires the verdict and date to be recorded. GATE-APPROVAL, however, checks
independent evidence only when a proposal introduces or reclassifies a surface. No guardian or scan reads
the universal verdict record, so the repository can satisfy the approval pipeline without satisfying the
Recommendation Gate that is supposed to precede it.

HARNESS-119 is a concrete recurrence. It changed the merge-verifier contract used after every PR merge,
recorded GATE-APPROVAL's independent-validation condition as N/A, and merged without a `REVIEW VERDICT:
ENDORSE` in its Task, spec, or PR description. The original HARNESS-120 issue proposed a wide-blast-only
condition, but independent depth review found that this would contain one symptom while leaving the same
universal bypass open for ordinary recommendations.

## Prior Art Research

### Sources consulted

- [GitHub — About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
  documents path-owned review and recommends protecting `CODEOWNERS` itself. It also permits one matching
  owner to satisfy ownership review, so expertise and independence are separate properties.
- [GitHub — About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
  supports required approvals, stale-approval dismissal, and approval of the latest reviewable push by
  someone other than its pusher. Approval is therefore bound to the reviewed revision, not merely a topic.
- [GitHub — About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets)
  applies all matching protections and resolves overlap toward the stricter requirement; a stronger review
  condition composes with existing checks instead of replacing them.
- [GitLab — Merge request approval rules](https://docs.gitlab.com/user/project/merge_requests/approvals/rules/)
  documents multiple approval rules, restrictions on overriding them, and explicit handling of whether a
  changed default applies to existing merge requests.
- [NIST SP 800-53 Rev. 5.1](https://csrc.nist.gov/CSRC/media/Projects/risk-management/800-53%20Downloads/800-53r5/SP_800-53_v5_1-derived-OSCAL.pdf)
  CM-3 requires impact analysis, approval or rejection, a retained decision record, and prohibition until
  approval; AC-5 requires separation of duties; SA-11(3) requires an independent verifier with sufficient
  information to assess the plan and evidence.

### Applicable patterns and repository gap

The common pattern is a fail-closed, revision-bound approval whose reviewer is distinct from the producer,
whose decision remains auditable, and whose stronger conditions compose. Robota already owns the universal
independence policy in `backlog-execution.md`; inventing a second wide-blast classification would contradict
that owner. The missing part is a durable subject/current-revision record that GATE-APPROVAL and a scan both
verify. Historical work needs an explicit prospective boundary rather than fabricated review evidence.

### Recommendation derived from the research

Require every recommendation to carry a committed-subject review record containing the exact spec subject,
reviewed commit, zero unresolved findings, and `REVIEW VERDICT: ENDORSE`. Verify that the reviewed commit's
decision material still matches the current spec, excluding only lifecycle status and gate-written Evidence
Log entries. Keep new-surface placement review as additional required content. Grandfather only exact
historical states through a frozen baseline; any nonterminal status transition or material edit invalidates
that exemption.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — sole owner of the universal recommendation-review record and
  prospective-adoption contract.
- `.agents/specs/gate-catalogue.md` — GATE-APPROVAL criterion that invokes the universal check and retains
  new-surface placement as additive evidence.
- `.agents/skills/backlog-execution-orchestrator/SKILL.md` — record-and-route contract for the independent
  verdict.
- `.claude/agents/proposal-reviewer.md` — subject/revision/unresolved-count output contract.
- `.claude/agents/backlog-gate-guard.md` — guardian instruction to verify machine-checkable external evidence
  rather than accept a bare self-claim.
- `.agents/specs/orchestration-map.md` — recommendation-gate mechanical-floor status.
- `scripts/harness/scan-recommendation-endorsement.mjs` — exact record, revision, current-material, and
  prospective-baseline enforcement.
- `scripts/harness/recommendation-endorsement-baseline.json` — frozen historical states without invented
  reviewer evidence.
- `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs` — deliberate-green/red fixtures.
- `scripts/harness/run-all-scans.mjs` and root command wiring — mandatory scan reachability.
- `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` — re-scoped work record and
  independent verdict.

No package, public API, application, runtime dependency, or user-facing behavior changes.

### Alternatives Considered

1. **Enforce the existing universal Recommendation Gate with a subject/current-revision record.** Pro:
   repairs the actual rule/enforcer mismatch, prevents self-approval for every work unit, and makes stale
   review observable. Con: every future recommendation needs a committed planning revision and independent
   review record before approval.
2. **Add an independent-review condition only for a newly defined wide-blast class.** Pro: fewer proposals
   require the stronger evidence. Con: duplicates the already-universal rule, needs a fallible blast-radius
   classifier, and leaves ordinary recommendations able to repeat the measured bypass.
3. **Keep prose-only orchestration and rely on reviewers to notice missing verdicts.** Pro: no new scan or
   historical adoption work. Con: this is the current failed state; HARNESS-119 proves that a required
   verdict can be omitted while every existing gate still passes.
4. **Require a verdict token without binding it to subject or revision.** Pro: simplest mechanical search.
   Con: a verdict for another proposal or an older design can satisfy the check, converting independent
   review into a reusable label rather than evidence.

### Decision

Choose alternative 1. `backlog-execution.md` remains the single policy owner: every Recommendation Gate
requires an independent `proposal-reviewer` ENDORSE, not just wide-blast work. The exact Task records the
review subject basename, the full reviewed commit SHA, `UNRESOLVED FINDINGS: 0`, the dated verdict, and the
reviewer's reasoning. GATE-APPROVAL invokes one checker that proves the revision exists, contains that
subject, precedes the current state, and has the same decision material after normalizing only frontmatter
status and the gate-owned Evidence Log. New-surface placement remains additional review content under the
existing rule; it is not weakened or reclassified.

The mechanical scan applies to post-approval documents. A frozen baseline may identify exact historical
path/status/material-digest states that predate this enforcement; it never asserts that review happened.
Completed historical states remain auditable exemptions. A nonterminal item loses its exemption on its next
status/folder transition or material revision, so active work converges prospectively without fabricating
past evidence. The scan rejects missing, mismatched, stale, non-ENDORSE, or unresolved records and stale or
unnecessary baseline entries.

Validation before approval covers reachability (the same checker is invoked by GATE-APPROVAL and the
mandatory scan), capability preservation (the existing new-surface placement criterion remains additive),
and adversarial failure modes (wrong subject, non-ancestor or stale revision, later material edits, unresolved
findings, and forged historical equivalence all fail closed).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — Recommendation Gate, GATE-APPROVAL, proposal-reviewer, backlog-gate-guard,
      user-execution PLAN binding, and orchestration-map enforcement rows inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## User Execution Test Scenarios

Not applicable. This changes internal planning and approval governance plus its repository-local mechanical
tests. It introduces no runnable CLI, TUI, browser, public SDK, or other user-executed Robota behavior;
engineering scan commands are verification, not user scenarios.

## Solution

Define the universal review-record schema and prospective adoption in the owning backlog rule. Extend the
proposal-reviewer output and orchestrator recording contract to produce that schema in the exact Task. Make
GATE-APPROVAL verify it before user approval can advance, with new-surface placement checks layered on top.
Implement one mandatory scan that pairs post-approval specs to their Tasks, validates the review revision
against current decision material, and permits only frozen exact historical states. Update the orchestration
map from PENDING only after the scan is registered and tested.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-execution-orchestrator/SKILL.md`
- `.claude/agents/proposal-reviewer.md`
- `.claude/agents/backlog-gate-guard.md`
- `.agents/specs/orchestration-map.md`
- `scripts/harness/scan-recommendation-endorsement.mjs`
- `scripts/harness/recommendation-endorsement-baseline.json`
- `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`
- `scripts/harness/run-all-scans.mjs`
- `package.json`
- `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md`

## Completion Criteria

- [ ] TC-01: The owner rule and GATE-APPROVAL require every recommendation—not only new surfaces—to have
      one independent, exact-subject, committed-revision `ENDORSE` with zero unresolved findings, while the
      new-surface placement criterion remains additive.
- [ ] TC-02: The scan accepts a current subject/revision-bound ENDORSE and rejects missing, wrong-subject,
      non-ancestor, materially stale, non-ENDORSE, duplicate, or nonzero-unresolved records.
- [ ] TC-03: Historical adoption records exact exemptions without claiming review occurred; completed
      historical states pass unchanged, while nonterminal status/folder transitions, material revisions,
      stale baseline entries, and unnecessary new exemptions fail.
- [ ] TC-04: The proposal-reviewer, orchestrator, guardian, gate catalogue, scan registry, root command, and
      orchestration map all point to the same evidence contract and the scan is reachable from mandatory CI.
- [ ] TC-05: Focused tests, the complete harness contract tier, `pnpm harness:scan`, and the repository build
      and test commands all exit 0 after deliberate-red fixtures prove each fail-closed branch.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                 | Notes                                                                    |
| ----- | --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TC-01 | INFRA     | Contract assertions over rule, catalogue, and agent definitions | Prove universal scope and additive placement wording.                    |
| TC-02 | INFRA     | `scan-recommendation-endorsement.test.mjs` fixture repositories | Green exact record plus each missing/mismatch/staleness/finding failure. |
| TC-03 | INFRA     | Baseline fixture matrix and live baseline validation            | Prove prospective adoption without retrospective evidence.               |
| TC-04 | INFRA     | Registry/command/map reachability assertions and live scan      | Prevent an implemented-but-unreachable guard.                            |
| TC-05 | INFRA     | Focused Vitest, harness contracts, scan, build, and tests       | Record commands, counts, and exit codes in gate evidence.                |

## Tasks

- [ ] `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` — existing issue-derived
      Task; GATE-IMPLEMENT must validate the re-scoped TC mapping.

## Evidence Log
