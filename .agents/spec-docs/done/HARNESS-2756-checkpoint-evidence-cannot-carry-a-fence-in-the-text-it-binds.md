---
status: done
type: RULE
tags: [harness]
lane: L1
---

# HARNESS-2756: Checkpoint evidence cannot carry a fence in the text it binds

Paired with `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`. Arising from [issue #2756](https://github.com/woojubb/robota/issues/2756).

## Problem

A checkpoint payload binds the authored scenario text VERBATIM, and a scenario may legally name a
code fence. SCREEN-2002's Scenario 1 prerequisites say the fixture reply contains a fenced TS code
block, written with three backticks.

The break is NOT that the writer cannot emit such a record — measured, it can: the run sits mid-line
inside a JSON string, so under CommonMark it cannot close a fence, and the pre-fix writer emitted a
valid three-backtick record that the pre-fix reader read straight back. The break is the round trip
through this repository's OWN formatter. `prettier --parser markdown` widens the delimiter to four
backticks whenever the fenced content carries a three-backtick run, and the pre-fix reader then
refused what the formatter had just written: `evidence must contain one json fence`. Every record in
this repository passes through Prettier, so the widened form is the only form that survives commit.

The effect is not cosmetic. SCREEN-2002's three work units are merged to `origin/develop`, but its
record could not be reconciled in ANY commit shape, because every shape that touches the spec/Task
pair re-validates that block. The item's record therefore stayed `in-progress` while fifteen merged
commits cited it, which is the SCREEN-2002 half of the `task-merged-citation` red on develop.

## Decision

Choose the delimiter instead of assuming it, exactly as CommonMark defines a fence: at least three
backticks, closed by a run at least as long. The writer emits one backtick more than the longest run
its own payload carries; both readers — the payload reader and the contract-region reader — accept
any run of three or more with a matching close.

Alternatives rejected: escaping the payload (changes what the record says it binds); forbidding a
fence in scenario text (the scenario describes a real product behaviour and the text is the contract);
stripping the inner fence when writing (the binding would no longer be verbatim, which is the one
property the block exists to have).

This widens the DELIMITER only. What the payload must contain, and that it must bind the authored
fields exactly, is unchanged.

## Prior Art Research

Waived: the question is not what other products do but what the CommonMark specification already
says, and it says it exactly — an opening code fence is "a sequence of at least three consecutive
backtick characters", and the closing fence "must be at least as long as the opening fence"
(CommonMark 0.31.2 § 4.5, Fenced code blocks). Prettier implements that rule, which is why it widened
the delimiter here and why the reader then refused what Prettier had just written. This change adopts
the same rule rather than inventing one, so there is no product landscape to survey.

## Architecture Review

### Decision

Choose the delimiter instead of assuming it, exactly as CommonMark defines a fence: at least three
backticks, closed by a run at least as long. The writer emits one backtick more than the longest run
its own payload carries; both readers accept any run of three or more with a matching close. This
widens the DELIMITER only — what the payload must contain, and that it must bind the authored fields
exactly, is unchanged.

**Delivery mode:** `single`

### Alternatives Considered

1. **Widen the delimiter to whatever the payload needs (chosen).** Pro: adopts the rule Prettier and
   every Markdown reader already apply, so the record round trips through the tools that touch it;
   the binding stays verbatim. Con: records written before and after differ in delimiter width, so
   the reader must accept both — which it now does, and a test pins it.
2. **Escape the payload (base64, or backslash-escaping the inner fence).** Pro: a fixed three-backtick
   delimiter for every record. Con: the block stops being readable by a human at review time, and the
   binding is no longer the authored text but a transformation of it — the one property the block
   exists to have.
3. **Forbid a code fence in scenario text.** Pro: no reader change at all. Con: it refuses the
   scenario for describing the product accurately — SCREEN-2002's fixture reply really does contain a
   fenced code block, and that is why the scenario names one.

### Architecture Review Checklist

- [x] Placement: the change lives in the module that owns the record's encoding, `checkpoint-evidence-contract.mjs`, and touches no gate, scan registry or lane refuser.
- [x] Contract impact: the payload's REQUIRED fields and binding rules are untouched; only the delimiter around them changes, so no consumer's expectations move.
- [x] Sibling scan: `git grep -n '```json' scripts/harness/*.mjs` finds a SECOND production site with the byte-identical regex — `user-execution-plan-contract.mjs` reading the `user-execution-plan-contract:v1` region. Its JSON carries no backticks today so Prettier has never widened it, but two readers of the same shape must not disagree tomorrow: it is routed through the same `fencedPayload` helper in this change rather than left named-and-deferred.
- [x] Backward compatibility: every record already committed uses three backticks and still reads, which TC-01's second case pins.

## Affected Scope

- `scripts/harness/checkpoint-evidence-contract.mjs` — the writer and both readers.
- `scripts/harness/user-execution-plan-contract.mjs` — the sibling reader of the same shape.
- `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` — the regression guard.

## Completion Criteria

- [x] TC-01: the delimiter is chosen, not assumed — a payload whose text contains a three-backtick fence round trips through `formatCheckpointEvidence` and `parseCheckpointEvidence` with a four-backtick delimiter, and a payload with no fence still writes and reads a plain three-backtick record so nothing already committed is orphaned.
- [x] TC-02: engineering verification — the harness contract tier passes, and `pnpm harness:scan` reports no finding this change introduces; `task-merged-citation`'s SCREEN-2002 red is pre-existing and is the very subject of issue #2756, so it is measured and named rather than counted against this change.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                               | Notes                          |
| ----- | ------------------------ | ----------------------------------------------------------------------------- | ------------------------------ |
| TC-01 | Unit                     | Vitest over `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` | Round trip on a real record    |
| TC-02 | Engineering verification | `node scripts/harness/harness-test-tiers.mjs --tier contracts`                | No test file — skipped by kind |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable.

**Reason:** this changes a harness record ENCODING only. Nothing a user types, sees or runs at a product surface
changes — `robota` behaves identically before and after, and the only observable is whether a
checkpoint record can be written and read back, which is a repository-internal contract between the
gate writer and the scan that reads it.

## Tasks

- [x] `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** todo → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "남은 것도 다 진행하세요. 닫기 위해 뭐든해야합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 884c183b5593 (review e3b0c442, type/tags 0ddcee9f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (884c183b5593) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b3a376808636` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `e04fd6e2acd4` (untracked)

### [GATE-PLAN] — ❌ FAIL | 2026-09-20

**Status remains:** todo
**Failed criteria:**

- GATE-WRITE — `status: draft` present in frontmatter: `status: todo`, required `status: draft`
  **Required action:** set `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: HARNESS` is not one of SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY
  **Required action:** set `type:` to one of the listed values
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: no `## Prior Art Research` (or `## Research`) section
  **Required action:** add the section
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : missing "## Prior Art Research" section (research.md is default-on; add the section or an explicit "Waived: <reason>").
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : missing "## Prior Art Research" section (research.md is default-on; add the section or an explicit "Waived: <reason>").
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — All 4 checklist items are `[x]`: no `### Architecture Review Checklist` under `## Architecture Review`
  **Required action:** add the checklist
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"
  **Required action:** add the Sibling scan item
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: no `### Alternatives Considered` under `## Architecture Review`
  **Required action:** add the alternatives
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: not-applicable PLAN reason is invalid: expected exactly one visible **Reason:** field
  **Required action:** record one visible substantive **Reason:** field

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b3a376808636` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `a439e5bac671` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "남은 것도 다 진행하세요. 닫기 위해 뭐든해야합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** e0b859d6e8ae (review ab090f92, type/tags b11e00f1)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e0b859d6e8ae) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b3a376808636` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `94f675c2a2f8` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 917 chars, 7 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 3 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e0b859d6e8ae) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b3a376808636` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `1cea520303f7` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "남은 것도 다 진행하세요. 닫기 위해 뭐든해야합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 732df4052d6f (review 28d20f6a, type/tags b11e00f1)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (732df4052d6f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `ac294dc7feb2` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `8774fbd36b46` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (2)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 555 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md",
  "specPath": ".agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md",
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
    ".agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md",
    ".agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b3a376808636` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `858f805b2d3c` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-20

