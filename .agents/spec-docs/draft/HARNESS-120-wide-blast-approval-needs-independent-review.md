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

Require every recommendation dispatch to record a subject/revision/projection expectation and the independent
reviewer's matching observation in the canonical loop-run ledger. At GATE-APPROVAL, verify the reviewed topic
commit and current schema-aware decision projection; after squash, verify the persisted projection and
attestation without requiring topic ancestry that no longer exists. Keep new-surface placement review as
additional required content. Anchor historical exemptions to one immutable adoption commit so entries can be
reconstructed rather than asserted; any nonterminal status transition or file change invalidates that
exemption.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — sole owner of the universal recommendation-review attestation,
  decision projection, two-stage verification, and prospective-adoption contracts.
- `.agents/specs/gate-catalogue.md` — GATE-APPROVAL criterion that invokes the universal check and retains
  new-surface placement as additive evidence.
- `.agents/skills/backlog-execution-orchestrator/SKILL.md` — expectation-before-dispatch,
  observation-after-return, round, and route contract.
- `.claude/agents/proposal-reviewer.md` — subject/revision/projection/unresolved-count output contract.
- `.claude/agents/backlog-gate-guard.md` — guardian instruction to verify machine-checkable external evidence
  rather than accept a bare self-claim.
- `.agents/specs/orchestration-map.md` — recommendation-gate mechanical-floor status.
- `scripts/harness/loop-run.mjs` and `scripts/harness/recommendation-review-record.mjs` — canonical
  recommendation expectation/observation persistence and schema validation.
- `scripts/harness/scan-loop-run-records.mjs` — malformed recommendation-review extension rejection.
- `scripts/harness/scan-recommendation-endorsement.mjs` — topic-gate revision validation, squash-safe
  persisted projection validation, and prospective-adoption enforcement.
- `scripts/harness/recommendation-endorsement-baseline.json` — immutable adoption revision plus the single
  self-bootstrap subject, without invented reviewer evidence.
- `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs` — deliberate-green/red fixtures.
- `scripts/harness/__tests__/loop-run.test.mjs` and `scripts/harness/__tests__/scan-loop-run-records.test.mjs`
  — canonical attestation command and malformed-ledger fixtures.
- `scripts/harness/scan-guard-scope-fail-closed.mjs` and its tests — root finder classification and absent
  governed-tree behavior.
- `scripts/harness/run-all-scans.mjs`, `scripts/harness/examined-adoption-baseline.json`,
  `scripts/harness/measurement-provenance-pending.json`, and root command wiring — mandatory scan
  reachability, examined-population adoption, and provenance.
- `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` — re-scoped work record and
  independent verdict.

No package, public API, application, runtime dependency, or user-facing behavior changes.

### Alternatives Considered

1. **Enforce the existing universal Recommendation Gate with canonical expectation/observation attestation
   and a schema-aware decision projection.** Pro: repairs the actual rule/enforcer mismatch, records dispatch
   separately from observation, survives squash, and makes stale review observable. Con: every future
   recommendation needs a committed planning revision, a ledger round, and independent review before approval.
2. **Add an independent-review condition only for a newly defined wide-blast class.** Pro: fewer proposals
   require the stronger evidence. Con: duplicates the already-universal rule, needs a fallible blast-radius
   classifier, and leaves ordinary recommendations able to repeat the measured bypass.
3. **Keep prose-only orchestration and rely on reviewers to notice missing verdicts.** Pro: no new scan or
   historical adoption work. Con: this is the current failed state; HARNESS-119 proves that a required
   verdict can be omitted while every existing gate still passes.
4. **Require a Task verdict token without canonical dispatch attestation or projection binding.** Pro:
   simplest mechanical search and human-readable record. Con: the Task can self-claim a reviewer result, a
   verdict for another proposal or an older design can satisfy the check, and normal lifecycle edits make a
   whole-document hash unstable.

### Decision

Choose alternative 1. `backlog-execution.md` remains the single policy owner: every Recommendation Gate
requires an independent `proposal-reviewer` ENDORSE, not just wide-blast work. Before dispatch, the
orchestrator records one canonical expectation in its loop-run ledger with round, exact spec subject, full
topic commit SHA, and canonical decision-projection digest. After return, it records the matching reviewer
observation with `ENDORSE|REVISE|REJECT`, unresolved-finding count, and the same binding fields. The Task
references the exact run ID for human navigation; it is not the attestation owner. Multiple REVISE rounds are
valid history, but only the unique latest observation for the current projection may authorize approval, and
it must be `ENDORSE` with zero unresolved findings.

The canonical decision projection is section-aware rather than a whole-file hash. It requires unique,
unfenced headings and includes frontmatter `type`/`tags`, title, Problem, Prior Art Research, Architecture
Review and Decision, Fallback declaration, User Execution Test Scenario plan, Solution, Affected Files, and
Completion Criteria text while normalizing only the criteria checkbox marker. For the Test Plan it includes
TC-ID, Test Type, and Tool / Approach but excludes the lifecycle-results Notes column. It excludes frontmatter
status, Tasks lifecycle state, and the gate-owned Evidence Log. Missing/duplicate headings, malformed tables,
fenced decoys, duplicate TC IDs, or a non-bijective criteria/test mapping fail closed.

Verification has two deliberate modes. Topic-branch GATE-APPROVAL proves the reviewed commit exists and is
reachable from the current topic HEAD, contains the exact subject, produced the expected projection digest,
and still matches the current projection. The mandatory post-approval scan verifies the persisted expectation
and observation plus the current projection digest, but does not require topic ancestry after squash merge;
the attested digest is the durable bridge across rewritten commit identity. New-surface placement remains
additional review content under the existing rule and is not weakened or reclassified.

