---
status: done
completed: 2026-08-26
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
  new-surface placement as additive evidence; GATE-COMPLETE actual-test evidence ownership.
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
- `scripts/harness/__tests__/recommendation-review-record.test.mjs` — filename-bound direct
  digest/projection unit coverage required by the harness script import-safety floor.
- `scripts/harness/scan-guard-scope-fail-closed.mjs` and its tests — root finder classification and absent
  governed-tree behavior.
- `scripts/harness/scan-user-execution-plan-order.mjs` and its tests — recognize the canonical recommendation
  ledger as an exact planning artifact through the shared validator, without taking ownership of endorsement
  semantics.
- `scripts/harness/__tests__/gate-completion-order.test.mjs` — planned Test Plan versus actual Evidence Log
  ownership contract.
- `.husky/pre-commit` — run staged recommendation-order enforcement before a commit can make review
  retrospective.
- `scripts/harness/run-all-scans.mjs`, `scripts/harness/examined-adoption-baseline.json`,
  `scripts/harness/measurement-provenance-pending.json`, and root command wiring — mandatory scan
  reachability, examined-population adoption, and provenance.
- `.agents/rules/backlog-execution.md` — keep the rule-case citation ratchet at zero by expressing the
  mechanism generically rather than adding new case-specific citations.
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
unfenced headings and includes every frontmatter key/value except the closed lifecycle-key set (`status` and
`completed`), plus title, Problem, Prior Art Research, Architecture Review and Decision, Fallback declaration,
User Execution Test Scenario plan, Solution, Affected Files, Completion Criteria text, and the entire planned
Test Plan table. Only the Completion Criteria checkbox marker is normalized. Test Plan Notes remain plan and
are immutable after endorsement. GATE-COMPLETE no longer writes actual test references or skip dispositions
back into Test Plan: actual test path/name, skip reason, runtime command, count, output, result, and exit code
belong only in the TC-specific gate-owned Evidence Log. It excludes Tasks lifecycle state and Evidence Log.
Missing/duplicate headings, unknown lifecycle exclusions, malformed tables, fenced decoys, duplicate TC IDs,
or a non-bijective criteria/test mapping fail closed.

An endorsement is a dedicated planning-only checkpoint, not merely a final-state token. Whenever a projection
first appears or changes, the work unit becomes `unendorsed`. Until the exact Task/spec plus canonical
recommendation ledger expectation/observation are committed together, staged and topic-history enforcement
rejects every implementation path. The checkpoint must be an ancestor before GATE-APPROVAL and before Phase 3
continues after scope growth. `scan-recommendation-endorsement` owns this state machine and replays both the
staged index and topic range. The HARNESS-121 plan-order scan imports the shared recommendation-record
validator only to admit that exact ledger as a planning artifact; it does not duplicate endorsement meaning.

Verification has two deliberate modes. Topic/staged mode proves the reviewed commit exists and is reachable
from the endorsement checkpoint, contains the exact subject, produced the expected projection digest, and
still matches the checkpoint projection; it also proves no implementation commit occurs while the state is
unendorsed. The mandatory post-approval scan verifies the persisted expectation and observation plus the
current projection digest, but does not require topic ancestry after squash merge; the attested digest is the
durable bridge across rewritten commit identity. New-surface placement remains additional review content
under the existing rule and is not weakened or reclassified.

The mechanical scan applies to post-approval documents. Its baseline fixes the full adoption commit
`675cd814edb4121fd92023fe7721c905a1acf321`; each legacy exemption must be reconstructed from that tree at the
same path with the same status and bytes, so the baseline cannot mint new historical facts. Completed
historical states remain auditable exemptions. A nonterminal item loses its exemption on any status/folder
transition or file change, so active work converges prospectively without fabricated evidence. New, duplicate,
unreconstructable, already-endorsed, or unnecessary exemptions fail. Rejected documents are outside the
ENDORSE-required population because they never passed GATE-APPROVAL; a recorded `REJECT` may explain their
disposition but cannot authorize work. HARNESS-120 itself is the unavoidable self-bootstrap: one exact tuple
of subject, reviewed revision, and approved projection digest is frozen in the baseline because its
attestation writer and order guard do not exist before its own GATE-APPROVAL; the schema permits no second
bootstrap tuple or wildcard.

The scan exports a root finder and therefore joins the guard-scope fail-closed classification, governed-tree
absence tests, examined-adoption baseline, and measurement-provenance ledger in the same implementation.

