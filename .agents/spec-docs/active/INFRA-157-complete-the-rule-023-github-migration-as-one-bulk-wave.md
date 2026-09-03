---
status: in-progress
type: INFRA
tags: [github, migration, governance]
lane: L2
---

# INFRA-157: complete the RULE-023 GitHub migration as one bulk wave

Paired with `.agents/tasks/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md`.

## Problem

The approved 48-row absorption batch is durable on `develop`, but eleven source Issues still carry `priority:P2` and their Tasks still carry `urgency: later`. The current conversion owner refuses every such row with `priority:P2 must be promoted to priority:P1 before conversion`, so applying the otherwise approved batch would either stop partway or bypass the repository's exact Task-to-Issue finalizer. The same external wave must also write twenty RETAIN lifecycle sections, four canonical parent maps, three parent reopenings, and one completed reconciliation before one full post-write read-back.

## Prior Art Research

Waived: RULE-023, AGREEMENT-007 through AGREEMENT-016, and INFRA-155 already contain the completed classification and migration design. This record owns only the final atomic execution wave and the newly observed P2 conversion precondition in the current local harness.

## Architecture Review

### Affected Scope

- Eleven already approved Task frontmatter urgency values.
- The durable RULE-023 manifest and temporary `/tmp` execution evidence.
- Exactly 48 ABSORB, 20 RETAIN, four parent-map, three reopen, and one completed-reconciliation GitHub outcomes.
- No product source or package boundary.

### Alternatives Considered

1. **Bypass the conversion finalizer for P2 rows.**
   - Pro: fewer repository edits.
   - Con: defeats the exact Task identity and priority handoff guard.
2. **Split the eleven P2 rows into later serial waves.**
   - Pro: no urgency change today.
   - Con: leaves an approved batch incomplete and repeats snapshot, API, and verification overhead.
3. **Promote the eleven rows together and execute one snapshot-driven bulk wave.**
   - Pro: satisfies the current owner contract while preserving one bounded rollback/read-back unit.
   - Con: enlarges the final mutation unit and requires all eleven Task urgency corrections together.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — governance records and GitHub administration only.
- [x] Sibling scan 완료 — the 48 approved rows, 20 RETAIN rows, four parent maps, P2 labels, Task frontmatter, and current finalizer were inspected.
- [x] 대안 최소 2개 검토 완료 — three alternatives above.
- [x] 결정 근거 문서화 완료 — exact finalizer compatibility and one-wave recovery drive the decision.
- [x] New-surface placement: N/A — no package, application, or public product surface.

### Decision

Promote the eleven P2 source Issues to P1 and change their already approved Tasks from `urgency: later` to `urgency: soon`, then execute all approved GitHub outcomes from one `/tmp` before snapshot. The larger mutation unit is accepted because every row has an exact owner and immutable before-state; in exchange, comments, final states, lifecycle sections, parent maps, and relationships receive one complete post-write comparison instead of 48 serial verification cycles.

**Delivery mode:** `single`

## Solution

Checkpoint intent: this paired Task/spec is activated atomically before any Task urgency or GitHub mutation.

1. Freeze all Issue bodies/comments and all target relations in `/tmp`, validate the exact `woojubb` actor, and build an idempotent local mutation plan.
2. Persist the eleven Task urgency corrections and promote their source labels from P2 to P1 before Task-marker finalization.
3. Add 48 exact Task-marker comments, read them back, remove all priority labels, and close those Issues `NOT_PLANNED` without changing bodies, assignees, hierarchy, or dependencies.
4. Add twenty substantive `## Independent external lifecycle` sections with exact `@woojubb` receipts; update four complete parent maps; reopen issues #1985, #1986, and #2512; record PR #2235/commit `3cea3b8b5d573cdde207e132c615057a039accc4` plus residual issue #2225 on issue #2093 and close it `COMPLETED`.
5. Download the complete after snapshot, compare the whole authorized set once, update the durable manifest and `/tmp/robota-issue-child-consolidation-plan.md`, and run one large repository verification.

## Completion Criteria

- [x] TC-01: Observable: exactly eleven named P2 rows become P1 before conversion and their exact Tasks record `urgency: soon`.
- [x] TC-02: Observable: 48 exact `woojubb` Task markers are readable, their Issues preserve byte-identical bodies/assignees/relations, have no priority label, and are `CLOSED/NOT_PLANNED`.
- [x] TC-03: Observable: all twenty RETAIN Issues remain OPEN and contain their substantive lifecycle reason plus exact `Semantic review: @woojubb on 2026-09-03 — RETAIN` receipt exactly once.
- [x] TC-04: Observable: four complete canonical parent maps are readable, issues #1985, #1986, and #2512 are OPEN, and issue #2093 contains the delivery reconciliation and is `CLOSED/COMPLETED`.
- [ ] TC-05: Command: the before/after `/tmp` audit, exact manifest assertions, issue-triage audit, planning/lifecycle/reference scans, and final large repository verification all exit zero or report no unexplained mutation.

