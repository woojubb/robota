---
status: in-progress
type: RULE
tags: [harness]
lane: L1
---

# HARNESS-2756: Checkpoint evidence cannot carry a fence in the text it binds

Paired with `.agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`. Arising from [issue #2756](https://github.com/woojubb/robota/issues/2756).

## Problem

A checkpoint payload binds the authored scenario text VERBATIM, and a scenario may legally name a
code fence. SCREEN-2002's Scenario 1 prerequisites say the canned reply "contains a fenced TS code
block", written with three backticks. The payload is emitted inside a three-backtick `json` fence, so
that inner fence closes the outer one. `formatCheckpointEvidence` cannot write the record, and a
record Prettier has widened to four backticks is refused by `parseCheckpointEvidence` as "evidence
must contain one json fence".

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
- [x] Sibling scan: N/A: `git grep -n '```json' scripts/harness/*.mjs` finds the delimiter hardcoded only in this module's two readers and one writer, all three of which this change covers; no sibling module encodes a checkpoint record.
- [x] Backward compatibility: every record already committed uses three backticks and still reads, which TC-01's second case pins.

## Affected Scope

- `scripts/harness/checkpoint-evidence-contract.mjs` — the writer and both readers.
- `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` — the regression guard.

## Completion Criteria

- [ ] TC-01: the delimiter is chosen, not assumed — a payload whose text contains a three-backtick fence round trips through `formatCheckpointEvidence` and `parseCheckpointEvidence` with a four-backtick delimiter, and a payload with no fence still writes and reads a plain three-backtick record so nothing already committed is orphaned.
- [ ] TC-02: engineering verification — the harness contract tier passes and `pnpm harness:scan` exits 0.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                               | Notes                          |
| ----- | ------------------------ | ----------------------------------------------------------------------------- | ------------------------------ |
| TC-01 | Unit                     | Vitest over `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` | Round trip on a real record    |
| TC-02 | Engineering verification | `node scripts/harness/harness-test-tiers.mjs --tier contracts`                | No test file — skipped by kind |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this changes a harness record ENCODING only. Nothing a user types, sees or runs at a
product surface changes — `robota` behaves identically before and after, and the only observable is
whether a checkpoint record can be written and read back, which is a repository-internal contract
between the gate writer and the scan that reads it.

## Tasks

- [ ] `.agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` — todo

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
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, whose basename is the spec's
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
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md`, whose basename is the spec's
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
  "taskPath": ".agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md",
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
    ".agents/tasks/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b3a376808636` · base `origin/develop@4e1597e8bf01` · document `.agents/spec-docs/todo/HARNESS-2756-checkpoint-evidence-cannot-carry-a-fence-in-the-text-it-binds.md` blob `858f805b2d3c` (untracked)