This change also removes GATE-COMPLETE's duplicate requirement to update Test Plan with actual test references
or skip reasons. The plan table is the approved verification intent and stays projection-stable; the Evidence
Log is the sole completion-evidence owner. A contract fixture proves no gate still requires actual evidence in
both places.

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

Define the universal attestation, decision projection, endorsement-checkpoint state machine, two-stage
verification, and prospective adoption in the owning backlog rule. Extend the loop-run recorder with a
recommendation-specific expectation/observation extension, then make the proposal reviewer and orchestrator
produce it while the Task references its run ID. Commit the exact Task/spec/ledger as a planning-only
endorsement checkpoint before GATE-APPROVAL or any implementation, and repeat that checkpoint after every
material projection change or Phase-3 scope growth. Make staged and topic-history scans reject retrospective
endorsement and make GATE-APPROVAL use topic mode, with new-surface placement layered on top. Implement the
mandatory squash-safe scan over post-approval specs and the immutable adoption revision, including the
HARNESS-121 shared planning-path validator, pre-commit, guard-scope, examined-population, and provenance wiring.
Remove GATE-COMPLETE's duplicate Test Plan actual-evidence write so its Evidence Log is the sole result owner.
Update the orchestration map from PENDING only after the scan is registered and tested.

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
- `scripts/harness/__tests__/recommendation-review-record.test.mjs`
- `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`
- `scripts/harness/scan-guard-scope-fail-closed.mjs`
- `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/__tests__/gate-completion-order.test.mjs`
- `.husky/pre-commit`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/examined-adoption-baseline.json`
- `scripts/harness/measurement-provenance-pending.json`
- `package.json`
- `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md`

## Completion Criteria

- [x] TC-01: The owner rule and GATE-APPROVAL require every recommendation—not only new surfaces—to have a
      planning-only checkpoint containing a canonical expectation plus matching independent observation for
      the exact subject/revision/projection; the latest observation is `ENDORSE` with zero unresolved findings,
      while new-surface placement remains additive; planned Test Plan content is immutable after endorsement
      and actual completion evidence has one owner in the Evidence Log.
- [x] TC-02: Staged/topic history accepts an exact reachable reviewed revision and endorsement checkpoint,
      then rejects implementation before endorsement, implementation after an unendorsed material projection
      change, missing/mismatched expectation/observation pairs, wrong subjects, non-ancestor revisions,
      malformed/decoy/ambiguous or stale projections, non-ENDORSE outcomes, duplicate observations, and
      nonzero unresolved findings; post-squash mode validates the attested projection without lost ancestry.
- [x] TC-03: Historical adoption is reconstructed from immutable revision
      `675cd814edb4121fd92023fe7721c905a1acf321` without claiming review occurred; completed historical states
      pass unchanged, while nonterminal transitions or edits, forged/new/duplicate/stale/unnecessary exemptions,
      and any second or wildcard self-bootstrap tuple fail; rejected proposals remain outside the
      ENDORSE-required population and cannot authorize implementation.
- [x] TC-04: The proposal-reviewer, orchestrator, loop recorder/validator, guardian, gate catalogue, staged
      hook, HARNESS-121 planning-order shared validator, scan registry, root command, guard-scope classifier,
      examined/provenance ledgers, and orchestration map all point to the same contract and make enforcement
      mandatory, ordered, and non-vacuous; a gate contract fixture rejects any return to duplicate actual-test
      evidence ownership in Test Plan and Evidence Log.
- [x] TC-05: Focused tests, the complete harness contract tier, `pnpm harness:scan`, and the repository build
      and test commands all exit 0 after deliberate-red fixtures prove each fail-closed branch.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                                                           | Notes                                                                                                                                                               |
| ----- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | INFRA     | Contract assertions over rule, catalogue, agent definitions, and loop schema                                                              | Prove universal scope, canonical paired attestation, additive placement, immutable planned Test Plan, and Evidence-Log-only actual results.                         |
| TC-02 | INFRA     | Loop-run and `scan-recommendation-endorsement.test.mjs` staged/history git fixtures                                                       | Green endorsement checkpoint/topic/squash paths plus retrospective implementation, re-plan, dispatch, subject, ancestry, projection, verdict, and finding failures. |
| TC-03 | INFRA     | Adoption-revision fixture matrix and live baseline validation                                                                             | Reconstruct exemptions from the frozen tree and prove prospective convergence without retrospective evidence.                                                       |
| TC-04 | INFRA     | Hook, plan-order shared-validator, gate-completion owner fixture, registry/map, guard-scope, examined-adoption, and provenance assertions | Prevent unreachable, retrospective, duplicated-owner, or vacuous enforcement and duplicate actual-test evidence ownership.                                          |
| TC-05 | INFRA     | Focused Vitest, harness contracts, scan, build, and tests                                                                                 | Record commands, counts, and exit codes in gate evidence.                                                                                                           |

## Tasks

- [x] `.agents/tasks/completed/HARNESS-120-wide-blast-approval-needs-independent-review.md` — existing issue-derived
      Task; GATE-IMPLEMENT must validate the re-scoped TC mapping.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-26

**Status upgrade:** draft → review-ready

- Ordering: GATE-WRITE is the entry gate and has no predecessor; the document is `status: draft` in `.agents/spec-docs/draft/`.
- Frontmatter opening block: the file begins with a complete `---` YAML frontmatter block.
- Frontmatter status: `status: draft` is present.
- Frontmatter type: `type: INFRA` is one exact value from the permitted type list.
- Frontmatter tags: `tags: [async]` is present.
- Problem symptom: the document identifies the concrete mismatch in which the universal Recommendation Gate requires independent endorsement while GATE-APPROVAL and the mandatory scans do not verify that universal verdict record.
- Problem reproduction condition: HARNESS-119 is named as a measured recurrence that changed the universal merge-verifier contract, recorded independent validation as N/A, and merged without a recorded `REVIEW VERDICT: ENDORSE`.
- Problem specificity: the Problem is a substantiated two-paragraph account and contains neither `TBD` nor `TODO`.
- Prior Art Research section: `## Prior Art Research` is present.
- Research substantiation: the section cites official GitHub CODEOWNERS, protected-branch and ruleset documentation, GitLab approval-rule documentation, and NIST SP 800-53 Rev. 5.1.
- Research waiver: N/A — qualifying primary and standards documentation is supplied, so no waiver is required.
- Research-to-alternatives trace: the cited revision binding, separation of duties, composable protections, retained decision record, and prospective adoption patterns directly distinguish the four alternatives.
- Research-to-decision trace: those findings support the selected canonical expectation/observation attestation, schema-aware projection, squash-safe verification, and immutable adoption boundary.
- Architecture checklist: all four declared checklist items are checked `[x]`.
- Sibling scan: the checked item names the Recommendation Gate, GATE-APPROVAL, proposal-reviewer, backlog-gate-guard, user-execution PLAN binding, and orchestration-map enforcement rows as inspected siblings.
- Alternatives: four alternatives are present and each states an explicit pro and con.
- Decision trade-off: the Decision selects universal canonical attestation because it repairs the owner/enforcer mismatch and survives revision/squash changes, while explicitly accepting a committed planning revision, ledger round, and independent review for every future recommendation.
- New-surface placement: N/A — the Affected Scope explicitly introduces no package, application, public API, runtime dependency, user-facing behavior, presentation layer, or product-family/layer reclassification; the new files are repository-local harness enforcement within the existing harness layer.
- Completion Criteria prefixes: all five criteria use unique `TC-01` through `TC-05` prefixes.
- Completion Criteria coverage: separate criteria cover the universal gate contract and evidence ownership, staged/topic/squash enforcement, immutable historical adoption, mandatory non-vacuous wiring, and full verification.
- Completion Criteria observability: every criterion names mechanically observable required states, accepted/rejected histories, exact wiring targets, or commands that must exit 0.
- Completion Criteria wording: none uses the prohibited phrases `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- Test Plan section: `## Test Plan` is present.
- Test Plan count: five rows map one-to-one to the five Completion Criteria (`TC-01` through `TC-05`).
- Test Plan completeness: every row has a non-empty Test Type and Tool / Approach, with no `TBD` value.
- Manual-test rationale: N/A — no Test Plan row uses `manual` as its tool.
- Tasks structure: `## Tasks` is present with an unchecked pointer to the paired `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` Task.
- Evidence structure: `## Evidence Log` was present and empty before this first GATE-WRITE entry.
- Body structure: the document contains neither a `## Status` nor a `## Classification` body section.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-26

