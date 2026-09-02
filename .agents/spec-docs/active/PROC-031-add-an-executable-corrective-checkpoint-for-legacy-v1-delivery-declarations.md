---
status: in-progress
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-031: add an executable corrective checkpoint for legacy v1 delivery declarations

Paired with `.agents/tasks/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md`. Arising from [issue #2561](https://github.com/woojubb/robota/issues/2561).

## Problem

PROC-029 deliberately binds a legacy v1 first GATE-IMPLEMENT PASS to the Decision at the commit that
introduced that PASS. It also says a legacy base missing the required sequenced-delivery facts must take
an explicit corrective checkpoint. The writer, declared v2 forms, history consumer, and staged consumer
implement only `gateImplementFirst` and `gateImplementContinuation`; no corrective form or command
exists.

The exact blocked case is AGREEMENT-006 at current `origin/develop`. Running
`node scripts/harness/gate.mjs judge --gate GATE-IMPLEMENT --continuation --doc
.agents/spec-docs/active/AGREEMENT-006-coordinate-productplan-and-runtime-bindings-migration.md
--dry-run` exits 1 because its current Decision has no `Delivery mode` line. A controlled probe adding
only the exact line `**Delivery mode:** \`sequenced\``then exits 1 with`legacy v1 historical Decision is not sequenced; a corrective checkpoint is required: Continuation
artifacts line must occur exactly once, found 0`. The introduction revision is immutable and correctly
lacks the later declaration, so neither editing current prose nor retrying continuation can satisfy the
contract. The documented recovery edge is therefore named but unreachable.

## Prior Art Research

Waived: PROC-029 already completed the relevant external prior-art research; this residual is an executable-path gap inside that accepted local checkpoint contract, so outside products cannot determine the repository-specific correction semantics.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — declare the correction evidence form and its fail-closed
  eligibility contract.
- `.agents/specs/gate-catalogue.md` and `.agents/skills/backlog-pipeline/SKILL.md` — expose and route the
  native correction mode without weakening ordinary first/continuation ordering.
- `scripts/harness/checkpoint-evidence-contract-shapes.mjs`,
  `scripts/harness/checkpoint-evidence-contract.mjs`, and
  `scripts/harness/checkpoint-evidence-source.mjs` — own the typed form, exact key order, Decision
  binding, and sequence validation.
- `scripts/harness/gate-implementation-contract.mjs`, `scripts/harness/gate.mjs`, and
  `scripts/harness/gate-checkpoint-evidence.mjs` — select, judge, and render a correction natively.
- `scripts/harness/checkpoint-evidence-git-contract.mjs` and
  `scripts/harness/scan-user-execution-plan-order.mjs` — resolve the immutable legacy introduction,
  correction introduction, and later continuation anchor consistently.
- Focused checkpoint-contract, gate, writer, and plan-order test files.
- No package/app source, product behavior, published API, dependency graph, or live GitHub Issue state.

### Alternatives Considered

1. **Add one explicit v2 `gateImplementCorrection` form and native `--correction` route.**
   - Pro: preserves immutable v1 meaning while creating the durable, typed transition PROC-029 already
     requires; writer and every consumer can validate the same anchor.
   - Con: extends the rule, catalogue, CLI, Git resolver, consumers, and fixtures together.
2. **Treat a current Delivery mode/artifact line as sufficient for legacy continuations.**
   - Pro: a small reader change would unblock AGREEMENT-006 immediately.
   - Con: reinstates the post-hoc inference PROC-029 explicitly forbids and lets current prose rewrite
     what an old PASS authorized.
3. **Replace AGREEMENT-006 with a new Task/spec identity and take a fresh first checkpoint.**
   - Pro: uses existing v2 first/continuation forms without a schema extension.
   - Con: duplicates the durable owner, rewrites the approved manifest and Issue mapping, and hides the
     missing recovery edge instead of making the declared contract executable for every legacy record.

### Decision

Choose alternative 1. The correction is a new v2 PASS form, not a reinterpretation of v1 and not an
ordinary continuation. It is eligible only when the sequence begins with exactly one valid legacy v1
first PASS whose introduction Decision is not sequenced, the current spec and Task are both
`in-progress`, the current Decision declares `sequenced` with a non-empty exact artifact array, the
Task items and PLAN signal still match the first checkpoint, and the worktree is planning-only. The
payload binds the legacy first-PASS digest, its introduction commit, the current delivery declaration,
Task/spec paths and items, PLAN signal, and sorted inventory. It is introduced by a dedicated planning
checkpoint commit. A later continuation must find and validate that correction at its introduction
revision, use its delivery array as the canonical anchor, and hash the latest valid correction or
continuation PASS as its predecessor.

**Delivery mode:** `single`

Validated recommendation:

- Reachability: `gate.mjs --correction` writes the rule-declared form; the native continuation writer,
  history scan, and staged scan all consume that same form, so legacy first → correction → continuation
  has one complete executable path.
- Capability preservation: raw v1 bytes and semantics remain unchanged; valid historical v1 sequenced
  checkpoints continue directly; existing v2 first/continuation sequences are unchanged; only a
  provably missing legacy delivery declaration may enter correction.
- Adversarial pass: refuse no/duplicate first PASS, an already-sequenced legacy introduction, any v2
  first checkpoint, single or empty delivery, stale or mismatched prior digest/introduction SHA,
  Task/PLAN/artifact drift, non-planning paths, duplicate/retrospective correction, correction not yet
  on the integration base, and drift before first or later continuations.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — compared the v1/v2 shape owner, native first and continuation writers,
      introduction-revision Git resolver, history/staged consumers, PROC-029 tests, and the exact
      AGREEMENT-006 evidence sequence; none implements a correction producer or accepted form.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Extend the v2 declaration in `.agents/rules/backlog-execution.md` and the shared shape/parser with
   `gateImplementCorrection`, exact fields, key order, and sequence invariants.
2. Add `--correction` to `gate-implementation-contract.mjs`/`gate.mjs`; render the payload through
   `gate-checkpoint-evidence.mjs` only after every legacy/history/Decision/Task/PLAN/inventory precondition
   passes.
3. Extend the Git contract and plan-order consumer so correction eligibility is proven at its own
   introduction commit and all later continuations bind the same delivery array and latest PASS digest.
4. Update the catalogue/pipeline route and focused fixtures, including an end-to-end AGREEMENT-006-shaped
   legacy first → correction → continuation sequence and every adversarial refusal named above.
5. Run RED proof, focused whole-file suites, affected/full scans, build, exact-head review, and the normal
   Work-Run/PR gates. After merge, return to the paused B2 branch, record the AGREEMENT-006 correction
   checkpoint on a fresh base, merge it, then re-run continuation before any GitHub Issue mutation.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-pipeline/SKILL.md`
- `scripts/harness/checkpoint-evidence-contract-shapes.mjs`
- `scripts/harness/checkpoint-evidence-contract.mjs`
- `scripts/harness/checkpoint-evidence-source.mjs`
- `scripts/harness/checkpoint-evidence-git-contract.mjs`
- `scripts/harness/gate-implementation-contract.mjs`
- `scripts/harness/gate-checkpoint-evidence.mjs`
- `scripts/harness/gate.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- Focused test files under `scripts/harness/__tests__/`

## Completion Criteria

- [ ] TC-01: checkpoint contract tests parse/format exactly one v2 correction form with the declared key
      order and refuse missing, duplicate, reordered, unknown, or semantically inconsistent fields.
- [ ] TC-02: gate/writer tests reproduce AGREEMENT-006's legacy introduction failure, then prove the
      native correction command emits a canonical PASS only for the exact eligible state.
- [ ] TC-03: history and staged plan-order tests accept legacy first → correction → first/later
      continuation, and reject post-hoc-only declarations plus every stale, duplicate, drifted, or
      retrospective correction control.
- [ ] TC-04: reverting the correction implementation makes the exact eligible end-to-end fixture RED,
      while existing valid v1 sequenced and v2 first/continuation fixture populations remain GREEN.
- [ ] TC-05: focused whole-file suites, affected scan, full harness scan, `pnpm build`, and
      `git diff --check` all exit 0 on the reviewed exact head.

## Test Plan

| TC-ID | Test Type       | Tool / Approach                                                                    | Notes                                                     |
| ----- | --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| TC-01 | Contract unit   | `checkpoint-evidence-contract.test.mjs` and source/shape fixtures                  | Exact schema and semantic refusal matrix                  |
| TC-02 | Writer unit     | `gate.test.mjs` plus `gate-checkpoint-evidence.test.mjs`                           | Native eligible/refusal behavior                          |
| TC-03 | Repository unit | `scan-user-execution-plan-order.test.mjs` history and staged fixtures              | Introduction binding, sequence, drift, later continuation |
| TC-04 | Red proof       | targeted eligible fixture with the implementation reverted                         | RED before correction support, GREEN after                |
| TC-05 | Suite           | focused Vitest, affected/full `harness:scan`, `pnpm build`, and `git diff --check` | Exact-head regression and repository contracts            |

## User Execution Test Scenarios

Not applicable.

**Reason:** This change affects repository checkpoint evidence and validation only; it exposes no Robota
product, SDK, CLI, TUI, or user-observable runtime surface.

## Tasks

- [ ] `.agents/tasks/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-02

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — file begins with a `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares `status: draft`.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS — `type: RULE` is an allowed value.
- GATE-WRITE — `tags:` field present in frontmatter: PASS — `tags:` is present with two values.
- GATE-WRITE — Contains a concrete symptom: PASS — the Problem names the missing correction form and command, and the unreachable corrective-checkpoint behavior.
- GATE-WRITE — Contains a reproduction condition: PASS — the Problem names the exact AGREEMENT-006 document, `origin/develop`, command, controlled Decision edit, exit status, and refusal text.
- GATE-WRITE — Does not contain `TBD`, `TODO`, or a vague single-sentence Problem: PASS — the Problem contains neither token and has 1,227 characters across eight sentences.
- GATE-WRITE — `## Prior Art Research` or `## Research` section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research is substantiated by a source, no-comparable-reference result, or waiver: PASS — the section carries an explicit reasoned waiver to PROC-029's completed research.
- GATE-WRITE — Explicit `Waived: <reason>` alternative is satisfied: PASS — the waiver explains why external products cannot determine this repository-specific correction semantic.
- GATE-WRITE — Research findings or waiver feed Alternatives Considered and Decision: PASS — the accepted local-contract boundary directly yields the explicit-form, post-hoc-inference, and replacement-identity alternatives and the selected decision.
- GATE-WRITE — All Architecture Review checklist items are checked: PASS — 5 of 5 items are `[x]`.
- GATE-WRITE — Sibling scan is checked with completion evidence or an explicit N/A reason: PASS — it names the v1/v2 shape owner, writers, Git resolver, consumers, tests, and AGREEMENT-006 sequence inspected.
- GATE-WRITE — Alternatives Considered has at least two entries with Pro and Con: PASS — three numbered alternatives each state both.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — it preserves immutable v1 meaning and gains a durable typed correction at the cost of coordinated rule, CLI, Git-resolver, consumer, and fixture changes.
- GATE-WRITE — New-surface placement conditional: PASS as N/A — the change extends the existing repository-internal GATE-IMPLEMENT CLI and `scripts/harness` contract family without a package, app, product/presentation surface, sibling-product dependency, or layer/product-family reclassification.
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: PASS — all five criteria are prefixed TC-01 through TC-05.
- GATE-WRITE — At least one criterion exists per distinct feature or sub-item: PASS — TC-01 covers the schema, TC-02 the writer, TC-03 history/staged consumers, TC-04 RED proof and compatibility, and TC-05 repository verification.
- GATE-WRITE — Each criterion uses Command or Observable behavior form: PASS — each requires explicit parser acceptance/refusal, canonical PASS emission, sequence acceptance/rejection, RED/GREEN outcome, or named commands exiting 0.
- GATE-WRITE — No criterion uses forbidden vague phrases: PASS — none contains `works correctly`, `no errors`, `implemented`, or `displays correctly`.
- GATE-WRITE — `## Test Plan` section present: PASS — the section is present.
- GATE-WRITE — One Test Plan row exists for each Completion Criterion: PASS — five rows match five TC criteria.
- GATE-WRITE — Every Test Plan row has a non-empty Test Type and Tool/Approach without `TBD`: PASS — all five rows satisfy the fields.
- GATE-WRITE — Manual Test Plan rows explain why automation is impossible: PASS — there are zero manual rows.
- GATE-WRITE — `## Tasks` section present with placeholder: PASS — it names the paired todo Task.
- GATE-WRITE — `## Evidence Log` was present and empty before this first entry: PASS — the mechanical dry-run observed zero prior entries and no later-gate entry.
- GATE-WRITE — No body `## Status` or `## Classification` section: PASS — neither body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-02

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "타당한 근거와 함께 추천안을 제시하면 타당할경우 자동 승인하겠습니다"
**Given:** 2026-09-01, this conversation
**Review fingerprint:** a326c644db9b (review e68fe6ad, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-01, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a326c644db9b) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-02; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 695 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md",
  "specPath": ".agents/spec-docs/todo/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md",
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
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md",
    ".agents/tasks/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->