**Command:** `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
9:22:41 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs (22 tests) 21ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  21:22:41
   Duration  525ms (transform 77ms, setup 0ms, collect 98ms, tests 21ms, environment 0ms, prepare 91ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa64fefee1a7` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/active/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `7cf0b30b7234` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-20

**Command:** `node scripts/harness/harness-test-tiers.mjs --tier contracts`
**Exit:** 0
**Output:** (last 10 of 189 line(s))

```
 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

···········································································································································································································································································

 Test Files  1 passed (1)
      Tests  267 passed (267)
   Start at  21:31:58
   Duration  211.55s (transform 117ms, setup 0ms, collect 152ms, tests 211.27s, environment 0ms, prepare 25ms)

9:31:58 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa64fefee1a7` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/active/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `486c226e1be1` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-20

**Status remains:** in-progress
**Ordering check:** PASS — prior gate `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-20` is the last GATE-IMPLEMENT entry in this log, and the document's `status: in-progress` sits in `.agents/spec-docs/active/`, the folder that status maps to (spec-workflow.md § Spec-Document Status and Lifecycle Folders). No step was skipped.
**Failed criteria:**

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) (`task-plan-items`): both Plan items are `[x]`, but the criterion's own named mechanical owner refuses this Plan section. `node scripts/harness/scan-task-plan-items.mjs` exits 1 over 327 Task Plan sections with exactly one finding, on this item: `[plan-names-own-disposition] .agents/tasks/HARNESS-2756-…md: Plan item "TC-02: engineering verification — the harness contract tier, and \`pnpm harness:s" names the disposition of the work (merge/land/close/publish) … move it out of `## Plan` (issue #2375)`. The detector (`scan-task-plan-items.mjs`§ DISPOSITION regex) matches the TC-02 item's`task-merged-citation`…`this issue's own subject`pairing —`merged`followed by`issue`inside one item. Per this catalogue's § GATE-VERIFY note, a Plan item that names its own disposition cannot be`[x]`before this gate, so the criterion is unsatisfiable as the item is worded, false positive or not.
**Required action:** reword the TC-02 Plan item (or move it out of`## Plan`) so `scan-task-plan-items.mjs` exits 0, then re-run GATE-VERIFY.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`) — judged via `pnpm harness:scan`, the shape this criterion accepts for a `scripts/**`-only change with no package build: exit 1, `2 of 162 scans failed`. One is inherited and named: `task-merged-citation` on SCREEN-2002 (verified independently — at `origin/develop@4e1597e8bf01` that Task already reads `status: in-progress`, `a555afe80` is an ancestor of `origin/develop`, and this branch's diff touches no SCREEN-2002 path). The second is NOT inherited: `task-plan-items` fails on this item's own Task file, introduced by the Plan rewording made during this gate run — an earlier full `pnpm harness:scan` over this same tree, before that edit, failed on `task-merged-citation` alone (`1 of 162`).
  **Required action:** clear the `task-plan-items` finding this change introduced; the SCREEN-2002 red is pre-existing and stays named, not cleared here.

**Criteria observed as met (recorded so none is silently skipped):**

- GATE-VERIFY — No Plan item is blocked or pending: 2 Plan items, both `[x]`, neither carries `blocked` or `pending`; no item defers work to a later run.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): the diff touches no `packages/**` or `apps/**` source, so the affected scope is `scripts/harness/**`. Measured on the content hashed below: `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` → 23/23 passed; `node scripts/harness/harness-test-tiers.mjs --tier contracts` → exit 0 (268 files, 5065 tests, plus four single-file sub-runs).

**Independent regression proof (requested; no earlier run cited):** `scripts/harness/checkpoint-evidence-contract.mjs` was extracted at `origin/develop@4e1597e8bf01` into a scratchpad and driven with the new case's own data (the `doneGateStageOne` contract from `.agents/rules/backlog-execution.md`, the real FLOW-2006 record, first scenario's prerequisite extended with a three-backtick run). Pre-fix: the writer emits a three-backtick delimiter, so `expect(formatted.text).toContain('````json')` fails — the new case does NOT pass against pre-fix code, and is not an accidental green. Pre-fix also refuses a Prettier-widened four-backtick record (`doneGateStageOne evidence must contain one json fence`) where the current module reads it back verbatim. Separately measured and worth recording: the emitted record is not byte-stable under `prettier --parser markdown` — Prettier inserts a blank line after the HTML marker (reproduced both inside and outside vitest, prettier 3.9.6) — and the test as it now stands asserts only that the DELIMITER survives, which is true.

**Binding-strength check:** the diff (commit `fa64fefee1a7` plus the uncommitted working-tree changes) alters fence selection and fence reading only — `validatePayload`, the payload's required-field list and the exactness of the field binding are untouched; the sibling `user-execution-plan-contract.mjs` now reads through the same `fencedPayload` helper rather than its own hardcoded regex.

**Tree note:** the delivery and both records were edited while this gate was being judged (module 22:02:29, sibling 22:02:37, spec/Task 22:03:07, test 22:03:45). Every measurement above was re-run after the last of those edits and binds the content hashed below, which was unchanged from 22:03:45 through the recording of this entry.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `fa64fefee1a7` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/active/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `52f06f06a7d4` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-20

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-20` is the last GATE-IMPLEMENT entry in this log, and `status: in-progress` sits in `.agents/spec-docs/active/`, the folder that status maps to. The `[GATE-VERIFY] — ❌ FAIL` entry above is this gate's own earlier run, which the last-entry rule applies to the PRIOR gate, not to this one.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) (`task-plan-items`): 2 Plan items, both `[x]`; `node scripts/harness/scan-task-plan-items.mjs` now exits 0 over 327 Task Plan sections (`task-plan-items scan passed.`). The `plan-names-own-disposition` finding that failed this criterion earlier is cleared by rewording TC-02 to "the harness contract tier and the full scan, with every finding attributed" — verified as a real fix, not a suppression: `git diff 4e1597e8b..2962c8b92 --name-only` touches no `*-baseline.json`, so no exemption was added to the scan.
- GATE-VERIFY — No Plan item is blocked or pending: neither item carries `blocked` or `pending`, and neither defers its own work; both substantive claims re-measured below.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no package build applies — the diff touches only `scripts/harness/**`, and no `packages/**` or `apps/**` source references `checkpoint-evidence-contract` / `user-execution-plan-contract`. Judged instead by the shape this criterion accepts for a `scripts/**`-only change: `pnpm harness:scan` → exit 1, `1 of 162 scans failed`, `task-merged-citation` alone, on SCREEN-2002 — inherited, re-confirmed independently (`git show origin/develop:.agents/tasks/SCREEN-2002-…md` already reads `status: in-progress`, `a555afe80` is an ancestor of `origin/develop`, and this branch's diff touches no SCREEN-2002 path). Nothing this change introduces fails: `pnpm harness:scan --skip task-merged-citation` → exit 0, `160 scans passed, 1 skipped`.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` → 23/23 passed; `node scripts/harness/harness-test-tiers.mjs --tier contracts` → exit 0, 268 files / 5066 tests.

**Independent regression proof (re-run for this verdict; no earlier run cited):** `checkpoint-evidence-contract.mjs` extracted at `origin/develop@4e1597e8bf01` and driven with the new case's own data. Pre-fix emits a three-backtick delimiter, so `expect(formatted.text).toContain('````json')` fails there — the new case is not an accidental green; pre-fix also refuses a Prettier-widened four-backtick record (`doneGateStageOne evidence must contain one json fence`) that the current module reads back verbatim. The corrected cause now recorded in `## Problem` matches what I measured: the pre-fix writer COULD emit such a record and read its own output back, and the break is the Prettier round trip.

**Binding-strength check:** `validatePayload`, the payload's required-field list and the exactness of the field binding are untouched across `4e1597e8b..2962c8b92` and the working tree; only fence selection and fence reading changed. The sibling reader `scripts/harness/user-execution-plan-contract.mjs` now shares the same helper and still parses the declared PLAN contract (`parseUserExecutionPlanContract(.agents/rules/backlog-execution.md).ok === true`).

**Tree note:** this verdict is recorded at HEAD `2962c8b92ae1`, whose working tree carries three uncommitted harness files — `checkpoint-evidence-contract.mjs` blob `07f1d912ffe7`, `markdown-visibility.mjs` blob `c6a2f326ab8f`, `user-execution-plan-contract.mjs` blob `152e700542d8` (a 22:25 move of `fencedPayload` into the markdown-visibility module, landed after the commit). Every measurement above was re-run against that working-tree content, which was unchanged from 22:25:29 through the recording of this entry; the contracts tier and full scan were run twice, once at the commit and once on the working tree, with identical results.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `2962c8b92ae1` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/active/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `2ab29e6991f7` (tracked)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-20

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-20; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 2/2 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (2)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (2) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (2) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 2/2 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (2) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 2/2 tasks `[x]` in .agents/tasks/completed/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7bde89d9c9f0` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/active/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `410eee4c525c` (modified)