**Status upgrade:** review-ready → approved

- Ordering: the immediately preceding GATE-WRITE entry records `✅ PASS | 2026-08-26`; the document is currently `status: review-ready` at `.agents/spec-docs/backlog/HARNESS-120-wide-blast-approval-needs-independent-review.md`, matching the required input state and folder.
- Explicit approval in the current conversation: the user provided the standing authorization verbatim, `의미있는 개선사항이 없을때까지 의미있는 개선사항을 처리해서 완료할때까지 반복해. 모든 계획은 타당한 이유가 있다면 사전 승인한다`.
- Direct, unambiguous application to this spec: `모든 계획` expressly includes this HARNESS-120 plan, and its stated condition `타당한 이유가 있다면` is satisfied by the document's primary-source research, four alternatives with explicit trade-offs, and the independent review of exact revision `440529b9a861a925702368ecc45c36313b7bb210` returning `REVIEW VERDICT: ENDORSE` with `UNRESOLVED FINDINGS: 0`; this is a conditional pre-approval applied to the justified current design, not silence, a shorthand answer, or approval of another item.
- Post-approval document integrity: comparison with exact endorsed revision `440529b9a861a925702368ecc45c36313b7bb210` shows no substantive design change; only the lifecycle status/path transition, this gate evidence, and the Task's exact independent-review record were added. `## Architecture Review`, `type: INFRA`, and `tags: [async]` remain unchanged.
- Independent architecture validation: N/A — the Affected Scope and Decision introduce no package, application, presentation/interface surface, public API, runtime dependency, layer reclassification, or product-family boundary; the proposed scripts and contract edits remain inside the existing repository harness/governance surface. New-surface placement evidence is therefore not required by the current conditional criterion.
- Premature implementation check: `origin/develop...440529b9a861a925702368ecc45c36313b7bb210` changes only the HARNESS-120 Task/spec planning artifacts plus the preceding HARNESS-121 post-merge-cycle ledger record; the current worktree changes only the Task review record and the spec lifecycle/evidence transaction. No implementation path listed in this spec's Affected Files has been modified or committed before this gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-26

