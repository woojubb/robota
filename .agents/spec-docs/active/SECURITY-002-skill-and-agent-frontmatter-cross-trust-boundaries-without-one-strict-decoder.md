---
status: in-progress
type: SECURITY
tags: [security]
lane: L2
issue: https://github.com/woojubb/robota/issues/2082
---

# SECURITY-002: Skill and agent frontmatter cross trust boundaries without one strict decoder

Paired with `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md`. Arising from [issue #2082](https://github.com/woojubb/robota/issues/2082).

## Problem

Define one strict, owner-controlled decoder for skill and agent definition frontmatter before either
loader is migrated. The decoder must turn untrusted metadata into explicit typed variants or a
structured diagnostic; it must never cast a partial record, coerce a typo to a wider permission, or
silently ignore a malformed or unknown field.

`agent-framework` currently has two YAML-like frontmatter parsers. Both accept partial records;
the skill parser turns any non-`true` boolean spelling into `false`, while the agent parser uses
`parseInt` and skips malformed lines. These files are workspace/plugin contributions and therefore
untrusted input. This leaf defines the shared decoder before loader migrations #2094 and #2095.

## Prior Art Research

- Current duplication: [`skill-source.ts:6-67`](packages/agent-framework/src/commands/skill-source.ts)
  coerces booleans, accepts arbitrary strings, skips malformed lines, and casts;
  [`agent-definition-loader.ts:9-83`](packages/agent-framework/src/agents/agent-definition-loader.ts)
  duplicates parsing, uses `parseInt`, skips malformed lines, and casts.
- Correct decoder precedent: [`record-decoder.ts:85-127`](packages/agent-session/src/session-record-codec/record-decoder.ts)
  returns a discriminated outcome, validates closed keys, accumulates issues, and never returns
  partial values. Its diagnostic contract is separated into
  [`session-store-contracts.ts:13-19`](packages/agent-interface-session/src/session-store-contracts.ts).
- Strict scalar precedent: [`scalars.ts`](packages/agent-session/src/session-record-codec/scalars.ts)
  provides reusable typed primitives; [`verdict-decoder.ts:43-107`](packages/agent-core/src/hooks/verdict-decoder.ts)
  rejects non-exact booleans.
- Recommendation: keep runtime parsing in `agent-framework`, declare neutral output/diagnostic
  contracts in `agent-interface-command`, and reuse `TModelEffort` from `agent-core`.
- External reference: [YAML 1.2.2 specification](https://yaml.org/spec/1.2.2/) confirms that YAML
  scalar typing is broader than this deliberately narrow, line-oriented trust-boundary contract;
  therefore this decoder will validate its supported vocabulary explicitly rather than delegate
  security decisions to implicit YAML coercion.

## Architecture Review

### Affected Scope

- `agent-core`
- `agent-interface-command`
- `agent-framework`

### Alternatives Considered

1. Keep two private parsers. Pro: no new public surface. Con: preserves divergent coercion.
2. Put the runtime decoder in `agent-core`. Pro: central runtime location. Con: pulls skill/agent
   metadata into neutral core and reverses ownership.
3. Add one strict decoder in `agent-framework` with contracts in `agent-interface-command`.
   Pro: shared owner, lowest reachable contract layer, and existing strict-decoder precedent.
   Con: adds a public contract that later loader migrations must map explicitly.

### Decision

Choose alternative 3. Add `decodeSkillAgentFrontmatter(content, { kind, source })` in
`agent-framework`, returning `{ status: 'valid', value } | { status: 'invalid', diagnostics }`.
`kind` is the required explicit `'skill' | 'agent'` dialect discriminator; it is never inferred from
optional keys. `value` is a closed discriminated union and never an `ICommand` or `IAgentDefinition`;
callers map it when their migration lands. Diagnostics contain source, line, field, stable code, and
message. Unknown keys, malformed lines, duplicate keys, empty values, wrong shapes, and invalid
scalar vocabularies are invalid. The decoder accumulates all diagnostics and never returns a partial
value.

Reachability: both current loaders live in `agent-framework`, while the contract package is already
the lowest command contract layer and can depend on `agent-core` for `TModelEffort`. Capability
preservation: all current skill and agent keys are represented in their respective closed variants;
loader fallback names and bodies remain migration-owned. Adversarial cases are exact boolean parsing,
strict integer parsing, unknown-key rejection, duplicate-key rejection, and malformed-line handling.

### Placement and Family Classification

The new contract is classified as part of the existing `agent-interface-command` product family:
Layer 0, type-only command/capability contracts. Its closest structural analog is the existing
`ISessionRecordDecodeIssue` contract in `agent-interface-session`: both are neutral, located failure
vocabularies emitted by a runtime decoder, separated from the mechanism that performs decoding.
The new frontmatter types mirror that contract shape while remaining in the command family because
skills are command metadata and the existing loaders are command infrastructure.

This is an extension of an existing interface surface, not a new package or product. It reuses the
shared-core contract `TModelEffort` from `agent-core` and does not depend on a sibling product or
presentation surface. Runtime parsing stays in `agent-framework`, the existing common owner of the
skill and agent loaders. The rejected placement alternatives were a new standalone metadata package
(unnecessary boundary and new family) and `agent-core` (wrong ownership and upward product concern).

### Contract compatibility and boundary decisions

The decoder deliberately rejects arbitrary effort strings and returns only `TModelEffort`. This is a
strict-trust-boundary compatibility break from the current permissive `ICommand.effort?: string` and
is intentional; it prevents an unowned value from crossing the decoded boundary. #2094 owns the
follow-up mapping and any separately approved command-contract narrowing. This leaf adds no cast,
alias, or fallback to preserve the old string.

The decoder's accepted input is a complete frontmatter block for the explicitly supplied kind. No
opening marker, an unterminated block, an empty block, or a closing marker before any field is
`invalid` with a document/block diagnostic. A valid block may have zero fields only if the kind's
future contract explicitly permits it; this leaf's skill and agent contracts require `name` and
`description`, so it is invalid when either is absent. Text after the closing marker is outside this
metadata decoder and is not interpreted or returned; body extraction remains loader-owned.

### Field mapping preserved for future migrations

| Decoded field                                                                                                                                 | Future consumer mapping                                             | Owner       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- |
| skill `name`, `description`, `argumentHint`, `disableModelInvocation`, `userInvocable`, `allowedTools`, `model`, `effort`, `context`, `agent` | `ICommand` skill metadata, with effort narrowing handled explicitly | #2094       |
| agent `name`, `description`, `model`, `maxTurns`, `tools`, `disallowedTools`                                                                  | `IAgentDefinition` fields                                           | #2095       |
| source/line/field diagnostic coordinates                                                                                                      | loader-specific error projection                                    | #2094/#2095 |

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing session record decoder and hook decoder reviewed
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface/extension placement reviewed: existing `agent-interface-command` contract family;
      closest analog and family classification are recorded above.
- [x] Independent proposal review completed; findings on explicit kind, effort compatibility, and
      frontmatter boundaries are resolved in the contract decisions above.

## Fallback & Degradation Declaration

None

## Solution

1. Add closed frontmatter output and diagnostic types to
   `packages/agent-interface-command/src/frontmatter-contracts.ts` and export them from its index.
2. Add shared strict scalar/list/positive-integer parsing and the skill/agent decoder to
   `packages/agent-framework/src/metadata/frontmatter-decoder.ts`; export only the new decoder and
   types from the framework root.
3. Add direct table tests for valid variants, every invalid class, exact coordinates, accumulated
   diagnostics, and no partial value.
4. Update both governing SPEC documents without migrating either loader.

## Affected Files

- `packages/agent-interface-command/src/frontmatter-contracts.ts`
- `packages/agent-interface-command/src/index.ts`
- `packages/agent-framework/src/metadata/frontmatter-decoder.ts`
- `packages/agent-framework/src/index.ts`
- `packages/agent-interface-command/docs/SPEC.md`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-interface-command/src/__tests__/contracts.test.ts`
- `packages/agent-framework/src/metadata/frontmatter-decoder.test.ts`

## Completion Criteria

- [ ] TC-01: valid minimal and complete skill/agent variants decode into typed values; invalid
      variants decode to non-empty diagnostics and no value.
- [ ] TC-02: the caller-supplied `kind` selects exactly one closed dialect; ambiguous content is
      never inferred as either variant.
- [ ] TC-03: boolean, list, positive-integer, context, model, effort, wrong-shape, malformed-line,
      duplicate-key, empty-value, and unknown-key cases identify source/line/field exactly.
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-interface-command typecheck` and
      `pnpm --filter @robota-sdk/agent-framework build test typecheck lint` pass.
- [ ] TC-05: affected scans pass and a regression test proves the malformed disabling flag cannot
      decode to `false`; the test is demonstrated RED against the unfixed behavior.
- [ ] TC-06: existing loaders and discovery behavior are unchanged; #2094 and #2095 remain the
      migration owners.

## Test Plan

| TC-ID | Test Type        | Tool / Approach                                                     | Notes                                                |
| ----- | ---------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| TC-01 | Unit             | `packages/agent-framework/src/metadata/frontmatter-decoder.test.ts` | valid/invalid outcomes                               |
| TC-02 | Unit             | same test file                                                      | explicit dialect discrimination                      |
| TC-03 | Table            | same test file                                                      | exact source/line/field diagnostics and accumulation |
| TC-04 | Package          | package build/typecheck/test/lint commands                          | contract and implementation compile                  |
| TC-05 | Scan             | `node scripts/harness/run-all-scans.mjs --affected --context pr`    | affected regression set                              |
| TC-06 | Characterization | existing loader tests                                               | no migration or behavior change                      |

## User Execution Test Scenarios

Not applicable: this leaf exposes a library decoder but intentionally does not connect a production
loader. User-execution evidence belongs to #2094 and #2095.

## Tasks

- [ ] `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md` — todo

## Evidence Log

- 2026-08-29: Issue #2082 read in full; one cause and one independently verifiable Task.
- 2026-08-29: Existing loaders, `TModelEffort` ownership, and strict decoder precedents inspected.
- 2026-08-29: Independent proposal review endorsed placement but found three actionable design gaps:
  missing explicit kind, effort narrowing not reconciled, and unspecified frontmatter boundaries.
- 2026-08-29: Resolved all three in the contract decisions and field-mapping table above; approval
  fingerprint must be refreshed before implementation.
- 2026-08-29: Independent `proposal-reviewer` re-review verified the updated code premises,
  placement, explicit kind discriminator, effort compatibility decision, and boundary semantics;
  `ACTIONABLE FINDINGS: 0`, `REVIEW VERDICT: ENDORSE`.

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Ordering:** PASS — GATE-WRITE is the entry gate and has no predecessor.

**Semantic criteria:**

- Concrete symptom: PASS — the Problem names the two affected parsers and their incorrect coercion,
  partial-record, and malformed-line behavior.
- Reproduction condition: PASS — the Problem scopes the behavior to skill/agent frontmatter loaded
  from workspace/plugin contributions through the current `agent-framework` loaders.
- Research feeds Alternatives/Decision: PASS — the YAML specification and existing decoder precedents
  are used to justify explicit vocabulary validation, shared diagnostics, and the selected placement.
- Decision trade-off: PASS — the Decision explicitly weighs a new public contract against preserving
  divergent private parsers and avoiding ownership reversal into `agent-core`.
- New-surface placement: FAIL — the Solution introduces a new public contract surface in
  `agent-interface-command`, but the Architecture Review Checklist declares this condition `N/A`.
  The catalogue requires naming the analogous existing layer and its product-family classification and
  demonstrating shared contract/core reuse rather than a sibling-product dependency.
- Completion criteria coverage: PASS — TC-01 through TC-05 cover the distinct decoder, diagnostics,
  verification, regression, and compatibility/migration concerns.
- Completion criterion form: PASS — the criteria use typed outcomes, diagnostic observations, commands,
  scan results, or explicit ownership/compatibility observations.

**Verdict reason:** GATE-WRITE semantic criterion `New-surface placement (conditional)` is unmet.

- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [GATE-WRITE semantic review]
  **Required action:** a first GATE-WRITE run expects an empty log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status remains:** draft (semantic criteria judged after documented placement correction)

- Concrete symptom: PASS — the Problem identifies the two duplicated frontmatter parsers and their specific unsafe behaviors: boolean coercion, partial-record casts, and silently skipped malformed lines.
- Reproduction condition: PASS — the condition is bounded to untrusted workspace/plugin skill and agent frontmatter processed by the `agent-framework` loaders.
- Prior-art research feeds the decision: PASS — the YAML 1.2.2 specification supports the need for explicit scalar vocabulary validation, and the existing strict decoder precedents support discriminated outcomes, diagnostics, and rejection of partial values; these findings are carried into the Alternatives and Decision sections.
- Decision trade-off: PASS — the selected shared decoder/public-contract design explicitly trades a new contract surface and later loader mapping work against eliminating divergent private-parser behavior, while rejecting ownership reversal into `agent-core`.
- New-surface placement: PASS — the correction names `agent-interface-session`'s `ISessionRecordDecodeIssue` as the analogous Layer 0 type-only contract, classifies the target as the existing `agent-interface-command` product family, keeps runtime parsing in the common `agent-framework` owner, reuses shared-core `TModelEffort`, and records why a sibling product or standalone package is not used.
- Completion-criteria coverage: PASS — TC-01 through TC-05 cover valid/invalid decoding, diagnostics, package verification, regression protection, and unchanged-loader/migration ownership behavior.
- Completion-criterion form: PASS — each criterion is expressed as an observable decode result, diagnostic property, command outcome, scan result, or explicit compatibility/ownership condition.

**Verdict reason:** all requested GATE-WRITE semantic criteria are satisfied after the documented placement correction.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잠재적으로 모두 사전 승인함"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** 9629610f4fd6 (review 9890c6b6, type/tags 28193824)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9629610f4fd6) equals the document's current fingerprint

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-29

**Status remains:** review-ready
**Ordering:** PASS — the preceding GATE-WRITE entry is present and passed.
**Failed criteria:**

- Direct user approval: FAIL — the recorded instruction `"잠재적으로 모두 사전 승인함"` is hedged and does not unambiguously confirm this document's design or authorize implementation. It also does not name a registered delegated approval class, so it cannot be evaluated through Route CLASS.
- Class boundary: FAIL for Route CLASS — the instruction names no class, and the registry contains no class that can be inferred from it. Route CLASS therefore cannot establish approval for this L2 SECURITY item.
- Independent architecture validation (conditional): FAIL — this spec introduces a new public contract surface in the existing `agent-interface-command` product family, but the Evidence Log contains no independent `proposal-reviewer` verdict that endorses the recommendation and explicitly covers placement, nor an `architecture-audit-fanout` structure-channel result retained as additional placement evidence.

**Verdict reason:** GATE-APPROVAL requires an explicit direct approval or a named, pre-registered class, and independently recorded architecture-placement validation for this new surface. The current evidence satisfies neither route and lacks the required independent placement verdict.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "지금부터 너가 다시 이 것을 근거를 측정하고 검토하고 추가해서 진행해라"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** 018e9fe7c4dc (review 8debb2f2, type/tags 28193824)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (018e9fe7c4dc) equals the document's current fingerprint

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "지금부터 너가 다시 이 것을 근거를 측정하고 검토하고 추가해서 진행해라"
**Given:** 2026-08-29, this conversation
**Independent review evidence:** the latest direct `proposal-reviewer` review endorses the recommendation, explicitly covers placement, and reports `ACTIONABLE FINDINGS: 0` with `REVIEW VERDICT: ENDORSE`.

- Direct approval is unambiguous in context: the user explicitly directed continuation of the reviewed SECURITY-002 document after the prior gate failure.
- The preceding `GATE-WRITE` entry is PASS and the document remains `review-ready`, satisfying ordering.
- The new public contract placement is independently endorsed: `agent-interface-command` is confirmed as the existing Layer 0 command-contract family; runtime parsing remains in `agent-framework`; `TModelEffort` reuse and dependency direction are endorsed.
- The approval fingerprint remains valid: no Architecture Review or frontmatter `type`/`tags` change occurred after the recorded approval fingerprint.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: user directed continuation after the measured review of SECURITY-002.
- GATE-APPROVAL — The item is inside the approval route: DIRECT route was recorded; no delegated class is claimed.
- GATE-APPROVAL — Independent architecture validation: the latest `proposal-reviewer` review recorded `ACTIONABLE FINDINGS: 0` and `REVIEW VERDICT: ENDORSE`, including placement.

**GATE VERDICT: PASS**

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/6 TC ids and carries 5 checkbox task(s)
  **Required action:** one task per TC-N

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 492 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md",
  "specPath": ".agents/spec-docs/todo/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md",
    ".agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
