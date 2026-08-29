---
title: 'INFRA-140: checkpoint evidence forms need a declared owner and revision-bound consumers'
issue: https://github.com/woojubb/robota/issues/2394
status: done
created: 2026-08-29
completed: 2026-08-29
priority: high
urgency: now
area: .agents/rules/backlog-execution.md, .agents/specs/gate-catalogue.md,
  scripts/harness/checkpoint-evidence-contract.mjs, scripts/harness/gate.mjs,
  scripts/harness/scan-user-execution-plan-order.mjs, scripts/harness/__tests__
depends_on: []
---

# INFRA-140: checkpoint evidence forms need a declared owner and revision-bound consumers

## Objective

Declare the machine-readable GATE-IMPLEMENT and DONE-GATE-STAGE-1 evidence forms in their owning rule,
make the gate catalogue reference those forms, and make every writer/consumer apply the declaration at
the checkpoint revision. A valid `gate.mjs` PASS must be accepted without hand amendment, while an
unreadable declaration or missing/mismatched field remains fail-closed with a named diagnostic.

Canonical source issue: https://github.com/woojubb/robota/issues/2394. Blocking symptom:
https://github.com/woojubb/robota/issues/2433. Contained diagnostic issue:
https://github.com/woojubb/robota/issues/2395.

## Conversion Decision

Finding-depth triage identified issue #2394 as the already-filed foundational owner. Issue #2433 is a
blocking instance of that cause, not a second contract: the current GATE-IMPLEMENT writer omits a token
from the scan-private form. INFRA-140 therefore implements issue #2394 as one Task and explicitly contains
issue #2433. GATE-IMPLEMENT first/continuation forms and DONE-GATE-STAGE-1 share the same missing declaration
cause and one independent completion outcome. Issue #2422 still owns continuation gate execution;
issue #2395 is now contained because field-specific declared-form results directly resolve its opaque
incomplete-entry diagnostic.

## Existing Evidence

- `completeGateImplementEntry()` privately requires a status line, paired Task path, either `todo/` or
  `active/` spec path, exact `SCENARIO DRAFTED` signal, and whole-worktree signal.
- `completeStageOneEntry()` privately constructs an exact ordered field line for every scenario,
  including product surface/rationale, invocation, observable/rationale, optional state/manual fields,
  guardian verdict, and field-completeness tokens.
- `gate.mjs judge --gate GATE-IMPLEMENT` currently records the Task path, scenario signal, and
  whole-worktree result, but no exact spec path.
- On the INFRA-138 branch, the generated GATE-IMPLEMENT entry passed 7/7 mechanical criteria. The
  exact Task/spec/ledger planning commit was then refused twice by the pre-commit plan-order scan;
  after the Task status was corrected to `in-progress`, the remaining diagnostic was:
  `checkpoint is neither the first GATE-IMPLEMENT PASS transitioning the exact Task/spec pair into
in-progress nor one continuation PASS`.
- Issue #2433 reports the same reproduction on a different work unit and notes that hand-adding the
  paired spec path makes the scan accept the checkpoint. Issue #2395 records the same private
  conjuncts being collapsed into a false “missing PASS” diagnostic and is contained here.
- The gate catalogue states semantic evidence summaries but does not declare the exact parsed form;
  the completed migrated HARNESS-128 record and open issue #2394 explicitly preserve this obligation.
- The founding INFRA-140 planning checkpoint necessarily predates its own rule declaration. A valid
  cutover must prove legacy eligibility by ancestry rather than treating a missing declaration as an
  unbounded fallback.

## Plan

- [x] TC-01: declare parseable first-checkpoint, continuation, and Stage-1 forms in the owning rule and
      reference them from the catalogue.
- [x] TC-02: parse the declaration fail-closed, naming unreadable, missing, malformed, duplicate, and
      unsupported fields.
- [x] TC-03: make the real GATE-IMPLEMENT writer emit declared first-checkpoint binding evidence and
      prove the real staged consumer accepts it, including a valid zero-checkbox/full-TC-ID Task.
