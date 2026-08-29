---
status: approved
type: SECURITY
tags: [security]
lane: L1
---

# SECURITY-002: Skill and agent frontmatter cross trust boundaries without one strict decoder

Paired with `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md`. Arising from [issue #2082](https://github.com/woojubb/robota/issues/2082).

## Problem

Define one strict, owner-controlled decoder for skill and agent definition frontmatter before either
loader is migrated. The decoder must turn untrusted metadata into explicit typed variants or a
structured diagnostic; it must never cast a partial record, coerce a typo to a wider permission, or
silently ignore a malformed or unknown field.

Today `skill-source.ts` turns `disable-model-invocation: treu` into `false`, accepts arbitrary
`context` and `effort` strings, and ignores malformed or unknown lines. The separate parser in
`agent-definition-loader.ts` accepts numeric prefixes through `parseInt`, can produce `NaN`, and also
casts a partial record. Bundle plugin skill parsing is a third permissive implementation. Workspace
and plugin-contributed files therefore cross a trust boundary without one fail-closed contract.

## Prior Art Research

Waived: this is an internal trust-boundary primitive with no public surface; the governing evidence is
the repository's three current parsers, actual checked-in skill/agent metadata inventory, existing
`TModelEffort` owner, and the reviewed issue boundaries rather than an external product precedent.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/frontmatter/` — new private decoder subsystem and direct tests.
- `packages/agent-framework/package.json` and `pnpm-lock.yaml` — direct `yaml` runtime dependency.
- `packages/agent-framework/docs/design/frontmatter-decoder.md` — internal realization and ownership.
- `packages/agent-core` — existing `TModelEffort` type owner, imported but not modified.
- Existing skill/plugin and agent loaders — explicitly surveyed and intentionally not modified.

### Alternatives Considered

1. Tighten each handwritten loader parser separately.
   - Pro: no new dependency and each change is local to its current caller.
   - Con: preserves three trust-boundary implementations, duplicates coercion and diagnostics, and
     lets their accepted vocabularies drift again.
2. Add one private `agent-framework` decoder using a validated YAML document/AST parser and explicit
   caller-selected closed profiles.
   - Pro: one fail-closed owner, real YAML syntax and coordinates, shared primitives, no dependency
     reversal, and no public API or loader behavior change in this leaf.
   - Con: adds one direct runtime dependency and requires deliberately separate profile schemas.
3. Put a public/shared decoder in `agent-core` or `agent-interface-command`.
   - Pro: makes the helper reachable across packages.
   - Con: moves framework-specific file-format vocabulary into lower packages, expands public
     contract surface, and is unnecessary because all planned consumers are inside `agent-framework`.

### Decision

**Alternative 2.** Keep format knowledge at the lowest common consumer owner, use `yaml` only for
syntax/coordinates, and apply closed typed validation afterward. Callers pass `skill`, `bundle-skill`,
or `agent`; paths never infer a dialect. This removes the parser class without prematurely wiring the
loaders that issue #2094 and issue #2095 own.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — three parser sites, real `.agents/skills` and `.claude/agents` keys, bundle
      `tags`, and the `TModelEffort` owner were surveyed before the decision.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None. Decode failure is explicit and contains no partial value. This leaf adds no fallback parser,
compatibility alias, loader catch-and-continue behavior, or user-facing degradation path.

## Solution

1. Add a private `decodeFrontmatter({ source, content, profile })` subsystem. Success returns fully
   typed metadata plus the exact body suffix; failure returns a structured non-empty diagnostic tuple
   and no metadata.
2. Use `yaml` document/AST parsing with duplicate-key detection and source coordinates. Reject aliases,
   merge keys, non-mapping roots, unsupported node shapes, malformed YAML, and missing closing
   delimiters. No opening delimiter is a valid empty-metadata document whose body equals the input.
3. Close the `skill` vocabulary over runtime and repository-owned fields, let `bundle-skill` add only
   `tags`, and close `agent` over its consumed fields plus checked-in `signal`. Reject skill `model`;
   retain agent `model`; type skill `effort` with imported `TModelEffort`; accept only `context: fork`.
4. Share strict boolean, non-empty string, list, scalar-metadata-map, effort, and positive-safe-integer
   primitives. Lists accept YAML string sequences or the explicitly supported comma/whitespace scalar
   notation, rejecting empty members and wrong shapes.
5. Emit stable diagnostic codes with source, 1-based line/column when available, optional field,
   expected shape, and received summary. Structural failure stops schema validation; schema failures
   aggregate in source order.
6. Add direct unit tests only. Do not export the decoder publicly or modify `skill-source.ts`,
   `bundle-plugin-utils.ts`, or `agent-definition-loader.ts`.

## Affected Files

- `packages/agent-framework/src/frontmatter/frontmatter-decoder.ts` — new private decoder and types.
- `packages/agent-framework/src/frontmatter/__tests__/frontmatter-decoder.test.ts` — direct contract tests.
- `packages/agent-framework/docs/design/frontmatter-decoder.md` — internal design and ownership record.
- `packages/agent-framework/package.json` — direct `yaml` dependency.
- `pnpm-lock.yaml` — resolved dependency ownership.
- This spec, the paired Task, and their subject-bound loop ledgers.

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/frontmatter/__tests__/frontmatter-decoder.test.ts` proves minimal and complete success for all three profiles, typed values, both list forms, actual repository metadata fields, and exact LF/CRLF/no-header body preservation; the RED run fails before the decoder exists.
- [ ] TC-02: the same test file rejects every reviewed structural/schema class with exact diagnostic
      code/source/line/column/field assertions and proves `disable-model-invocation: treu` cannot become
      `false`, invalid `maxTurns` cannot cross the boundary, skill `model` fails, and agent `model` succeeds.
- [ ] TC-03: the decoder output uses imported `TModelEffort`, every profile has a closed independently
      tested key set, and `git diff --exit-code origin/develop -- packages/agent-framework/src/commands/skill-source.ts packages/agent-framework/src/plugins/bundle-plugin-utils.ts packages/agent-framework/src/agents/agent-definition-loader.ts packages/agent-framework/src/index.ts` confirms no loader wiring or public export.
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-framework test && pnpm --filter @robota-sdk/agent-framework typecheck && pnpm --filter @robota-sdk/agent-framework lint && pnpm --filter @robota-sdk/agent-framework build` exits 0.
- [ ] TC-05: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0 and the design-document scan accepts the internal design doc.

## Test Plan

| TC-ID | Test Type          | Tool / Approach                                   | Notes                                                                                 |
| ----- | ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| TC-01 | Unit/TDD           | Focused Vitest file                               | RED before module exists; GREEN for all valid profiles and exact body behavior        |
| TC-02 | Security/negative  | Table-driven focused Vitest file                  | Fail-closed structural and field diagnostics, including authority-widening typo proof |
| TC-03 | Type/scope         | Type assertions plus exact `git diff --exit-code` | `TModelEffort` SSOT, closed profiles, no wiring/export scope creep                    |
| TC-04 | Package regression | Package test/typecheck/lint/build                 | Full affected package health on final tree                                            |
| TC-05 | Repository/design  | Affected harness scans and design-doc gate        | Governance and internal design conformance                                            |

## User Execution Test Scenarios

`SCENARIO DRAFTED: not-applicable | 0` — this leaf adds a private decoder and direct tests but does not
connect any product loader. Running a product command would exercise the existing permissive parsers,
not this change. Issue #2094 and issue #2095 own the runnable integrations and their scenario evidence.

## Tasks

- [ ] `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-29, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <5 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 5 changed path(s) — committed and working-tree changes vs origin/develop (merge base d1b24d11dd79) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md) is at or above the floor L0)
**Review fingerprint:** ac1da5e1ed49 (review 79611473, type/tags 28193824)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ac1da5e1ed49) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: SECURITY` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 830 chars, 6 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 5 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 5 Test Plan rows = 5 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 5 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <5)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ac1da5e1ed49) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SECURITY-002-skill-and-agent-frontmatter-cross-trust-boundaries-without-one-strict-decoder.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
