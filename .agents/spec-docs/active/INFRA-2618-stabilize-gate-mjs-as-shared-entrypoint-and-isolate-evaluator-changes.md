---
status: in-progress
type: INFRA
tags: [infra]
lane: L2
---

# INFRA-2618: stabilize gate.mjs as shared entrypoint and isolate evaluator changes

Paired with `.agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md`. Arising from [issue #2618](https://github.com/woojubb/robota/issues/2618).

## Problem

`scripts/harness/gate.mjs` is both the public CLI entrypoint and the implementation owner for
argument parsing, document parsing, catalogue parsing, all mechanical criteria, approval measurement,
status transitions, evidence rendering, and command dispatch. On `origin/develop` it is 2,559 lines
and has been touched by 20 gate-related commits since introduction. A task that adds or corrects one
criterion therefore edits the same shared file as unrelated lifecycle work, producing avoidable merge
conflicts and making the evaluator look like it is being redefined by every task. The current
`gate-evaluator-isolation` check also names this monolith directly, so merely separating the entrypoint
from the evaluator would not preserve the intended self-grading protection.

Reproduction on the current `origin/develop`: `git log --follow --format='%h %s' origin/develop --
scripts/harness/gate.mjs | wc -l` returns `20`, and `wc -l scripts/harness/gate.mjs` returns `2559`.
The observed wrong property is that twenty separate gate-related changes have modified the same
combined CLI/evaluator module. When a new evaluator change is committed together with its spec
evidence, `node scripts/harness/scan-gate-evaluator-isolation.mjs` reports
`gate evaluator change(s) scripts/harness/gate.mjs share a diff with gate evidence ...`; the shared
entrypoint is therefore also the protected evaluator surface that every new criterion change touches.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

### Comparable documented patterns

- OpenAI Evals/Graders keeps the execution unit, data source, and grader criteria composable rather
  than making the runner own every evaluator: [Evals API](https://developers.openai.com/api/reference/resources/evals/methods/create).
- LangSmith separates dataset, target application, and reusable evaluator feedback:
  [Evaluation concepts](https://docs.langchain.com/langsmith/evaluation-concepts).
- Inspect separates task, solver, and scorer so an existing run can be rescored with another scorer:
  [Tasks](https://inspect.aisi.org.uk/tasks.html).
- GitHub documents reusable workflows as a stable caller-facing contract with implementation hidden
  behind inputs: [Reusing workflow configurations](https://docs.github.com/en/actions/concepts/workflows-and-actions/reusing-workflow-configurations).

Across these references, the stable execution surface receives structured input and returns structured
results, while evaluator implementations and criteria are replaceable units. Robota must preserve its
existing `gate.mjs` subcommands, exit codes (`0/1/2`), stdout contract, fail-closed semantics, and
catalogue-as-SSOT rule while moving implementation ownership behind that surface.

## Architecture Review

### Affected Scope

- `scripts/harness/gate.mjs` — stable CLI facade and compatibility re-exports.
- `scripts/harness/gate-cli.mjs` — argument parsing, command dispatch, usage, and process exit only.
- `scripts/harness/gate-document.mjs` — document/Markdown/evidence parsing and rendering helpers.
- `scripts/harness/gate-catalogue.mjs` — catalogue and prior-gate contract readers.
- `scripts/harness/gate-criteria.mjs` — mechanical criterion registry and criterion implementations.
- `scripts/harness/gate-operations.mjs` — judge/record/approve/advance operations composed from the
  document, catalogue, and criteria modules.
- `scripts/harness/gate-public-api.mjs` — compatibility export surface for existing consumers.
- `scripts/harness/scan-gate-evaluator-isolation.mjs` — recognize evaluator engine modules while
  preserving same-commit evidence isolation.
- `scripts/harness/scan-gate-entrypoint-stability.mjs` — fail when the stable facade's frozen digest
  changes after this migration.
- `scripts/harness/run-all-scans.mjs` and `.agents/harness.config.json` — register the new stability
  scan and its measured scope.
- `scripts/harness/file-size-baseline.json` — baseline the relocated engine and the small facade.
- `scripts/harness/__tests__/gate.test.mjs` — preserve compatibility and CLI behavior coverage.
- `scripts/harness/__tests__/scan-gate-evaluator-isolation.test.mjs` and
  `scripts/harness/__tests__/scan-gate-entrypoint-stability.test.mjs` — boundary regressions.

### Alternatives Considered

1. Keep adding criteria and lifecycle behavior directly to `gate.mjs`.
   - Pro: no migration and minimal short-term file movement.
   - Con: preserves the 2,559-line conflict hotspot and makes every evaluator change share the CLI
     ownership boundary.
2. Replace the gate with a new CLI and update all consumers in one breaking migration.
   - Pro: permits a clean redesign of the public API.
   - Con: broad blast radius, unnecessary caller churn, and higher risk of changing established exit
     and evidence contracts.
3. Keep `gate.mjs` as a stable facade, relocate the implementation to `gate-engine.mjs`, and enforce
   the facade digest with a dedicated scan.
   - Pro: preserves every existing caller while isolating evaluator changes and mechanically detects
     accidental edits to the shared entrypoint.
   - Con: requires a one-time rename, compatibility re-exports, and a new baseline/scan contract.

### Decision

Choose alternative 3. `gate.mjs` becomes a deliberately boring, stable facade: it delegates process
execution to `gate-cli.mjs` and re-exports the compatibility surface from `gate-public-api.mjs`.
The former monolith is split into document, catalogue, criteria, and operation modules, so future
criterion/lifecycle features land in the responsible module rather than redefining the entrypoint.
`scan-gate-evaluator-isolation` will treat the criteria/operation modules as evaluator code and
continue refusing a commit that changes evaluator code together with gate evidence.
`scan-gate-entrypoint-stability` will pin the facade digest after migration and fail closed on later
edits, while allowing the migration commit only when the resulting facade has the prescribed shape and
the baseline is introduced together. No catalogue wording, gate result, status transition, CLI
argument, exit code, or evidence format changes.

Validation before approval: all existing imports (`task-complete`, `new-spec` tests, gate tests) remain
reachable through the facade; the CLI is executed against representative L1 and L2 fixtures; each
split module has one owner and no reverse import into the facade; the evaluator-isolation scan still
rejects same-commit evaluator/evidence changes and permits separate commits; and adversarial tests
cover a changed facade digest, a criteria-module change, and a forged baseline.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Extract CLI parsing/dispatch, Markdown/document helpers, catalogue readers, mechanical criteria,
   and state-changing operations into their named modules without changing observable behavior.
2. Create `gate-public-api.mjs` as the compatibility export surface and reduce `gate.mjs` to the fixed
   facade that delegates to `gate-cli.mjs` and re-exports the public API.
3. Extend evaluator-isolation's evaluator prefix set to include the criteria/operation modules; keep
   the existing per-commit evidence rule unchanged and add boundary tests for the new paths.
4. Add a digest-based entrypoint stability scan with a one-time migration rule that validates the
   facade shape and refuses later facade/baseline edits. Register it in the affected scan plan.
5. Update the file-size baseline and import-safety/test fixtures for the split, then run the focused
   gate and scan suites and the affected harness verification.

## Affected Files

`.agents/spec-docs/draft/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md`
and `.agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md`
are planning records. Implementation paths are listed under Architecture Review → Affected Scope.

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/scan-gate-evaluator-isolation.test.mjs scripts/harness/__tests__/scan-gate-entrypoint-stability.test.mjs` exits 0, and the stability test exits 1 with its implementation reverted.
- [ ] TC-02: `pnpm exec vitest run scripts/harness/__tests__/gate-entrypoint-compatibility.test.mjs` exits 0; its subprocess assertions require `gate.mjs judge --gate GATE-WRITE` to return exit 0 and stdout containing `gate GATE-WRITE`, and require a one-byte facade mutation to make `scan-gate-entrypoint-stability.mjs` return exit 1.
- [ ] TC-03: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0 for the completed change.
- [ ] TC-04: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/scan-gate-evaluator-isolation.test.mjs scripts/harness/__tests__/scan-gate-entrypoint-stability.test.mjs` exits 0 on the complete focused files.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on gate and boundary tests | RED with the stability guard reverted, GREEN with it |
| TC-02 | Integration | fixture subprocesses invoking `gate.mjs` | CLI compatibility and digest refusal |
| TC-03 | Suite     | `run-all-scans.mjs --affected --context pr` | Affected harness set |
| TC-04 | Unit      | complete focused Vitest files | No single-test-only pass |

## User Execution Test Scenarios

Not applicable.

**Reason:** This is an internal harness-maintenance change with no shipped Robota product surface or user-facing product behavior; its CLI and scan assertions are maintainer engineering verification.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Tasks

- [ ] `.agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "gate.mjs는 하네스 구조 자체를 바꿀때만 수정되는 개념으로 바꾸고, 기능개발할 때는 항상 고정되게 하세요. 그리고 저게 너무 큰 묶음으로 되어 있다면 저걸 여러개의 책임으로 나누도록 리팩토링 하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 8810669167da (review 21a0eed1, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8810669167da) equals the document's current fingerprint

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/draft/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `18f0d35b29d0` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → review-ready

- GATE-WRITE — Contains a concrete symptom: PASS — the Problem identifies `scripts/harness/gate.mjs` as a 2,559-line combined CLI/evaluator module and names the incorrect same-file ownership behavior; the isolation scan's reported refusal is also specified.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem gives the current `origin/develop` measurements and the condition of adding/correcting an evaluator criterion together with gate evidence, which causes `scan-gate-evaluator-isolation.mjs` to report a shared diff.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS — the four cited documentation patterns establish composable execution/evaluator boundaries, and the subsequent alternatives and Decision select a stable facade with replaceable evaluator modules while preserving the existing contract.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — alternative 3 explicitly weighs a one-time rename, compatibility re-exports, and a new baseline/scan contract against preserving callers, exit codes, evidence format, and isolation.
- GATE-WRITE — New-surface placement (conditional): PASS — N/A because the spec adds internal `scripts/harness/` modules and scans only; it introduces no package, app, presentation/interface surface, or layer/product-family reclassification.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01/TC-04 cover focused gate and boundary verification, TC-02 covers facade compatibility and digest refusal, and TC-03 covers affected harness scans.
- GATE-WRITE — Each completion criterion uses Command or Observable behavior form: PASS — all four TC-N items specify executable commands and/or observable exit-code, stdout, or scan behavior.
- GATE-WRITE — Frontmatter and Problem sections checked: PASS — YAML frontmatter declares `status: draft`, `type: INFRA`, `tags: [infra]`, and the Problem is concrete and contains no `TBD`/`TODO` token.
- GATE-WRITE — Prior Art Research checked: PASS — `## Prior Art Research` is present and cites OpenAI, LangSmith, Inspect, and GitHub documentation.
- GATE-WRITE — Architecture Review checked: PASS — all checklist items are checked; the sibling scan has an explicit N/A reason; three alternatives have pro/con entries; and the Decision is documented.
- GATE-WRITE — Completion Criteria and Test Plan checked: PASS — TC-01 through TC-04 are present and the Test Plan has exactly four corresponding rows with non-empty test types and approaches.
- GATE-WRITE — Current measured evidence: PASS — `wc -l scripts/harness/gate.mjs` returned `2559`, and `git log --follow --format='%h %s' origin/develop -- scripts/harness/gate.mjs` contained `20` entries; both `HEAD` and `origin/develop` resolve to `22330a174dc6`.

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/draft/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `06b11eb4d12839bf5ba406b330c159b155aca32f` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "gate.mjs는 하네스 구조 자체를 바꿀때만 수정되는 개념으로 바꾸고, 기능개발할 때는 항상 고정되게 하세요. 그리고 저게 너무 큰 묶음으로 되어 있다면 저걸 여러개의 책임으로 나누도록 리팩토링 하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 8810669167da (review 21a0eed1, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8810669167da) equals the document's current fingerprint

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/backlog/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `1000c09b7b70` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-06

**Status remains:** review-ready
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `review-ready`, `approved` expected
  **Required action:** run the prior gate to PASS first
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task Test Plan/Testing section is 0 chars (absent)
  **Required action:** write a ≥50-char test plan in the Task

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/backlog/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `021af83386a0` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "gate.mjs는 하네스 구조 자체를 바꿀때만 수정되는 개념으로 바꾸고, 기능개발할 때는 항상 고정되게 하세요. 그리고 저게 너무 큰 묶음으로 되어 있다면 저걸 여러개의 책임으로 나누도록 리팩토링 하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 8810669167da (review 21a0eed1, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8810669167da) equals the document's current fingerprint

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/backlog/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `cb9b87b4e0cb` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "gate.mjs는 하네스 구조 자체를 바꿀때만 수정되는 개념으로 바꾸고, 기능개발할 때는 항상 고정되게 하세요. 그리고 저게 너무 큰 묶음으로 되어 있다면 저걸 여러개의 책임으로 나누도록 리팩토링 하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** b20971a04bae (review bdc658cc, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b20971a04bae) equals the document's current fingerprint

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/todo/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `5063cc7958fe` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-06; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task carries 5 checkbox tasks for 4 criteria
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 574 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md",
  "specPath": ".agents/spec-docs/todo/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md",
  "taskItems": [
    {
      "kind": "checkbox",
      "value": "Complete the approved INFRA-2618 spec and keep the implementation scope limited to the gate entrypoint/evaluator boundary."
    },
    {
      "kind": "checkbox",
      "value": "Extract CLI, document, catalogue, criteria, operation, and public-API modules; add the stable facade and preserve all supported exports/importers."
    },
    {
      "kind": "checkbox",
      "value": "Update evaluator-isolation for all extracted evaluator modules, add the facade stability scan and its tests, and register the scan."
    },
    {
      "kind": "checkbox",
      "value": "Update baselines/fixtures and run focused tests plus affected harness verification."
    },
    {
      "kind": "checkbox",
      "value": "Record completion evidence and close the paired spec/Task together."
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md",
    ".agents/tasks/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `22330a174dc6` · base `origin/develop@22330a174dc6` · document `.agents/spec-docs/todo/INFRA-2618-stabilize-gate-mjs-as-shared-entrypoint-and-isolate-evaluator-changes.md` blob `083bd019b603` (untracked)
