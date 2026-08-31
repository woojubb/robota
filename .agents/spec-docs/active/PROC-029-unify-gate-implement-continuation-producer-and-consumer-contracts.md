---
status: in-progress
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-029: Unify GATE-IMPLEMENT continuation producer and consumer contracts

Paired with `.agents/tasks/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md`.
Arising from [issue #2422](https://github.com/woojubb/robota/issues/2422) and batching the related,
separately owned roots [issue #2561](https://github.com/woojubb/robota/issues/2561) / PROC-026 and
[issue #2261](https://github.com/woojubb/robota/issues/2261) under the user's approved coherent work unit.

## Problem

The GATE-IMPLEMENT lifecycle has three incompatible producer/consumer contracts at one durable boundary.

1. A first L2 checkpoint can reach `in-progress` without proving the exact continuation artifacts or
   atomically activating its paired Task. The missing facts were repaired downstream in PROC-023,
   PROC-024, and PROC-025, and the recurring producer defect is registered as PROC-026 / issue #2561.
2. `node scripts/harness/gate.mjs judge --gate GATE-IMPLEMENT --doc <active-spec>` has no continuation
   mode. It applies the first-run `approved` ordering to an `in-progress` document and appends a false
   FAIL, while `parsePriorGateMap()` silently ignores the catalogue's annotated
   `GATE-IMPLEMENT (continuation)` row. Issue #2422 owns this execution gap.
3. An unchanged Task carrying exact `SCENARIO DRAFTED: not-applicable | 0` and a substantive reason is
   rejected by `scan-user-execution-plan-order.mjs` unless the prose repeats the undeclared literal words
   `not applicable`. Meanwhile `gate.mjs` checks only the signal and
   `scan-spec-user-execution-section.mjs` checks only that a heading exists. Issue #2261 owns the missing
   shared reason-content contract.

Reproduction is the fresh AGREEMENT-006 B2 branch based at
`e936b861fb3593f052f80f8ad94322ed83b052a6`: a manually authored continuation entry with correct
ancestry `3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f` still makes
`node scripts/harness/scan-user-execution-plan-order.mjs --staged` exit 1 with
`not-applicable PLAN lacks its zero count and a concrete recorded reason.` No B2 Issue mutation ran.

## Prior Art Research

### References consulted

- **GitHub Actions reusable workflows.** `on.workflow_call` declares typed inputs and explicit outputs;
  passing an undeclared input is an error. Producer/consumer hand-off is a schema rather than inferred
  convention. [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onworkflow_callinputs)
  and [reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).
- **Temporal Continue-As-New.** Continuation is a first-class operation: the current execution closes,
  a new run starts in the same chain, and required state crosses the boundary through normal typed input.
  Temporal also exposes a dedicated test hook for this lifecycle.
  [Continue-As-New — TypeScript SDK](https://docs.temporal.io/develop/typescript/workflows/continue-as-new).
- **Kubernetes admission and CRD validation.** Mutation/defaulting precedes validation, a rejected object
  is not partially published, and OpenAPI/CEL validates structured state, enum transitions, and content
  constraints separately from human error text.
  [Admission phases](https://kubernetes.io/docs/reference/access-authn-authz/admission-controllers/#admission-control-phases),
  [CRD validation](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/#validation),
  and [CEL](https://kubernetes.io/docs/reference/using-api/cel/).
- **Redgate Flyway transaction handling.** Each migration, or a supported group, is a commit-or-rollback
  unit; unsupported non-transactional cases are explicit rather than advertised as atomic.
  [Transaction handling](https://documentation.red-gate.com/fd/migration-transaction-handling-273973399.html)
  and [group setting](https://documentation.red-gate.com/fd/flyway-group-setting-277579001.html).

Common behavior across the references is explicit lifecycle mode, a complete typed hand-off produced at
the durable boundary, fail-closed atomic publication, and separation of machine state from explanatory
prose. Compatibility uses a declared transition path rather than reconstructing missing state from text.

For Robota, the durable boundary is the dedicated Git planning-checkpoint commit. The first checkpoint
must therefore publish the exact Task/spec state and sequenced-delivery contract consumed later; the
canonical CLI must expose continuation explicitly; and PLAN reason validation must consume the structured
outcome/count plus a substantive reason instead of rediscovering outcome from English words.

Recommendation: evolve the existing rule-owned checkpoint evidence SSOT from v1 to a backward-readable
v2 carrying an explicit delivery discriminator and native `first`/`continuation` execution modes; do not
create a second evidence owner or mutate v1 semantics in place. Add a shared reason validator with
distinct Task-PLAN and spec-section grammars plus an explicit cutover, and prove the complete
producer→consumer path. Preserve legacy entries; a legacy base missing required facts takes an explicit
corrective checkpoint rather than an inferred fallback.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — own the discriminated first/continuation evidence contract and
  the structural not-applicable reason contract.
- `.agents/specs/gate-catalogue.md` — expose mechanically parseable continuation ordering and criteria.
- `.agents/skills/backlog-pipeline/SKILL.md` — route continuation through native `gate.mjs` and remove the
  temporary guard-only #2422 exception.
- `scripts/harness/gate.mjs` — parse the explicit continuation mode, judge its ordering/criteria, emit
  canonical continuation evidence, and atomically coordinate paired lifecycle state for a first run.
- `scripts/harness/checkpoint-evidence-contract.mjs` and its owning
  `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs`, plus
  `scripts/harness/scan-user-execution-plan-order.mjs` — consume the same discriminated checkpoint form.
- `scripts/harness/scan-spec-user-execution-section.mjs` plus one shared user-execution PLAN contract
  helper — validate structured outcome/count and substantive reason without private literal matching.
- Focused test files under `scripts/harness/__tests__/` — RED→GREEN producer, continuation, and reason
  contract regressions, including the exact AGREEMENT-006 reason shape.
- `.agents/tasks/PROC-026-first-gate-implement-checkpoint-does-not-establish-continuation-ready-task-spec-.md`
  — complete under its own first-checkpoint readiness criteria only after those outcomes are delivered.
- `.agents/tasks/HARNESS-134-give-not-applicable-reasons-one-shared-structural-contract.md` — preserve
  issue #2261's distinct reason-contract ownership and completion evidence.
- No package/app source, public API, product behavior, dependency direction, or live B2 Issue body/state.

### Alternatives Considered

1. **Extend the existing versioned checkpoint contract with shared readers and explicit delivery state.**
   - Pro: one owner defines what producers emit and all consumers validate; native routing removes the
     manual exception; the first durable boundary cannot publish a continuation-incomplete state.
   - Con: touches the rule, catalogue, CLI judge, two scans, and their fixtures in one coordinated change.
2. **Patch the three observed symptoms independently.**
   - Pro: each code edit is locally small.
   - Con: preserves three private contracts and the recurrence mechanism already measured across
     PROC-023/024/025 and #2261; another consumer can drift without a shared owner.
3. **Keep continuation guard-only and infer mode/artifacts from status and prose.**
   - Pro: avoids extending the CLI surface and evidence form.
   - Con: repeats the current false-FAIL path, makes prose a machine protocol, and cannot prove that a
     first checkpoint produced every fact a later branch consumes.
4. **Require every reason to repeat the literal phrase `not applicable`.**
   - Pro: preserves the existing plan-order regular expression.
   - Con: duplicates the structured discriminator in prose, still does not reject empty or factually
     invalid reasons, and contradicts the catalogue's content-level requirement.

### Decision

Choose alternative 1. The correct boundary is the existing rule-owned checkpoint evidence SSOT, evolved
to `checkpoint-evidence-contract:v2` with an explicit `deliveryMode: single | sequenced` discriminator
while the complete v1 declaration remains byte-for-byte present and byte-semantically readable.

**Delivery mode:** `single`

The v2 declaration is a second version region inside that same section, not a second owner. Its exact
markers are `<!-- checkpoint-evidence-contract:v2:start -->` and
`<!-- checkpoint-evidence-contract:v2:end -->`; its evidence markers are
`<!-- checkpoint-evidence:v2:start -->` and `<!-- checkpoint-evidence:v2:end -->`. The rule contains
exactly one non-overlapping v1 region followed by exactly one non-overlapping v2 region. A duplicate,
missing, nested, or unknown-version region fails. A validator parses both closed declarations, selects
exactly the declaration whose `version` equals the payload's integer `version`, and rejects a form not
declared by that version. Existing v1 payloads therefore keep the v1 reader. New GATE-IMPLEMENT writers
emit v2 exclusively; DONE-GATE-STAGE-1 remains on its unchanged v1 form because this change does not
revise that payload.

The v2 first payload has these keys in this exact order:
`version`, `form`, `deliveryMode`, `sequencedArtifacts`, `taskPath`, `specPath`, `taskItems`, `plan`,
`worktreePaths`. The v2 continuation payload has these keys in this exact order:
`version`, `form`, `deliveryMode`, `sequencedArtifacts`, `priorPass`, `ancestorSha`, `taskPath`,
`specPath`, `plan`, `worktreePaths`. Both always carry `sequencedArtifacts`: `single` requires the empty
array and forbids a `**Continuation artifacts:** ` Decision line; `sequenced` requires a non-empty,
duplicate-free repository-path array exactly matching that one Decision line. Continuation is valid only
for a prior v1 or v2 first PASS whose delivery contract is provably sequenced, records
`deliveryMode: "sequenced"`, and repeats the same artifact array. A legacy v1 first PASS proves sequenced
delivery only through its already-declared exact Decision line; if that fact is absent, the documented
corrective-checkpoint route remains required rather than inferred.

`first` judges and records the complete durable inputs, while `continuation` requires the prior canonical
PASS, unchanged Task/PLAN signal, base declaration, verified integration ancestry, and permitted inventory,
then renders the existing `in-progress → in-progress (continuation)` evidence form. `priorPass` continues
to hash the prior complete entry's raw bytes, including whichever v1/v2 evidence markers that entry owns.

The user-execution reason helper owns validation once but exposes two role-specific grammars. A strict
Task PLAN contains exactly one visible line
`**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\``and, later in the same section, exactly one
visible reason paragraph beginning`**Reason:** `; its reason need not repeat `not-applicable`. A strict
governed spec section either satisfies the existing applicable-scenario parser or contains the standalone
visible sentence `Not applicable.` followed by that same exact reason form; it never invents a Task author
signal.

"Visible" means the output of the existing `visibleMarkdown()` owner: HTML comments, fenced/indented code,
and raw HTML blocks cannot satisfy either field. The reason is the label's remainder plus immediately
continued paragraph lines, ending at a blank line, ATX heading, list item, or another bold field. Its
normal form is Unicode NFKC, Markdown emphasis/code/link syntax removed while visible label text is kept,
Unicode whitespace collapsed, and leading/trailing whitespace removed. "Substantive" means at least 50
Unicode scalar values and at least eight Unicode letter/number tokens after normalization. The normalized
reason is rejected when it contains, case-insensitively as a whole token or phrase, any engineering-only
exception evidence named by the authoritative rule: `build`, `typecheck`, `type check`, `lint`,
`unit test`, `unit tests`, `harness check`, `harness checks`, `CI check`, `CI checks`,
`static inspection`, `document inspection`, `backlog inspection`, `source inspection`, or `rg check`.

The cutover is ancestry-derived, not a prose date or mutable count. The new rule-owned grammar carries one
exact `<!-- user-execution-plan-contract:v1:start -->` / `:end` region. Its unique introduction commit is
the one reachable commit whose valid rule blob contains the region while every parent lacks it; zero or
multiple introduction commits fail closed. A replayed Task PLAN is strict exactly when that introduction
commit is equal to or an ancestor of its checkpoint commit. A current governed spec is strict when it is
untracked/changed in the worktree or the introduction commit is equal to or an ancestor of the last commit
that produced its current path/blob; otherwise it keeps its historical section-content contract. Thus an
untouched pre-cutover file remains frozen, while any post-cutover edit or folder transition loses the
content exemption. The existing folder-keyed section-presence baseline remains separate and may only
shrink. No reader requires prose to repeat a structured outcome token.

`judge` remains a judge/evidence producer. It must not mutate paired lifecycle state. After PASS,
`advance` validates all transition inputs and prepares Task and spec together as `in-progress`; the
dedicated Git planning commit is the durable atomic boundary, and scans reject either half without the
other.

This decision was validated against every current consumer (`gate.mjs`, both scans, backlog-pipeline,
checkpoint-evidence parser), the three historical correction records, the immutable AGREEMENT-006 Task,
and adversarial missing/blank/thin/mismatched/legacy cases. The three roots remain separately attributed;
batching is justified by their shared contract/files and one end-to-end verification boundary, not by a
claim that they are one cause.

Independent depth verdict (2026-09-01): first-checkpoint readiness is `FOUNDATIONAL` under PROC-026
because PROC-023/024/025 repeated the same downstream correction; native continuation routing is `LOCAL`
to #2422's `resolveGate()`/`parsePriorGateMap()` gap; shared reason semantics is `FOUNDATIONAL` under
#2261 because gate, plan-order, and section scans currently implement incompatible private contracts.

Independent recommendation review (2026-09-01): `REVIEW VERDICT: ENDORSE`. The reviewer confirmed that
the versioned payload, ancestry cutover, role-specific reason grammars, lifecycle atomicity, separate root
ownership, and one-PR integration boundary leave no unresolved design choice or scope expansion.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — gate judge, checkpoint parser, plan-order scan, section scan, and pipeline
      router were inspected as the full producer/consumer family.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add the exact closed v2 region and payload orders above to the rule-owned checkpoint contract; make new
   GATE-IMPLEMENT writers choose v2, validators dispatch by payload version, preserve v1 replay, and make
   annotated prior-gate rows parseable without changing canonical Evidence Log headings.
2. Add native GATE-IMPLEMENT continuation selection to `gate.mjs`; share ordering, prior-PASS, Task/PLAN,
   artifact, ancestry, and inventory validation with the checkpoint evidence consumer.
3. Keep `judge` side-effect boundaries unchanged; make `advance` validate and prepare Task/spec lifecycle
   together only after PASS, with the planning commit as the atomic publication boundary.
4. Extract one visible-Markdown reason validator implementing the exact forms, normalization, thresholds,
   forbidden vocabulary, and ancestry cutover above; reuse it in the gate and both scans.
5. Prove each regression RED on the pre-fix implementation and GREEN on the new contract, then exercise a
   first sequenced checkpoint immediately as the parent of a continuation.
6. On verified completion, mark PROC-026 and HARNESS-134 `done` under their own criteria and close each
   source Issue only for the outcome this work actually delivered.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-pipeline/SKILL.md`
- `scripts/harness/gate.mjs`
- `scripts/harness/checkpoint-evidence-contract.mjs`
- `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/scan-spec-user-execution-section.mjs`
- `scripts/harness/user-execution-plan-contract.mjs` (new shared owner)
- `scripts/harness/__tests__/gate.test.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `scripts/harness/__tests__/scan-spec-user-execution-section.test.mjs`
- `.agents/tasks/PROC-026-first-gate-implement-checkpoint-does-not-establish-continuation-ready-task-spec-.md`
- `.agents/tasks/HARNESS-134-give-not-applicable-reasons-one-shared-structural-contract.md`

## Completion Criteria

- [ ] TC-01: checkpoint-evidence-contract v2 accepts only the declared markers and exact first/continuation
      key orders, dispatches by payload version, writes new GATE-IMPLEMENT evidence as v2, and replays v1;
      `single` requires `sequencedArtifacts: []`, `sequenced` requires the exact non-empty Decision array,
      and after PASS `advance` prepares Task/spec together while every half-transition control is refused.
- [ ] TC-02: `gate.mjs judge --gate GATE-IMPLEMENT --continuation` on a valid `in-progress` fixture uses
      the annotated prior-gate row, emits `in-progress → in-progress (continuation)` with the exact prior
      digest/artifacts/ancestor/Task/PLAN/inventory, and never writes the first-run ordering FAIL.
- [ ] TC-03: the unique ancestry-derived cutover makes post-cutover Task and changed/transitioned spec
      consumers accept only their exact role-specific grammar and normalized 50-scalar/eight-token reason;
      reasons may omit the repeated outcome token but absent, blank, thin, hidden, duplicate, or listed
      engineering-verification reasons fail, while untouched pre-cutover fixtures replay unchanged.
- [ ] TC-04: one end-to-end fixture creates a first sequenced checkpoint and immediately validates it as
      the immutable parent of a continuation; focused gate, plan-order, section, checkpoint-contract, and
      affected harness suites all exit 0.
- [ ] TC-05: PROC-026 and HARNESS-134 are archived as `done` only after their own criteria and TC-01–TC-04
      pass, and issues #2422, #2561, and #2261 each receive truthful, outcome-specific delivery evidence.

## Test Plan

| TC-ID | Test Type     | Tool / Approach                                                    | Notes                                                                  |
| ----- | ------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| TC-01 | Rule contract | Checkpoint-contract, first-checkpoint, and advance Vitest fixtures | Include delivery-mode mutation and half-activation controls.           |
| TC-02 | Rule contract | `scripts/harness/__tests__/gate.test.mjs`                          | Assert CLI, annotated map, ordering, and exact rendered payload.       |
| TC-03 | Rule contract | Plan-order and section-scan cutover matrices                       | Include AGREEMENT-006, legacy/new, and hidden/thin/forbidden controls. |
| TC-04 | Integration   | Producer→consumer fixture plus affected harness scans              | Record RED proof against the base and GREEN outputs.                   |
| TC-05 | Lifecycle     | task-lifecycle, task-archival, live Issue read-back                | Close only after exact completion evidence is visible.                 |

## Tasks

- [ ] `.agents/tasks/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-01

**Status upgrade:** draft → review-ready

- Ordering: GATE-WRITE is the entry gate and has no predecessor. The document has `status: draft` and is under `.agents/spec-docs/draft/`, so its input state and folder agree.
- GATE-WRITE — File begins with `---` YAML frontmatter block: a closed leading `---` frontmatter block is present.
- GATE-WRITE — `status: draft` present in frontmatter: the frontmatter contains `status: draft`.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: `type: RULE` is an allowed value.
- GATE-WRITE — `tags:` field present in frontmatter: `tags: [workflow, harness]` is present.
- GATE-WRITE — Contains a concrete symptom: the Problem names three incompatible GATE-IMPLEMENT boundary behaviors, including the exact continuation command's false first-run ordering FAIL and rejection of structured `SCENARIO DRAFTED: not-applicable | 0` unless prose repeats an undeclared literal.
- GATE-WRITE — Contains a reproduction condition: the fresh AGREEMENT-006 B2 branch at `e936b861fb3593f052f80f8ad94322ed83b052a6`, prior ancestry `3ca5ab0cc5ab550d80ae3b3e3ae08af657d0bb0f`, exact staged scan command, exit 1, and refusal text are recorded.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: the multi-paragraph Problem contains neither placeholder and gives commands, revisions, outcomes, and ownership.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: official GitHub Actions, Temporal, Kubernetes, and Redgate Flyway documentation is cited.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: N/A — research is substantiated, so the alternative waiver form is not required.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: explicit lifecycle modes and typed hand-offs motivate v2's discriminator, atomic publication motivates PASS-then-advance plus the Git checkpoint, machine/prose separation motivates the shared reason validator, and declared compatibility motivates v1 replay with an ancestry cutover.
- GATE-WRITE — All 4 checklist items are `[x]`: all four Architecture Review Checklist entries are checked.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked item names the gate judge, checkpoint parser, plan-order scan, section scan, and pipeline router as the inspected producer/consumer family.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: four alternatives each state a Pro and Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: alternative 1 prevents private-reader drift through one versioned contract at the cost of a coordinated rule/catalogue/CLI/scans/fixtures change, while preserving v1 replay instead of mutating legacy semantics.
- GATE-WRITE — New-surface placement (conditional): N/A — the design extends the existing harness GATE-IMPLEMENT CLI and its rule-owned internal contract/readers; it introduces no independent package, app, presentation/interface surface, sibling PRODUCT dependency, or layer/product-family reclassification, and places the helper as a shared contract owner in the existing `scripts/harness` family.
- GATE-WRITE — Every item has a `TC-N` prefix: all five criteria are prefixed `TC-01` through `TC-05`.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 covers the v2 first/advance contract, TC-02 native continuation, TC-03 reason grammar and cutover, TC-04 producer-to-consumer integration, and TC-05 separately owned lifecycle closure.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: every TC names accept/reject behavior, exact evidence output, ancestry/cutover behavior, process exit state, or archived/closed lifecycle state.
- GATE-WRITE — No criterion uses banned vague phrases: none of `works correctly`, `no errors`, `implemented`, or `displays correctly` appears.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria: five Test Plan rows match the five TC criteria.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach: all five rows have both values and none contains TBD.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: N/A — zero rows use `manual`.
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` contains the paired PROC-029 unchecked path placeholder.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` was empty before this single first-run entry was appended.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: neither forbidden body section exists.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-01

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-01, this conversation
**Review fingerprint:** f2d7c1b8292e (review 4c077c8e, type/tags 42a75dd9)

- GATE-APPROVAL — ordering: prior GATE-WRITE PASS is recorded with 27 canonical criterion lines; frontmatter `status: review-ready` and the `.agents/spec-docs/backlog/` location match this gate's required input state.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-01, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the user wrote `승인함` immediately after the recommendation to bundle PROC-026, issue #2422 conversion and implementation, and the not-applicable semantic validation repair in one L2 prerequisite PR; this spec preserves those three separately owned roots and that one-PR boundary without adding scope.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT relies on the user's subject-bound approval of this spec, not on any delegated approval class or a claimed class boundary.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f2d7c1b8292e) equals the document's current fingerprint
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the spec extends the existing harness GATE-IMPLEMENT CLI and rule-owned internal contract/readers but introduces no independent package, app, product/presentation surface, or layer/product-family reclassification; the independent recommendation review nevertheless records `REVIEW VERDICT: ENDORSE` in the Decision.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-01

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-01; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 815 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md",
  "specPath": ".agents/spec-docs/todo/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md",
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
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md",
    ".agents/tasks/PROC-029-unify-gate-implement-continuation-producer-and-consumer-contracts.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