**Status upgrade:** approved → in-progress

- Ordering: the immediately preceding lifecycle gate is a specific `GATE-APPROVAL` PASS dated 2026-08-26, and this document is `status: approved` at `.agents/spec-docs/todo/HARNESS-120-wide-blast-approval-needs-independent-review.md`, matching the required input state and folder.
- Exact Task artifact: `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` exists; its HARNESS-120 title, issue `#2326`, objective, and subject field bind it to this exact spec and work unit.
- Task binding in spec: `## Tasks` records the exact active Task path `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md`.
- TC correspondence: Task Plan item 1 covers the universal subject/projection/revision attestation in TC-01; items 2 and 4 cover the planning checkpoint plus staged/topic failure matrix in TC-02; item 5 covers immutable prospective adoption in TC-03; item 6 covers the shared reviewer/orchestrator/catalogue/scan/map wiring in TC-04 and its full-green proof in TC-05; item 3 additionally covers the universal current-ENDORSE requirement in TC-01.
- Task Test Plan: the Task contains a substantive `## Test Plan` section longer than 50 characters, requiring focused guardian/scan fixtures plus the complete harness contract tier and `pnpm harness:scan`.
- Subject-bound PLAN terminal outcome: the exact Task records subject `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md`, author verdict `SCENARIO DRAFTED: not-applicable | 0`, and a concrete reason that this repository-internal approval/governance enforcement delivers no CLI, TUI, browser, public-SDK, hidden capability, or other user-executable product behavior. DONE-GATE-STAGE-1 is therefore N/A.
- PLAN ledger evidence: `.agents/loop-runs/user-execution-scenario.jsonl` contains closed run `r20260825173752`, opened `2026-08-25T17:37:52.224Z`, closed `2026-08-25T17:38:20.775Z`, `roundFindings: [0]`, `terminal: converged`, and ref `HARNESS-120-wide-blast-approval-needs-independent-review.md`, binding the successful run to the exact Task/spec basename; `scan-loop-run-records.mjs` exits 0 over the current ledgers.
- Whole-worktree path inventory: `git status --short --untracked-files=all`, unstaged name-status, and staged name-status show no staged change and only the exact planning set: the paired Task modification, the paired spec's draft deletion plus approved/todo replacement (one lifecycle move), and the single subject-bound `user-execution-scenario.jsonl` PLAN record. No implementation path, unrelated planning path, rename outside the exact spec move, or other deletion is present.
- Pre-gate branch history: `origin/develop..HEAD` changes only the HARNESS-120 Task/spec planning artifacts and the prior append-only HARNESS-121 post-merge-cycle record; no implementation file in this spec's Affected Files was modified or committed before this gate.
- NON-COMPLIANCE trigger: N/A — the exact Task and prospective PLAN evidence predate implementation, and neither branch history nor the complete worktree contains a premature implementation path.