The mechanical scan applies to post-approval documents. Its baseline fixes the full adoption commit
`675cd814edb4121fd92023fe7721c905a1acf321`; each legacy exemption must be reconstructed from that tree at the
same path with the same status and bytes, so the baseline cannot mint new historical facts. Completed
historical states remain auditable exemptions. A nonterminal item loses its exemption on any status/folder
transition or file change, so active work converges prospectively without fabricated evidence. New, duplicate,
unreconstructable, already-endorsed, or unnecessary exemptions fail. HARNESS-120 itself is the unavoidable
self-bootstrap: one named subject and exact approved projection digest is frozen in the baseline because its
attestation writer does not exist before its own GATE-APPROVAL; the schema permits no second bootstrap entry.

The scan exports a root finder and therefore joins the guard-scope fail-closed classification, governed-tree
absence tests, examined-adoption baseline, and measurement-provenance ledger in the same implementation.

Validation before approval covers reachability (topic mode verifies exact commit ancestry and the mandatory
scan verifies squash-safe persisted projection), capability preservation (the existing new-surface placement
criterion remains additive), and adversarial failure modes (missing expectation/observation, wrong subject,
non-ancestor topic revision, schema-decoy or stale projection, later design edits, unresolved findings,
duplicate observations, and forged historical equivalence all fail closed).

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

Define the universal attestation, decision projection, two-stage verification, and prospective adoption in
the owning backlog rule. Extend the loop-run recorder with a recommendation-specific expectation/observation
extension, then make the proposal reviewer and orchestrator produce it while the Task references its run ID.
Make GATE-APPROVAL use topic mode before approval, with new-surface placement layered on top. Implement the
mandatory squash-safe scan over post-approval specs and the immutable adoption revision, including
guard-scope, examined-population, and provenance wiring. Update the orchestration map from PENDING only after
the scan is registered and tested.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-execution-orchestrator/SKILL.md`
- `.claude/agents/proposal-reviewer.md`
- `.claude/agents/backlog-gate-guard.md`
- `.agents/specs/orchestration-map.md`
- `scripts/harness/loop-run.mjs`
- `scripts/harness/recommendation-review-record.mjs`
- `scripts/harness/scan-loop-run-records.mjs`
- `scripts/harness/scan-recommendation-endorsement.mjs`
- `scripts/harness/recommendation-endorsement-baseline.json`
- `scripts/harness/__tests__/loop-run.test.mjs`
- `scripts/harness/__tests__/scan-loop-run-records.test.mjs`
- `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`
- `scripts/harness/scan-guard-scope-fail-closed.mjs`
- `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/examined-adoption-baseline.json`
- `scripts/harness/measurement-provenance-pending.json`
- `package.json`
- `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md`

## Completion Criteria

- [ ] TC-01: The owner rule and GATE-APPROVAL require every recommendation—not only new surfaces—to have a
      canonical expectation plus matching independent observation for the exact subject/revision/projection;
      the latest observation is `ENDORSE` with zero unresolved findings, while new-surface placement remains
      additive.
- [ ] TC-02: Topic mode accepts an exact reachable reviewed revision and rejects missing/mismatched
      expectation/observation pairs, wrong subjects, non-ancestor revisions, malformed/decoy/ambiguous or
      stale projections, non-ENDORSE outcomes, duplicate observations, and nonzero unresolved findings;
      post-squash mode validates the same attested projection without requiring lost topic ancestry.
- [ ] TC-03: Historical adoption is reconstructed from immutable revision
      `675cd814edb4121fd92023fe7721c905a1acf321` without claiming review occurred; completed historical states
      pass unchanged, while nonterminal transitions or edits, forged/new/duplicate/stale/unnecessary exemptions,
      and any second self-bootstrap subject fail.
- [ ] TC-04: The proposal-reviewer, orchestrator, loop recorder/validator, guardian, gate catalogue, scan
      registry, root command, guard-scope classifier, examined/provenance ledgers, and orchestration map all
      point to the same contract and make the scan mandatory and non-vacuous.
- [ ] TC-05: Focused tests, the complete harness contract tier, `pnpm harness:scan`, and the repository build
      and test commands all exit 0 after deliberate-red fixtures prove each fail-closed branch.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                 | Notes                                                                                                         |
| ----- | --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| TC-01 | INFRA     | Contract assertions over rule, catalogue, agent definitions, and loop schema    | Prove universal scope, canonical paired attestation, and additive placement wording.                          |
| TC-02 | INFRA     | Loop-run and `scan-recommendation-endorsement.test.mjs` git fixtures            | Green topic/squash paths plus each dispatch, subject, ancestry, projection, verdict, and finding failure.     |
| TC-03 | INFRA     | Adoption-revision fixture matrix and live baseline validation                   | Reconstruct exemptions from the frozen tree and prove prospective convergence without retrospective evidence. |
| TC-04 | INFRA     | Registry/command/map, guard-scope, examined-adoption, and provenance assertions | Prevent an implemented-but-unreachable or vacuous guard.                                                      |
| TC-05 | INFRA     | Focused Vitest, harness contracts, scan, build, and tests                       | Record commands, counts, and exit codes in gate evidence.                                                     |

## Tasks

- [ ] `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` — existing issue-derived
      Task; GATE-IMPLEMENT must validate the re-scoped TC mapping.

## Evidence Log