- [x] TC-04: enforce first → `todo/` and continuation → `active/` spec-folder binding without
      implementing issue #2422's continuation judge route; accept an end-to-end staged continuation
      whose non-empty Decision artifact list is planning intent and whose worktree is planning-only.
- [x] TC-05: validate DONE-GATE-STAGE-1 entries from the declared field set, including optional
      state-path and manual-only evidence, with deterministic outcome/surface action selection for the
      multi-source manual-TUI case.
- [x] TC-06: read the declaration from the checkpoint revision in staged/history analysis and prove
      applied-check mutation failure, with an ancestry-proven legacy-v0 cutover for pre-v1 entries.
- [x] TC-07: preserve valid existing checkpoint/scenario fixtures and every mismatched binding refusal;
      cover continuation mutations of the exact prior-PASS byte digest and machine-readable Decision
      artifact line.
- [x] TC-08: replace issue #2395's generic incomplete-PASS message with the exact missing or mismatched
      declared form/field.
- [x] TC-09: run focused contract, gate, and plan-order test suites.
- [x] TC-10: run affected harness scans.
- [x] TC-11: run CI-equivalent verification.

## Test Plan

- Focused RED/GREEN contract-parser tests over the rule declaration and catalogue reference.
- Cross-component integration test over actual GATE-IMPLEMENT writer output and staged plan-order.
- Adversarial tests for unreadable/malformed declarations, form-specific wrong lifecycle folders,
  another basename, mismatched scenario signal, missing whole-worktree evidence, and incomplete
  Stage-1 fields.
- Bootstrap tests for the founding checkpoint, existing pre-v1 entries, v1 cutover ancestry, and
  refusal of any post-cutover entry that lacks v1 evidence.
- Diagnostic tests reproducing issue #2395 and naming the exact failed form/field.
- Existing gate and plan-order suites plus the new evidence-contract suite.
- `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`.
- `pnpm harness:verify-like-ci` before publishing.

## Implementation Evidence

- Strict v1 declaration/parser, first-checkpoint writer, revision-bound first/continuation consumer,
  Stage-1 binding, and finite legacy cutover are implemented in the planned harness files.
- Focused regression: 191/191 tests passed (100%) across the contract, gate, and plan-order suites.
- Affected PR-context scan: 60 scans passed, 1 skipped, and 1 host-transcript advisory was tolerated;
  repository-owned blocking findings were 0/62 (0%).
- Workspace typecheck initially exposed stale `agent-core` dist declarations; rebuilding that declared
  type owner made all 109/109 workspace project typechecks pass (100%) without source changes.
- Fresh-path `pnpm harness:verify-like-ci` exited 0: all 13/13 stages passed (100%), including 4,234/4,234
  contract tests, 1,153/1,153 hermetic tests, 109/109 workspace project typechecks, and both the
  dist-free and full scan suites with zero blocking findings.

## Result

Implemented one rule-owned v1 checkpoint evidence contract shared by the GATE-IMPLEMENT writer and
revision-bound plan-order consumer. First, continuation, and Stage-1 forms now fail closed on malformed
or mismatched fields, while ancestry-proven pre-v1 checkpoints retain a finite compatibility path.
Issue #2395 diagnostics name the exact failed form or field. GATE-VERIFY passed 5/5 criteria and
GATE-COMPLETE passed 9/9 criteria; all 11/11 completion criteria have recorded command/output evidence.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Not applicable.** This changes a repository-internal gate evidence contract and commit guard. It adds
no runnable product command, UI flow, public SDK behavior, configuration contract, runtime output, or
user-facing capability. The executable surface belongs in the engineering Test Plan.

## Conversion Verification

- `node scripts/harness/task-lifecycle.mjs classify <this Task>` → `open`.
- `pnpm harness:scan` → 147/148 scans passed (99.3%). Every Task schema, lifecycle, issue-link,
  collision, placement, and scenario-section scan passed. The sole failure is a host-transcript
  conduct finding from two earlier progress messages; it is unrelated to this Task conversion and is
  not absorbed into INFRA-140.