### [RECOMMENDATION RE-REVIEW] — ✅ ENDORSE | 2026-08-26

- Scope-growth routing: the full harness scan identified filename-bound direct test coverage and rule-case citation handling that required a return to the Recommendation Gate before implementation resumed.
- Reviewed subject: `HARNESS-120-wide-blast-approval-needs-independent-review.md`.
- Reviewed revision: `0151e71c57e0eaaa9d7078e36118ab34a39d5ab1`.
- Projection digest: `ed7c2fd3e1ce850de8608dfdabee80c0c0bec31ea2ac4b33fa89f590331cd257`.
- Independent verdict: `proposal-reviewer` returned `REVIEW VERDICT: ENDORSE` with `UNRESOLVED FINDINGS: 0` after confirming the direct record-module test remains in scope and the zero-count rule-case citation ratchet is preserved without a baseline increase.
- Canonical evidence: open backlog execution run `r20260825171311` records one exact expectation and matching observation for the reviewed subject, revision, and projection digest.

### [GATE-VERIFY] — ✅ PASS | 2026-08-26

**Status upgrade:** in-progress → verifying

- Ordering: the prior lifecycle gate is the recorded `GATE-IMPLEMENT` PASS, and the spec was `status: in-progress` in `.agents/spec-docs/active/` when independently judged.
- Task completion: all six Plan items in `.agents/tasks/HARNESS-120-wide-blast-approval-needs-independent-review.md` are checked, with no blocked or pending item.
- Affected-package build/test: N/A — the staged scope changes repository harness/governance only and contains no package or application source, public API, runtime dependency, or user-facing behavior.
- Focused verification: `pnpm exec vitest run` over the seven affected harness test files passed 175 tests in 7 files, exit code 0.
- Contract verification: `pnpm harness:test:contracts` passed 3,914 tests in 180 files, exit code 0.
- Harness verification: `pnpm harness:scan` passed 145 scans with 2 declared skips, exit code 0.
- Checklist evidence: post-implementation run `r20260825180912` closed `converged` after one round with 0 findings; `git diff --cached --check` and `scan-loop-run-records.mjs` also exited 0.
- Independent guardian: `backlog-gate-guard` independently inspected the staged 25-path harness/governance change, reran the focused tests and ledger scan, and returned `GATE: GATE-VERIFY`, `VERDICT: PASS`, `UNRESOLVED FINDINGS: 0` without editing files.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-26

- Test references: `scripts/harness/__tests__/loop-run.test.mjs`, `scripts/harness/__tests__/scan-loop-run-records.test.mjs`, and `scripts/harness/__tests__/gate-completion-order.test.mjs`.
- Command/action: the seven-file focused `pnpm exec vitest run` command plus direct inspection of `.agents/rules/backlog-execution.md`, `.agents/specs/gate-catalogue.md`, and the reviewer/guardian contracts.
- Observed result: the focused suite passed 175 tests in 7 files; contract assertions prove universal paired attestation, independent `ENDORSE | 0`, additive placement review, and Evidence-Log-only actual results.
- Exit code: 0.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-26

- Test references: `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs` and `scripts/harness/__tests__/recommendation-review-record.test.mjs`.
- Command/action: `pnpm exec vitest run scripts/harness/__tests__/recommendation-review-record.test.mjs scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs` and `node scripts/harness/scan-recommendation-endorsement.mjs --staged`.
- Observed result: 20 tests passed in 2 files; the suite accepts exact single- and multi-round planning checkpoints and rejects retrospective implementation, stale/material re-plans, malformed projections, invalid ancestry/verdict/finding states, and mixed staged paths. The staged live scan also passed.
- Exit code: 0 for both commands.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-26

- Test reference: `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`, including immutable-adoption, rejected-population, and exact-bootstrap replay cases.
- Command/action: the focused seven-file Vitest command and `pnpm harness:scan` live baseline validation.
- Observed result: unchanged historical bytes and the one exact bootstrap digest pass; edits, nonterminal re-plans without a new endorsement, stale evidence, and rejected authorization attempts fail in deliberate-red fixtures. The live baseline remains anchored at `675cd814edb4121fd92023fe7721c905a1acf321`.
- Exit code: 0.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-26

