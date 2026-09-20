---
status: done
type: RULE
tags: [harness]
lane: L1
---

# HARNESS-2774: Re-bind a drifted DONE-GATE-STAGE-1 payload on a continuation checkpoint

Paired with `.agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md`. Arising from [issue #2774](https://github.com/woojubb/robota/issues/2774).

## Problem

A Task's `doneGateStageOne` payload binds the authored scenario text VERBATIM. That is the point of
the block: DONE-GATE-STAGE-1 judged a specific text, and the payload freezes which text it judged.

Nothing refuses an implementation commit that then amends that text. `scan-user-execution-plan-order`
reads the pair on a checkpoint and on an archive; between them, a commit may rewrite a scenario
freely — and the process explicitly expects it to, because executing a scenario is how its expected
observable is found to be wrong. SCREEN-2002 did exactly that in its third work unit: running the
scenario showed the line it exists to read reported a self-contradicting value, the defect was fixed,
and the expected observable was corrected to the fixed line.

From that moment the unit is sealed, and every route out is refused:

1. A continuation or correction checkpoint re-validates the binding, which now fails
   (`scan-user-execution-plan-order.mjs:556`).
2. Repairing the binding means editing the Task — and `isCheckpointTransition` requires
   `task === parentTask` in BOTH forms once the pair is `in-progress` (`:731`, `:746`).
3. A Task without its active spec is not a pair candidate (`plan-order-records.mjs:103`), so a
   Task-only repair classifies as implementation with no checkpoint ancestor.
4. The archive freezes `## User Execution Test Scenarios` byte-identical (`:2156`), so an
   `evidence: pending` left behind can never be filled, and `scan-unearned-done-claims.mjs:258`
   refuses a deferral placeholder in a `status: done` item.
5. Re-recording Stage 1 as a second entry is refused: `:527` requires exactly one.

Measured on SCREEN-2002, whose three work units are merged and independently verified: the payload
binds 5291 bytes against 5615 bytes now authored, diverging at offset 497. Its record cannot be closed
in any commit shape. That is the other half of the develop red tracked by issue #2756.

## Decision

Give the repair exactly one door, and make it exactly one Task wide.

A CONTINUATION checkpoint may carry one Task change and only one: re-recording the DONE-GATE-STAGE-1
entry so its payload binds the scenario text the Task already carries. Byte-identical outside that
entry, not binding before, binding after.

It rides the continuation form and not the correction form. The correction form reads like the door
for "this record was recorded wrongly", and it is not: `correctionEntryError` admits it only at index
1, after exactly one legacy v1 first PASS and no continuation — it is a legacy-v1 migration form. A
unit far enough into a sequenced delivery to have drifted past its own Stage-1 payload is already
past that point; SCREEN-2002 carries three PASS entries. Measured, not assumed: the first attempt at
this change was written for the correction form and the fixture refused it.

The restriction is mechanically checkable because the derivation is already mechanical
(`stageOneScenarioPayload`), so the door cannot be used to re-author a scenario: the text the payload
binds TO is outside the entry and must not move.

**What the door does NOT reach**, stated because it is narrower than the seal:
`validateV2GateImplementDelivery` (`checkpoint-evidence-contract-v2.mjs:27`) refuses BOTH the
continuation and the correction form unless the delivery is `sequenced`. A `single`-delivery unit
that drifts has neither form to ride and stays sealed exactly as § Problem describes. SCREEN-2002,
the unit this was measured on, is sequenced; the residual is recorded as
[issue #2774 comment 5750809102](https://github.com/woojubb/robota/issues/2774#issuecomment-5750809102)
rather than left as a pointer to nothing.

## Prior Art Research

Waived: the question is not what other products do but what this repository's own checkpoint forms
already admit, and only the source answers that. Reading it is what moved this change off the
correction form — `correctionEntryError` (`gate-implement-correction-validation.mjs:26`) admits that
form only at index 1, after exactly one legacy v1 first PASS and no continuation, which no drifted
unit can still satisfy. So the repair rides the continuation form, which a sequenced delivery is
already using. There is no external product landscape to survey.

## Architecture Review

### Decision

A continuation checkpoint may carry one Task change: re-recording the DONE-GATE-STAGE-1 entry so its
payload binds the scenario text the Task already carries. Byte-identical outside that entry, not
binding before, binding after. The correction form is untouched and stays byte-strict.

**Delivery mode:** `single`

### Alternatives Considered

1. **Admit the repair through the continuation form (chosen).** Pro: the form a sequenced delivery
   is already using, so the repair and the work that follows it fit in one PR; the permitted change
   is derivable, so it cannot smuggle a re-authored scenario. Con: the continuation's comment says
   "the Task has nothing to change", and that sentence now has one bounded exception.
2. **Admit it through the correction form.** Pro: "correction" is what a wrongly-recorded record
   sounds like, and `correctionClosureOnly` would force the repair to reach the base on its own.
   Con: REFUSED BY MEASUREMENT — `correctionEntryError` admits the form only at index 1, after
   exactly one legacy v1 first PASS and no continuation. It is a legacy-v1 migration form, and no
   drifted unit can still be at index 1. This was the first design; the fixture rejected it.
3. **Accept more than one DONE-GATE-STAGE-1 entry and bind the last.** Pro: a smaller diff. Con: it
   does not solve the problem — appending an entry is still a Task edit, which both checkpoint forms
   refuse, so the unit stays sealed. It also makes the gate's history ambiguous at review time.
4. **Stop freezing the scenarios section in the archive.** Pro: `evidence:` could be filled at
   archive time. Con: it removes the property the freeze exists for — that what was verified is what
   is archived — to work around a different defect.
5. **Re-validate the binding on implementation commits too, so drift is refused at the source.**
   Pro: the drift never happens. Con: it refuses the corrective edit that finding a wrong expected
   observable requires, which is the behaviour the scenario gate exists to produce. Worth doing as a
   warning, not as a refusal, and not in this change.

### Architecture Review Checklist

- [x] Placement: the change lives in the module that owns checkpoint classification, `scan-user-execution-plan-order.mjs`, and touches no gate, scan registry or lane refuser.
- [x] Contract impact: the payload's required fields, the derivation, and the binding rule are untouched. Only WHICH commit may carry an already-derivable payload changes.
- [x] Sibling scan: `git grep -n 'task === parentTask' scripts/harness/` finds both occurrences, and both are in this one function — there is no second classifier of the same shape to keep in step.
- [x] Backward compatibility: a continuation whose Task is unchanged is still accepted and a drifted one is still refused, both pinned by TC-01's fourth case; the correction arm is untouched.

## Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — `isCheckpointTransition` and the new `isStageOneRebind`.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — the regression guard.

## Completion Criteria

- [x] TC-01: the door is exactly one Task wide — a continuation whose ONLY Task change re-records the DONE-GATE-STAGE-1 entry so its payload binds the unchanged scenario text is accepted; a continuation that moves any Task byte outside that entry is refused; a Task rewrite whose payload already bound is refused, because a rebind repairs a drift or nothing; and the unchanged-Task continuation and the drifted refusal are both left exactly as they were.
- [x] TC-02: engineering verification — the harness contract tier passes, and `pnpm harness:scan` reports no finding this change introduces.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                | Notes                          |
| ----- | ------------------------ | -------------------------------------------------------------- | ------------------------------ |
| TC-01 | Unit                     | Vitest over `evaluatePlanTexts`                                | Seven cases; case 1 red before |
| TC-02 | Engineering verification | `node scripts/harness/harness-test-tiers.mjs --tier contracts` | No test file — skipped by kind |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable.

**Reason:** this changes which SHAPE of commit a repository scan accepts. Nothing a user types, sees
or runs at a product surface changes — `robota` behaves identically before and after, and the only
observable is whether a record-repair commit is accepted, which is a contract internal to this
repository between the gate writer and the scan that reads it.

## Tasks

- [x] `.agents/tasks/completed/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-2002 를 진행하지 못해서 닫지 못했다고 하는데 대체할 방법이라도 찾아서 그걸 어떻게든 닫아. 나는 #2670이슈를 닫아야 한다고 너에게 명령한다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** b763946311c0 (review cbb6741d, type/tags b11e00f1)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b763946311c0) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3813599f3db1` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `18b2d30a412d` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1929 chars, 18 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 5 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 2 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 2 Test Plan rows = 2 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 2 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b763946311c0) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3813599f3db1` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `55bfe1a5f9db` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (2)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 539 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md",
  "specPath": ".agents/spec-docs/todo/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md",
    ".agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `3813599f3db1` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/todo/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `6e084ee33637` (untracked)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-21

**Status remains:** in-progress
**Failed criteria:**

- Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): the paired
  Task at HEAD `dd22c8a23c37` carries `## Plan` with 0/2 items ticked — `- [ ] TC-01: a continuation
checkpoint may carry one Task change and only one …` and `- [x] TC-02: engineering verification — the
harness contract tier and the full scan …`. Required: every `## Plan` item `[x]`.
- No Plan item is blocked or pending: the same 2 items are untied, which the evaluator's own rule
  (`gate-operations.mjs` › `no-blocked`, `(box) => !box.checked || /\b(blocked|pending)\b/i`) counts as
  pending. No item carries a literal `blocked`/`pending` word; the unticked state alone is the finding.
- Build passes for all affected packages (`pnpm build`): the scope is `scripts/harness/**` only (no
  package build), so the catalogue's build-equivalent applies — `pnpm harness:scan` re-run here exits 1,
  `1 of 162 scans failed`, `task-merged-citation` alone, on `.agents/tasks/SCREEN-2002-…md`. Attributed,
  not introduced: `node scripts/harness/scan-task-merged-citation.mjs` produces the identical finding in
  a throwaway worktree at base `origin/develop@e040f298fe53`, and `git diff --name-only
origin/develop...dd22c8a23` is 4 paths, none of them a SCREEN-2002 or citation-scan path. Required by
  the criterion as written: a build-shaped command exiting 0.

**Required action:** complete and tick both `## Plan` items in the paired Task, then re-run this gate;
supply a build-shaped `--verify-cmd` that exits 0 (a root `pnpm build`, or `pnpm harness:scan` once the
inherited SCREEN-2002 `task-merged-citation` red is reconciled — which is the very red this unit's
delivery exists to make reconcilable).

**Criterion met:**

- Tests pass for all affected packages: `node scripts/harness/harness-test-tiers.mjs --tier contracts`
  → exit 0, 268 files / 5066 tests, plus the tier's five isolated runs (26, 222, 18, 55, 274 — the last
  is this scan's own file, run solo). Re-run here, not taken on report.

**Ordering check:** PASS — prior gate `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-20` is the last recorded
entry, and `status: in-progress` is the input state the catalogue's prior-gate map requires for
GATE-VERIFY (blank re-run rule, last-entry reading).

**Also verified, recorded because the record asserted it (not a GATE-VERIFY criterion):** the two
review-round fixes are real, each mutation-proved in a throwaway worktree at `dd22c8a23` — restoring the
literal `'\n### '` span search without the line/heading validation turns "refuses a rebind whose Stage-1
heading is indented" red and nothing else; dropping the suffix half of the outside-the-entry comparison
(`before[1] !== after[1]`) turns "refuses a rebind that rewrites a section AFTER the Stage-1 entry" red
and nothing else. The RED PROOF reproduces: `false && isStageOneRebind(…)` fails case 1 only (1 failed /
6 passed / 267 skipped). Issue #2774 comment 5750809102 exists and records the `sequenced`-only residual
the § Decision cites it for. Not re-probed: the end-to-end three-commit SCREEN-2002 reconciliation claim,
which no GATE-VERIFY criterion reads — it is GATE-COMPLETE's TC-01/TC-02 evidence and is not relied on here.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `dd22c8a23c37` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `7e262d415fb8` (tracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-21

**Command:** `npx vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t "Stage-1 rebind"`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:56:21 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs (274 tests | 267 skipped) 28ms

 Test Files  1 passed (1)
      Tests  7 passed | 267 skipped (274)
   Start at  00:56:21
   Duration  482ms (transform 140ms, setup 0ms, collect 215ms, tests 28ms, environment 0ms, prepare 38ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd22c8a23c37` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `c597dc1199f0` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-21

**Command:** `node scripts/harness/harness-test-tiers.mjs --tier contracts`
**Exit:** 0
**Output:** (last 10 of 190 line(s))

```

··················································································································································································································································································

 Test Files  1 passed (1)
      Tests  274 passed (274)
   Start at  01:00:52
   Duration  242.33s (transform 122ms, setup 0ms, collect 159ms, tests 242.02s, environment 0ms, prepare 28ms)

1:00:52 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
exit=0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd22c8a23c37` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `57181f5bcd22` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-21

**Status upgrade:** in-progress → verifying
**Re-run of:** `[GATE-VERIFY] — ❌ FAIL | 2026-09-21`, same HEAD `dd22c8a23c37`. Only the record moved:
`git diff HEAD --name-only -- scripts/` is 0 paths, so `scripts/harness/**` is byte-identical to the
commit the FAIL judged; the working-tree delta is the two Task `## Plan` ticks, the two spec
`## Completion Criteria` ticks, and the two `[GATE-COMPLETE: TC-N]` records (`git diff HEAD` over the
paired pair, read line by line — no prose, design or code byte moved).

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-20` is the last GATE-IMPLEMENT entry (blank re-run rule, last-entry reading), and frontmatter is `status: in-progress`, the input state the prior-gate map requires. The two intervening `[GATE-COMPLETE: TC-N]` entries are not an out-of-order gate: the L1 lane orders `gate.mjs record --tc` (step 8) BEFORE the DONE judgement (step 9) in `backlog-pipeline` SKILL, so they are this gate's prescribed inputs, not work it authorises.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): 2/2 `[x]` — `- [x] TC-01: a continuation checkpoint may carry one Task change and only one …` and `- [x] TC-02: engineering verification — the harness contract tier and the full scan …`. The `## Plan` section holds the Task's only two checkboxes (`grep -n '^\s*- \[.\]'` returns exactly those two lines); `scan-task-plan-items` passes in both scan runs below. This is the criterion the earlier FAIL was recorded on, at 0/2.
- GATE-VERIFY — No Plan item is blocked or pending: both boxes are ticked and neither box's text contains `blocked`/`pending`. The one `pending` token in the Task (`evidence: pending`, line 25) is `## Objective` prose describing the defect, not a checkbox item, so the evaluator's `no-blocked` rule (`gate-operations.mjs`, `(box) => !box.checked || /\b(blocked|pending)\b/i.test(box.text)`) does not reach it.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no package is affected — `git diff --name-only origin/develop...HEAD` is 4 paths (2 `.agents/` records, `scripts/harness/scan-user-execution-plan-order.mjs`, its `__tests__` file) and none is under `packages/` or `apps/`, so the build-equivalent for a `scripts/**`-only scope applies (`gate-operations.mjs` › VERIFY COMMAND SHAPE: `harness:scan`/`run-all-scans` stands in where there is no package build). Measured twice, both exit 0: (a) the lane's own declared build-shaped form, `node scripts/harness/run-all-scans.mjs --affected --context pr` (`backlog-pipeline` SKILL step 9) → `61 scans passed, 1 skipped, 1 advisory failure(s) tolerated (pr context) … (63 declared what they examined)`, exit 0 — the skip is the self-skipping `new-rule-declares-enforcement`; (b) the complement, `pnpm harness:scan --skip task-merged-citation` → `160 scans passed, 1 skipped (161 declared what they examined)`, exit 0. Run (a) did not hide the red: it RAN `task-merged-citation`, which failed, and the runner tolerated it because the repository registers that scan `advisory: true` for exactly this question — `run-all-scans.mjs:1141-1149`, "advisory under `pr` because the history it grades is moved by OTHER pull requests, not by the change under review". Re-run alone, `node scripts/harness/scan-task-merged-citation.mjs` reports one finding, `.agents/tasks/SCREEN-2002-…md` (15 merged commits cite an `in-progress` record), on a path this change does not touch.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `node scripts/harness/harness-test-tiers.mjs --tier contracts` re-run here at this tree state → exit 0, `Test Files 268 passed (268)`, plus the tier's five isolated runs (26, 222, 18, 55, and 274 — this scan's own file, solo). Not taken on report.

**Residual, recorded because this PASS does not clear it:** the strict full scan
(`pnpm harness:scan`, `--context integration`) still exits 1 on this branch, `task-merged-citation`
alone, and it exits 1 identically at base `origin/develop@e040f298fe53` — an inherited red, the
SCREEN-2002 half of issue #2756. This change makes that record repairable; it does not repair it. A
later gate that needs a green integration scan must not read this entry as one.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `dd22c8a23c37` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `ba7ba654d098` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-21

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-21; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 2/2 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (2)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (2) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (2) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 2/2 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (2) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 2/2 tasks `[x]` in .agents/tasks/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `dd22c8a23c37` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/HARNESS-2774-re-bind-a-drifted-done-gate-stage-1-payload-on-a-continuation-checkpoint.md` blob `45aec33dea63` (modified)