## Recommendation Review

Finding-depth triage returned `FOUNDATIONAL`; `DEPTH: 1 FOUNDATIONAL of 1`; `ACTIONABLE FINDINGS: 1`.
The initial issue #2433-only proposal synchronized one writer token with a scan-private schema but did not
create the canonical contract its title claimed. INFRA-140 is now re-scoped to the open foundational
owner issue #2394, with issue #2433 explicitly contained.

Independent review round 1 returned `REVISE`; `ACTIONABLE FINDINGS: 2`. It confirmed the same root
ownership defect and additionally required form-specific folder binding: first checkpoint → `todo/`,
continuation → `active/`. The revised plan declares both forms and keeps issue #2422's continuation
execution route out of scope.

`REVIEW VERDICT: REVISE`

Final finding-depth re-check confirms the expanded design remains one cause and needs no deeper owner
or split. Issue #2433 and issue #2395 are writer/diagnostic instances of the canonical form gap; issue #2422 remains a
separate continuation-execution cause. `DEPTH: LOCAL — expanded INFRA-140 owns the single canonical
evidence-form cause, its finite bootstrap, writer/consumer conformance, and diagnostics`;
`ACTIONABLE FINDINGS: 0`; `DEPTH: 0 FOUNDATIONAL of 1`.

Finding-depth re-check confirmed the canonical root is now owned across rule declaration, catalogue
reference, strict parser, writer, revision-bound consumers, and compatibility/mutation tests.
`DEPTH: LOCAL — revised INFRA-140 owns and resolves the canonical evidence-form contract`; `DEPTH: 0
FOUNDATIONAL of 1`; `ACTIONABLE FINDINGS: 0`.

Independent review round 2 returned `REVISE`; `ACTIONABLE FINDINGS: 3`. The revision must define an
ancestry-proven bootstrap for the founding/pre-v1 checkpoints, fully specify the v1 grammar and Stage-1
conditional truth table, and absorb issue #2395 because field-specific diagnostics resolve its exact cause.
It must also make `pnpm harness:verify-like-ci` an explicit completion criterion.

`REVIEW VERDICT: REVISE`

Independent review round 3 returned `REVISE`; `ACTIONABLE FINDINGS: 3`. The post-FAIL correction now
defines a production-reachable, independently guarded legacy-v0 founding checkpoint before the v1
implementation exists; closes the exact marker/fence/JSON/key-order/duplicate/unknown-field encoding;
and adds the catalogue-required ordered `taskItems` binding. These are bounded corrections to the
same declared evidence contract and bootstrap, not a scope expansion.

`REVIEW VERDICT: REVISE`

Independent review round 4 returned `REVISE`; `ACTIONABLE FINDINGS: 2`. The correction generalizes
`taskItems` to the same deterministic TC-ID-or-checkbox alternatives the current gate accepts, with a
zero-checkbox compatibility case. It also fixes continuation determinism by declaring the SHA-256 raw
entry byte range/encoding and an exact machine-readable Decision artifact line, with mutation tests.

`REVIEW VERDICT: REVISE`

Independent review round 5 returned `REVISE`; `ACTIONABLE FINDINGS: 2`. The correction defines
continuation artifacts as a checkpoint-time binding to planned Decision scope while worktree evidence
independently remains planning-only, and adds an end-to-end staged acceptance case. It also declares a
closed outcome/surface action map so manual TUI uses `uiSteps` while its command remains invocation.

`REVIEW VERDICT: REVISE`

Independent review round 6 returned `ENDORSE`; `ACTIONABLE FINDINGS: 0`. It found the planned-scope
versus planning-worktree separation, closed Stage-1 action map, revision-bound validation, canonical
Issue #2394 ownership, issue #2433 and issue #2395 containment, issue #2422 exclusion, and ancestry-guarded bootstrap executable
and sufficiently tested.

`REVIEW VERDICT: ENDORSE`