- Test references: `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs`, `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`, `scripts/harness/__tests__/gate-completion-order.test.mjs`, and the complete harness contract tier.
- Command/action: `pnpm harness:test:contracts`, `pnpm harness:scan`, and `node scripts/harness/scan-loop-run-records.mjs`.
- Observed result: 3,914 contract tests passed in 180 files; 145 mandatory scans passed with 2 declared skips; 74 loop-run ledger entries passed schema validation. Registry/map, hook ordering, shared checkpoint classification, fail-closed scope, examined count, provenance, and single Evidence Log ownership are reachable and non-vacuous.
- Exit code: 0 for all commands.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-26

- Test references: `scripts/harness/__tests__/recommendation-review-record.test.mjs`, `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`, `scripts/harness/__tests__/loop-run.test.mjs`, `scripts/harness/__tests__/scan-loop-run-records.test.mjs`, `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`, `scripts/harness/__tests__/scan-guard-scope-fail-closed.test.mjs`, and `scripts/harness/__tests__/gate-completion-order.test.mjs`; the root commands additionally reached all 180 harness contract files, workspace package/application tests, and 145 mandatory scans.
- Command/action: focused `pnpm exec vitest run`, `pnpm harness:test:contracts`, `pnpm harness:scan`, `pnpm build`, and `pnpm test`.
- Observed result: 175 focused tests passed; 3,914 contract tests passed; 145 scans passed with 2 declared skips; all 82 package builds and ordered type builds completed; the recursive test run across 109 of 110 workspace projects completed successfully. Existing non-failing bundler, React, experimental-API, and listener warnings were visible and did not change any exit verdict.
- Exit code: 0 for every command.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-26

**Status upgrade:** verifying → done

- Ordering: the immediately preceding lifecycle gate is the recorded `GATE-VERIFY` PASS, and the spec was `status: verifying` in `.agents/spec-docs/active/` when judged.
- Criteria evidence: TC-01 through TC-05 are all checked and each has one matching `[GATE-COMPLETE: TC-N]` entry with durable test references, actual commands/actions, observed results, and exit codes.
- Planned-test ownership: `## Test Plan` remains the endorsed plan and carries no completion outputs; all actual results are owned by this Evidence Log.
- Task readiness: all six Plan items in the exact Task are checked, no item is blocked or pending, and the `## Tasks` pointer is archived atomically to `.agents/tasks/completed/HARNESS-120-wide-blast-approval-needs-independent-review.md` with this status transition.
- Independent guardian: after one evidence-specific correction, `backlog-gate-guard` returned `GATE: GATE-COMPLETE`, `VERDICT: PASS`, and `UNRESOLVED FINDINGS: 0`; it independently recomputed the endorsed projection digest and confirmed all seven TC-05 test paths exist.
- Final completed-state verification: `pnpm harness:test:contracts` again passed 3,914 tests in 180 files, and `pnpm harness:scan` passed 144 scans with 3 declared skips after the Task/spec archival moves; both commands exited 0.

### [LOCAL REVIEW ROUND 1] — 🔁 RESOLVED | 2026-08-26

- Exact review range: independent local review compared base `675cd814edb4121fd92023fe7721c905a1acf321` with implementation head `de0534496333ac2d626a177826defec6869866ef` before the first push and returned `ACTIONABLE FINDINGS: 6`.
- Resolved findings: the fix makes CommonMark fence recognition fail closed; rejects unowned H2/preamble planning content; validates immutable adoption/bootstrap meaning; keeps approved-then-rejected work governed; enforces canonical review-ledger round, ordering, uniqueness, and reachability invariants; and makes required Git/base-ref queries fail closed under the shared precedence contract.
- Focused verification: the seven affected harness test files passed 156 tests, including 30 endorsement-scan fixtures and the direct record-module tests; an explicit `--base definitely-not-a-ref` invocation failed as required.
- Complete verification: `pnpm harness:test:contracts` passed 3,926 tests in 180 files and `pnpm harness:scan` passed 145 scans with 2 declared skips; both commands exited 0.
- Review status: the six findings are fixed locally but the loop remains open until an independent review of the new exact head reports `ACTIONABLE FINDINGS: 0`.
