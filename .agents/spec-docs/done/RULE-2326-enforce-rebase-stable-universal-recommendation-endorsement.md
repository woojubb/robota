---
status: done
type: RULE
tags: [harness, approval]
lane: L2
---

# RULE-2326: Enforce rebase-stable universal recommendation endorsement

## Current disposition — 2026-09-23

Historical delivery is preserved at replacement child merge `4ebdc67d13603369ae633955f1dfd6814898df66` in R `720eb5e841ba7a5361ac667b9658e034212bb58e`. The done status and original evidence below describe that delivery; importing this record does not restore its historical implementation. PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery. This record is historical evidence of a completed child, not an active instruction to recreate its gate, checkpoint, endorsement, or frozen-corpus enforcement machinery.

Paired with `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`.
Arising from [issue #2326](https://github.com/woojubb/robota/issues/2326), with the rebase and
classifier constraints preserved from [issue #2377](https://github.com/woojubb/robota/issues/2377).

## Problem

`backlog-execution.md` requires every Recommendation Gate to receive an independent
`proposal-reviewer` `ENDORSE`, but GATE-APPROVAL mechanically asks for independent evidence only when
the proposal introduces or reclassifies a surface. At integration base
`9983ef58a7e73e1133e2e6d0d4c8daa96b1a43c2`,
`test ! -e scripts/harness/scan-recommendation-endorsement.mjs` succeeds and no aggregate scan reads a
universal recommendation verdict. A recommendation can therefore reach approval with no
subject-bound independent endorsement.

Closed PR #2374 attempted to enforce the rule, but its checkpoint validity required the originally
reviewed commit SHA to remain an ancestor. Issue #2377 reproduced the failure by rebasing the branch:
the planning content and its projection digest were unchanged, while both recorded SHAs ceased to be
ancestors. Because the scan ran in pre-commit, the rebased branch could not commit even a repair. Any
replacement must preserve the causal property—reviewed decision content precedes its checkpoint and
all implementation—without treating a rewritten commit object as changed review content.

The historical corpus creates a second boundary. Existing records cannot be assigned reviews that
never happened, while unchanged terminal history must not make the repository red. Existing
nonterminal work must become governed prospectively on its next lifecycle transition or material
decision change.

## Prior Art Research

- [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges/managing-protected-branches/about-protected-branches)
  bind approval to the reviewed diff state and can dismiss stale approvals when reviewable content
  changes. The relevant property is approved content, not persistence of one local topic SHA.
- [GitLab merge-request approval settings](https://docs.gitlab.com/user/project/merge_requests/approvals/settings/)
  compare patch IDs when new commits arrive to decide whether approvals remain valid. This is a
  content/change-set identity that tolerates commit metadata changes, although a whole-commit patch ID
  would be broader than Robota's recommendation projection.
- [NIST SP 800-53 Rev. 5.1](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final) CM-3/CM-4 require
  proposed changes to be reviewed, decisions retained, and impact considered before implementation.
  The ordering and durable decision record matter independently of the VCS object's SHA.

The applicable pattern is a fail-closed, independent decision bound to the exact reviewable content,
with later material content changes invalidating the decision. For Robota, the narrow reviewable
content is the canonical recommendation projection, so a subject plus projection digest is more
precise than a whole-commit patch ID.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — universal recommendation evidence, stable identity, causal
  checkpoint, and prospective adoption contract.
- `.agents/specs/gate-catalogue.md` — universal GATE-APPROVAL criterion while retaining stricter
  new-surface evidence as an additive criterion.
- `.agents/skills/backlog-execution-orchestrator/SKILL.md` and `.claude/agents/proposal-reviewer.md` —
  expectation-before-dispatch, observation-after-review, and output contract.
- `scripts/harness/gate-operations.mjs` — make the universal evidence a real mechanical
  GATE-APPROVAL check for DIRECT/CLASS approval and composed L1/L2 gates; catalogue prose alone does
  not register an evaluator.
- `scripts/harness/recommendation-review-record.mjs` and `scripts/harness/loop-run.mjs` — canonical
  projection/key generation plus exact expectation/observation persistence.
- `scripts/harness/scan-recommendation-endorsement.mjs` — staged, topic-history, and current-tree
  enforcement.
- `scripts/harness/scan-user-execution-plan-order.mjs` — admit only a valid endorsement checkpoint's
  ledger change as planning content, using shared classifiers rather than duplicated semantics. Its
  current generic top-level ledger allowance must exclude recommendation-bearing appends so an
  always-true classifier cannot remain dead wiring.
- `scripts/harness/recommendation-endorsement-baseline.json` — immutable adoption revision and one
  exact self-bootstrap record.
- `.husky/pre-commit`, root script/scan registration, and focused harness tests — reachability and
  regression enforcement.
- `.agents/specs/orchestration-map.md` and the examined/provenance registries — declare the new
  mechanical floor only after its evaluator is reachable.

No package, application, public API, runtime dependency, or user-facing product behavior changes.

### Alternatives Considered

1. Retain the original reviewed SHA and permit a bounded ledger rewrite after rebase.
   - Pro: preserves the old ancestry predicate.
   - Con: rewrites an attestation to name a commit that did not exist when review occurred and creates
     a privileged “edit until green” path that itself needs review and enforcement.
2. Bind the endorsement to a whole-commit stable patch ID plus subject and projection digest.
   - Pro: maps an original commit to an equivalent rebased commit and follows GitLab's change-set
     precedent.
   - Con: unrelated planning files, context changes, or conflict resolution can alter the patch ID
     while the exact reviewed recommendation remains unchanged; it is wider than the governed claim.
3. Bind endorsement to a domain-separated subject plus canonical projection digest, while enforcing
   causality separately by replaying the checkpoint and implementation order.
   - Pro: survives SHA rewriting, invalidates every material recommendation change, and checks content
     identity and temporal ordering with separate, auditable mechanisms.
   - Con: requires a strict projection parser and history replay; it does not cryptographically prove
     that an external reviewer ran, so canonical independent loop evidence remains mandatory.
4. Keep the current prose-only requirement.
   - Pro: no migration or scanner complexity.
   - Con: preserves the measured universal bypass and cannot distinguish an independent verdict from
     a copied self-claim.

### Decision

**Delivery mode:** `single`

Choose alternative 3. Define the stable endorsement key as
`SHA-256("recommendation-endorsement:v1\\0" + subjectBasename + "\\0" + projectionDigest)`. The
subject prevents cross-item reuse; the projection digest invalidates material design changes; the
domain/version prefix prevents accidental reuse by another hash contract. The original reviewed SHA
may remain as provenance, but no validity decision depends on its post-rebase ancestry.

The canonical projection includes non-lifecycle frontmatter (`type`, `tags`, `lane` and future
non-lifecycle keys), the H1, Problem, Prior Art Research, Architecture Review and Decision, Fallback,
Solution, Affected Files, Completion Criteria, complete planned Test Plan, and User Execution Test
Scenarios. It excludes lifecycle-only `status`/`completed`, the Tasks projection, and Evidence Log.
Completion Criteria checkbox markers are normalized to their planned unchecked form before hashing,
while the complete criterion text, TC identifiers, order, and structure remain bound; therefore the
ordinary `[ ]` to `[x]` completion transition preserves the key but any criterion edit changes it.
Required headings must be unique and unfenced; TC identifiers in Completion Criteria and Test Plan
must form a bijection. Malformed or ambiguous input fails closed.

The causal property previously approximated by SHA ancestry is: the exact endorsed recommendation
state is present immediately before its planning-only endorsement checkpoint, that checkpoint records
one expectation and one matching independent observation, and no implementation path precedes it.
Topic and staged replay enforce that ordering over the current history. A rebase may rewrite the
reviewed and checkpoint commits, but it preserves their order and projected content; a changed
projection changes the key and requires a new review round. A checkpoint may change only the paired
Task/spec and the canonical `backlog-execution-orchestrator` ledger, never implementation paths.

The recommendation ledger records subject, projection digest, endorsement key, review round,
`proposal-reviewer`, verdict, and unresolved-finding count. An observation requires exactly one prior
matching expectation. Approval requires the unique latest observation for the current key to be
`ENDORSE` with zero unresolved findings; missing, wrong-subject, stale-key, duplicate, `REVISE`,
`REJECT`, or nonzero records fail. New-surface placement remains an additional stricter criterion and
is never replaced by the universal check.

The planned Test Plan belongs to the endorsed projection and is therefore immutable after
endorsement. GATE-COMPLETE must not require actual test paths, commands, outputs, results, or skip
reasons to be written back into that plan. Those facts have one owner: the existing TC-specific
Evidence Log records. Removing the duplicate Test Plan write prevents normal completion from making
its own approval stale while retaining the same completion evidence mechanically.

Adoption is prospective. The baseline pins the exact pre-introduction integration revision and
reconstructs exemptions from bytes, path, and status at that revision rather than listing invented
reviews. An unchanged terminal record may remain exempt. A nonterminal record loses its exemption on
the first status/folder transition or material projection change and must obtain a current
endorsement before approval or implementation continues. Rejected-before-approval records are outside
the authorization population. The baseline permits one exact RULE-2326 self-bootstrap tuple only;
the tuple is backed by this work unit's real independent review and cannot be widened or duplicated.

Reachability is mandatory: the aggregate harness scan and staged pre-commit path invoke the scanner,
the plan-order guard imports the shared committed/staged classifiers, and behavior tests kill an
always-true classifier mutant. Pre-commit runs the recommendation scan after staged formatting so it
judges the bytes that would be committed; changing the existing plan-order/formatter relationship
remains outside this item. The scanner must not turn an already-known unrelated historical record red
merely by existing; any such case is either covered by the immutable adoption rule or remains owned by
its existing issue.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — current Recommendation Gate, GATE-APPROVAL, loop-run extensions,
      plan-order checkpoint rules, issue #2377, and closed PR #2374 inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None. Missing, malformed, ambiguous, stale, or unreachable endorsement evidence is a blocking
finding. The scanner does not infer approval from prose, downgrade a failure to an advisory, or offer
a hook bypass.

## Solution

1. Update `.agents/rules/backlog-execution.md`, `.agents/specs/gate-catalogue.md`, and
   `.agents/skills/backlog-execution-orchestrator/SKILL.md` with the universal stable-key and causal
   checkpoint contract; update `.claude/agents/proposal-reviewer.md` with the exact verdict output,
   and register the universal mechanical check in `scripts/harness/gate-operations.mjs` for DIRECT,
   CLASS, L1, and L2 approval paths.
2. Add `scripts/harness/recommendation-review-record.mjs` and extend
   `scripts/harness/loop-run.mjs`/`scan-loop-run-records.mjs` to record and validate exact
   recommendation expectation/observation pairs without relying on rewritten SHA ancestry.
3. Add `scripts/harness/scan-recommendation-endorsement.mjs` and its adoption baseline. Enforce
   staged, topic, and current-tree states, including the unique self-bootstrap and prospective legacy
   boundary.
4. Make `scripts/harness/scan-user-execution-plan-order.mjs` consume the shared committed/staged
   checkpoint classifiers after removing recommendation-bearing appends from the generic ledger
   allowance. Wire the scanner after staged formatting in `.husky/pre-commit` and into the current
   root/aggregate scan registry.
5. Add focused unit/integration fixtures for the refusal matrix, six classifier truth-table cases,
   an always-true mutant, a synthetic rebase, and terminal/nonterminal historical adoption.
6. Make the planned Test Plan projection-stable by keeping actual completion evidence solely in
   TC-specific Evidence Log entries; update the GATE-COMPLETE evaluator and contract fixtures without
   weakening any required evidence.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-execution-orchestrator/SKILL.md`
- `.agents/specs/orchestration-map.md`
- `.claude/agents/proposal-reviewer.md`
- `.claude/agents/backlog-gate-guard.md`
- `scripts/harness/recommendation-review-record.mjs`
- `scripts/harness/scan-recommendation-endorsement.mjs`
- `scripts/harness/recommendation-endorsement-baseline.json`
- `scripts/harness/loop-run.mjs`
- `scripts/harness/scan-loop-run-records.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/gate-operations.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/__tests__/recommendation-review-record.test.mjs`
- `scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/__tests__/gate.test.mjs`
- `scripts/harness/__tests__/gate-completion-order.test.mjs`
- `scripts/harness/scan-guard-scope-fail-closed.mjs`
- `scripts/harness/examined-adoption-baseline.json`
- `scripts/harness/measurement-provenance-pending.json`
- `.husky/pre-commit`
- `package.json`
- `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`
- `.agents/spec-docs/draft/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`
- parent AGREEMENT-2664 Task/spec projections

`run-all-scans.mjs` is the current scan registry owner. No obsolete or duplicate registry is
introduced merely because closed PR #2374 used an older shape.

## Completion Criteria

- [x] TC-01: The rule, gate catalogue, orchestrator, recorder, scanner, and GATE-APPROVAL evaluator
      share one versioned subject-plus-projection endorsement key; DIRECT/CLASS and L1/L2 routes all
      enforce it, and the documented causal property does not depend on commit SHA ancestry.
- [x] TC-02: Focused fixtures accept exactly one current `ENDORSE | 0` and reject missing,
      wrong-subject, stale-key, duplicate, non-ENDORSE, unresolved, malformed, retrospective, and
      implementation-before-checkpoint records.
- [x] TC-03: The six issue #2377 classifier cases produce exactly two positives (one committed, one
      staged) and four negatives (ledger-only/malformed and implementation-mixed for each mode); an
      always-true mutation fails all four negatives, and a synthetic clean rebase preserves a valid
      checkpoint without rewriting its ledger evidence.
- [x] TC-04: Adoption fixtures keep unchanged terminal history exempt, re-govern changed or
      transitioned nonterminal work, and permit only the exact self-bootstrap tuple; completion
      fixtures prove `[ ]` to `[x]` and ordinary TC-specific Evidence Log additions preserve the key,
      while criterion text/ID/order or Test Plan edits change it; the approval evaluator never treats
      adoption exemption as current endorsement, and focused plus affected repository suites pass
      without a new unrelated historical failure.

## Test Plan

| TC-ID | Test Type                     | Tool / Approach                                                                                   | Notes                                                                 |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | Contract / unit               | rule/catalogue/gate route assertions plus `recommendation-review-record.test.mjs`                 | One projection/key implementation; DIRECT/CLASS and L1/L2 enforced.   |
| TC-02 | Unit / adversarial            | `scan-recommendation-endorsement.test.mjs` refusal matrix                                         | RED before scanner/recorder implementation; GREEN only on exact pair. |
| TC-03 | Integration / mutation        | committed/staged classifier fixtures, always-true mutant, and synthetic `git rebase` repository   | Preserves causal ordering while proving rebase stability.             |
| TC-04 | Integration / repository gate | adoption, projection-stability, and GATE-COMPLETE ownership fixtures plus live and affected scans | Checkbox/evidence changes stable; material plan changes stale.        |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-private recommendation-review provenance and gate enforcement; it
does not alter a Robota CLI, TUI, browser, public SDK, or installed-package behavior an end user can
execute.

## Tasks

- [x] `.agents/tasks/completed/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Mechanical criteria: PASS — `gate.mjs judge --gate GATE-WRITE --lane L2 --dry-run` judged 20 mechanical criteria PASS with 0 FAIL and left exactly 7 semantic criteria for guardian judgement; frontmatter, required sections, research substantiation, checklist, alternatives, TC prefixes, Test Plan, Tasks placeholder, empty Evidence Log, and body structure all satisfy the catalogue.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — at integration base `9983ef58a7e73e1133e2e6d0d4c8daa96b1a43c2`, the named absence check for `scan-recommendation-endorsement.mjs` succeeds and no aggregate scan consumes a universal recommendation verdict, so a recommendation can reach approval without subject-bound independent endorsement.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — the Problem fixes the condition to the named integration base and absence command, and separately identifies the rebase condition from issue #2377 where unchanged projected content loses SHA ancestry and pre-commit prevents repair.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — GitHub's reviewed-diff model, GitLab's patch-ID treatment, and NIST's retained review/decision ordering are applied to compare SHA ancestry, whole-commit identity, projection identity, and prose-only enforcement before selecting subject-plus-projection identity with separate causal replay.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — alternative 3 is selected because it survives SHA rewriting while invalidating material recommendation changes and keeps content identity narrower than a whole-commit patch ID; the Decision explicitly accepts the strict-parser/history-replay cost and preserves independent loop evidence.
- GATE-WRITE — New-surface placement (conditional): PASS as N/A — the proposal changes existing repository-private harness policy, agents, scripts, registrations, and tests; it introduces no package, app, presentation/interface surface, product-family classification, or layer-boundary reclassification.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — TC-01 covers the shared versioned key and SHA-independent causal contract, TC-02 the exact endorsement refusal matrix, TC-03 committed/staged classifier mutation and rebase stability, and TC-04 prospective adoption, self-bootstrap bounds, and repository regression safety.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — TC-01 requires inspectable shared contract identity, TC-02 specifies accepted and rejected fixture outcomes, TC-03 specifies truth-table, mutant, and synthetic-rebase outcomes, and TC-04 specifies historical-adoption and affected-suite outcomes.
- GATE-WRITE — TC-N count match: PASS — Completion Criteria contains 4 items (`TC-01`–`TC-04`) and Test Plan contains exactly 4 corresponding rows with non-empty test type, approach, and notes.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `9983ef58a7e73e1133e2e6d0d4c8daa96b1a43c2` · base `origin/develop@1ef05e0ea248fd68a10ffaa81f9fd1134cf8fdaf` · document `.agents/spec-docs/draft/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `321b3dbdd6ca6c86edb6ef660b7b03aa47c7cabb` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 87ea590d3ef3 (review 8feeb1e1, type/tags 55208af1)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (87ea590d3ef3) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9983ef58a7e7` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/backlog/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `8f2a0439a9bc` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** b1d3da331b74 (review 0790669d, type/tags 55208af1)

- GATE-APPROVAL — ordering: prior gate GATE-WRITE PASS and status `review-ready`: [GATE-WRITE] — ✅ PASS | 2026-09-20 (the PASS that upgraded the status; a later out-of-order entry does not revoke it); status `review-ready`
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b1d3da331b74) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9983ef58a7e7` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/todo/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `516554272603` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 246 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md",
  "specPath": ".agents/spec-docs/todo/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md",
    ".agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9983ef58a7e7` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/todo/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `f969f4b4f56b` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/recommendation-review-record.test.mjs scripts/harness/__tests__/gate.test.mjs`
**Exit:** 0
**Output:** (last 10 of 30 line(s))

```
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails naming a path outside the paired artifacts  323ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > does not count the auto-generated churn as a path outside the pair (#2376)  578ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails when the Task named in ## Tasks does not exist  371ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails when the Task named in ## Tasks exists only under the archived completed directory  365ms
   ✓ tree binding (issue #2213): a verdict names the state it judged > names HEAD, the document blob, and whether the judged content is what the repository holds  499ms

 Test Files  2 passed (2)
      Tests  118 passed (118)
   Start at  21:54:09
   Duration  23.68s (transform 294ms, setup 0ms, collect 423ms, tests 23.05s, environment 0ms, prepare 101ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `4ec2bf522f30` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs`
**Exit:** 0
**Output:** (last 10 of 54 line(s))

```
   ✓ topic ordering > finds implementation between an adoption-byte edit and exact restoration  1542ms
   ✓ topic ordering > finds implementation between a bootstrap edit and exact restoration  1493ms
   ✓ topic ordering > finds implementation while an endorsed subject is deleted before exact restoration  2246ms
   ✓ topic ordering > replays a ledger-only observation commit and rejects it as a checkpoint  1016ms
   ✓ topic ordering > rejects a topic ledger observation for a ghost subject  484ms

 Test Files  1 passed (1)
      Tests  54 passed (54)
   Start at  21:54:09
   Duration  43.12s (transform 86ms, setup 0ms, collect 108ms, tests 42.68s, environment 0ms, prepare 61ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `e7ba1a695f79` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs scripts/harness/__tests__/scan-recommendation-endorsement-staged.test.mjs`
**Exit:** 0
**Output:** (last 10 of 80 line(s))

```
   ✓ staged ordering > accepts literal HTML comment bytes in an escaped HTML opener as staged checkpoint evidence  1320ms
   ✓ staged ordering > accepts literal HTML comment bytes in an indented code block as staged checkpoint evidence  1262ms
   ✓ staged ordering > rejects a staged ledger observation for a ghost subject  566ms
   ✓ staged ordering > does not let a staged rejection erase an approved proposal from ordering  1073ms
   ✓ staged ordering > reports a staged governed-subject deletion mixed with implementation  1005ms

 Test Files  2 passed (2)
      Tests  80 passed (80)
   Start at  21:54:09
   Duration  50.40s (transform 85ms, setup 0ms, collect 191ms, tests 92.79s, environment 0ms, prepare 165ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `08f202986f4b` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs scripts/harness/__tests__/scan-loop-run-records.test.mjs scripts/harness/__tests__/gate.test.mjs`
**Exit:** 0
**Output:** (last 10 of 32 line(s))

```
   ✓ judge — GATE-IMPLEMENT reads the worktree > does not count the auto-generated churn as a path outside the pair (#2376)  558ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails when the Task named in ## Tasks does not exist  359ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails when the Task named in ## Tasks exists only under the archived completed directory  352ms
   ✓ judge — GATE-IMPLEMENT reads the worktree > fails GATE-IMPLEMENT when a strict not-applicable PLAN reason is thin  347ms
   ✓ tree binding (issue #2213): a verdict names the state it judged > names HEAD, the document blob, and whether the judged content is what the repository holds  415ms

 Test Files  3 passed (3)
      Tests  172 passed (172)
   Start at  21:54:09
   Duration  23.37s (transform 342ms, setup 0ms, collect 612ms, tests 23.17s, environment 0ms, prepare 205ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `cae6b4c6ff53` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-20

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no supplied --verify-cmd contains `build`, `harness:scan` or `run-all-scans` (supplied: `pnpm exec vitest run scripts/harness/__tests__/recommendation-review-record.test.mjs scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs scripts/harness/__tests__/scan-recommendation-endorsement-staged.test.mjs scripts/harness/__tests__/loop-run.test.mjs scripts/harness/__tests__/scan-loop-run-records.test.mjs scripts/harness/__tests__/gate.test.mjs` → exit 0 (Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature'))
  **Required action:** pass a build command via --verify-cmd

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `e8514a7f68d7` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-20

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20; status `in-progress`
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`). The `## Plan` SECTI: 4/4 tasks `[x]` in .agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md
- GATE-VERIFY — No Plan item is blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `pnpm harness:scan:recommendation-endorsement` → exit 0 ( ⏎ ::examined:: 485 post-approval recommendation document(s) ⏎ recommendation-endorsement scan passed (485 document(s) examined).); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/recommendation-review-record.test.mjs scripts/harness/__tests__/scan-recommendation-endorsement.test.mjs scripts/harness/__tests__/scan-recommendation-endorsement-staged.test.mjs scripts/harness/__tests__/loop-run.test.mjs scripts/harness/__tests__/scan-loop-run-records.test.mjs scripts/harness/__tests__/gate.test.mjs` → exit 0 (Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature'); all 2 supplied commands exit 0

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `52c74c1f8b5a` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-20

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-20; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 4/4 tasks `[x]` in .agents/tasks/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `d5cdce3d514f` · base `origin/develop@1ef05e0ea248` · document `.agents/spec-docs/active/RULE-2326-enforce-rebase-stable-universal-recommendation-endorsement.md` blob `8759a9fec001` (modified)