## Test Plan

| Criterion | Test Type | Tool / Approach                                           |
| --------- | --------- | --------------------------------------------------------- |
| TC-01     | automated | snapshot label and Task-frontmatter comparison            |
| TC-02     | automated | exact comment/body/state/label/assignee/relation diff     |
| TC-03     | automated | exact-set lifecycle-section and state assertion           |
| TC-04     | automated | parent-map cardinality/state and reconciliation assertion |
| TC-05     | automated | post-snapshot audit plus current repository harness       |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository governance and GitHub administration; every outcome is machine-readable and no product user interface changes.

## Tasks

Paired execution record: `.agents/tasks/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md`.

## Execution Evidence

- Actor preflight: `GH_CONFIG_DIR=/Users/jungyoun/.config/gh-woojubb gh api user --jq .login` returned `woojubb`.
- Complete snapshots and operation logs are named in `/tmp/robota-issue-child-consolidation-plan.md` section 15 and in the durable RULE-023 manifest.
- `/tmp/robota-issue-bulk-verification-final.json` records 511/511 PASS, 273→227 OPEN Issues, 48 exact marker comments, 20 RETAIN sections, zero missing native child, and zero unexplained Issue/comment mutation.
- The live triage audit examined 227 OPEN Issues and reported `native-child-retained: 20`, `native-child-missing: 0`; its global nonzero result is isolated to 18 broader queue-shape rows outside the migration result.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-03

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the file begins with a delimited `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one permitted value: PASS — `type: INFRA` is one of the 11 allowed values.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with three values.
- GATE-WRITE — Contains a concrete symptom: PASS — eleven approved source Issues still carry `priority:P2` while their Tasks remain `urgency: later`, and the conversion owner refuses them with `priority:P2 must be promoted to priority:P1 before conversion`.
- GATE-WRITE — Contains a reproduction condition: PASS — attempting the approved batch through the current exact Task-to-Issue finalizer before promoting those labels and Task urgency values triggers the stated refusal and risks a partial wave.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 602 characters across three specific sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section explicitly waives duplicate research because RULE-023, AGREEMENT-007 through AGREEMENT-016, and INFRA-155 already contain the completed classification and migration design.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the waiver limits this record to the final execution wave and newly observed local finalizer precondition, with no new product or architecture surface.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — the approved finite disposition set and measured P2 precondition directly yield bypass, serial split, and snapshot-driven bulk alternatives and the selected one-wave plan.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — all five displayed items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — the checked item records inspection of 48 approved rows, 20 RETAIN rows, four parent maps, P2 labels, Task frontmatter, and the current finalizer.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it accepts a larger final mutation unit because every row has an exact owner and immutable before-state, in exchange for one complete post-write comparison rather than 48 serial verification cycles.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — this governance and GitHub administration wave introduces no package, app, presentation/public interface, product-family surface, or layer reclassification.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed `TC-01:` through `TC-05:`.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers the eleven P2/P1 and Task-urgency transitions, TC-02 the 48 ABSORB outcomes and byte-preserved state, TC-03 the 20 RETAIN lifecycle receipts, TC-04 four parent maps plus three reopenings and issue #2093 reconciliation, and TC-05 the complete before/after audit and repository verification.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — the criteria require exact counts and states, readable markers and receipts, byte-identical fields and relations, explicit parent/reconciliation state, and named audits and scans with zero or no unexplained mutation.
- GATE-WRITE — No criterion uses a forbidden vague phrase: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match the five completion criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the required fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — the section names the paired INFRA-157 execution record.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-03

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "한꺼번에 모두 승인함. 더이상 승인 못할 이유가 없음"
**Given:** 2026-09-03, this conversation
**Review fingerprint:** e8ba9942a0ce (review 2165a030, type/tags 964acd44)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-03, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e8ba9942a0ce) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — immediately after the exact INFRA-157 bulk-execution scope was presented, the user replied `한꺼번에 모두 승인함. 더이상 승인 못할 이유가 없음`; the first sentence directly approves the whole presented wave and the second explicitly removes any residual approval ambiguity.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the entry selects the mutually exclusive DIRECT route, so no delegated approval class is asserted and the Route CLASS boundary criterion does not apply.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — this governance and GitHub administration wave introduces no package, app, product/interface/presentation surface, sibling-product dependency, or layer/product-family reclassification; its GATE-WRITE review records the same N/A boundary.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-03

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-03; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 282 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md",
  "specPath": ".agents/spec-docs/todo/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md",
    ".agents/tasks/INFRA-157-complete-the-rule-023-github-migration-as-one-bulk-wave.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
