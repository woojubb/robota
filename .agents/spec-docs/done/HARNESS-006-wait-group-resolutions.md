---
status: done
type: INFRA
tags: [harness, cli, docs]
---

# HARNESS-006: Wait-group resolutions — flag-wiring test, tool-description rule, security-test rule, event-continuity clause (covers backlog HARNESS-006/007/009/010)

## Problem

Four lesson items were deferred pending a design decision; the user approved the recommended
lighter forms (2026-06-11 "승인함"):

1. **Flag wiring unenforced (HARNESS-006).** `--denied-tools`/`--dry-run` were parsed into
   `IParsedCliArgs` and silently unread (CLI-053/054). A grep-level harness scan risks false
   positives (spread/dynamic access); a written convention has no enforcement. Reproduce: add a
   field to `IParsedCliArgs` + help text without any consumer — everything stays green.
2. **Tool description/schema drift rule missing (HARNESS-007).** Grep advertised `count` and
   `head_limit` that the schema lacked (CLI-057). Heuristic description-parsing tests for ALL
   builtins would be brittle; the decided form is a rule requiring a consistency test whenever a
   builtin tool is added or its schema/description changes.
3. **Security-branch testing rule missing (HARNESS-009).** `permission-gate.ts` had zero deny-
   precedence tests until CLI-053 — the property underpinning `--denied-tools` was unverified.
   Decided form: review rule (decision branches of permission/security modules require unit
   tests), no numeric coverage threshold.
4. **Event continuity clause missing (HARNESS-010).** Memory events were recorded but never
   emitted/rendered (CLI-059). Decided form: transparent-workflow spec clause; the emit-site
   scan stays deferred.

## Architecture Review

### Affected Scope

- `packages/agent-cli/src/utils/__tests__/cli-flag-wiring.test.ts` (new) — enforced wiring test
- `.agents/rules/common-mistakes.md` — two entries (tool description/schema; security branches)
- `.agents/specs/transparent-workflow.md` — event continuity clause

### Alternatives Considered

**A. HARNESS-006 as a repo-level harness scan**

- Pro: covers future arg parsers beyond agent-cli
- Con: grep-level cross-package scanning of field reads is exactly the false-positive shape the
  wait-group review flagged; agent-cli's parser is the only CLI arg surface today

**B. HARNESS-006 as an agent-cli unit test that enumerates `IParsedCliArgs` fields from the parser source and asserts each is read outside cli-args.ts (chosen)**

- Pro: CI-enforced (vitest), scoped to one package where the field/consumer corpus is small and
  reviewable; inline allowlist with reasons for parse-internal fields; new unconsumed fields
  fail immediately (the CLI-053/054 class)
- Con: source-regex enumeration of the interface — acceptable in a test that owns its fixture
  (the package's own source)

**C. HARNESS-007/009 as scans or coverage thresholds**

- Pro: mechanical
- Con: description-text heuristics are brittle across tools; numeric thresholds invite
  formalistic tests — rejected per the wait-group review; rules + the existing worked examples
  (grep-tool.test.ts TC-03, permission-gate.test.ts) are the enforceable-by-review form

### Decision

**B + rules + spec clause** — per the approved recommendation. The wiring test reads
`cli-args.ts`, extracts `IParsedCliArgs` field names, and asserts each name occurs in
agent-cli `src/` outside `cli-args.ts` (word boundary), with a reasoned inline allowlist for
fields consumed only at parse time. Rules land as common-mistakes entries citing the incidents
and the worked-example tests. The transparent-workflow spec gains: every recorded
user-meaningful event must define its emission and render path or explicitly declare itself
internal (memory-event incident as example).

### Architecture Review Checklist

- [x] Affected packages/layers listed — agent-cli test only (no runtime change), two docs
- [x] Sibling scan complete — test mirrors grep-tool.test.ts source-introspection style;
      common-mistakes rows follow the existing #54-57 format; transparent-workflow structure
      checked before writing
- [x] At least 2 alternatives reviewed — A/B for 006, C for 007/009
- [x] Decision rationale documented — see Decision

## Solution

1. `cli-flag-wiring.test.ts`: parse `IParsedCliArgs` block from cli-args.ts source; for each
   field, search agent-cli `src/**` (excluding cli-args.ts and tests) for `\bargs.<field>\b` or
   `\b<field>\b` destructured usage; fail listing unconsumed fields; allowlist with reasons
   (e.g. fields normalized inside parseCliArgs).
2. common-mistakes entries: (#58) builtin tool description advertising schema-absent
   parameters/modes — add/extend the tool's description-schema consistency test on every
   schema/description change (worked example: grep-tool.test.ts TC-03, incident CLI-057);
   (#59) security/permission decision modules require unit tests covering every decision branch
   (worked example: permission-gate.test.ts, incident CLI-053).
3. transparent-workflow.md: "Event Continuity" clause.

## Affected Files

- `packages/agent-cli/src/utils/__tests__/cli-flag-wiring.test.ts` (new)
- `.agents/rules/common-mistakes.md`
- `.agents/specs/transparent-workflow.md`

## Completion Criteria

- [x] TC-01: the wiring test fails when a fixture-injected fake field exists in
      `IParsedCliArgs` without consumers (self-test of the mechanism: temporarily verified by
      asserting the extractor finds all current fields), and passes on the live parser with
      every non-allowlisted field consumed
- [x] TC-02: removing (simulating) a consumer is caught — verified by asserting the test's
      search logic returns zero hits for a known-fake name and >0 for a known-wired field like
      `deniedTools`
- [x] TC-03: common-mistakes contains the two new entries citing CLI-057/CLI-053 and the worked
      example tests
- [x] TC-04: transparent-workflow.md contains the Event Continuity clause citing CLI-059
- [x] TC-05: `pnpm --filter @robota-sdk/agent-cli test` green including the new test;
      consistency scan green

## Test Plan

| TC-ID | Test Type | Tool / Approach                                    | Notes                                                                                                                                                                                           |
| ----- | --------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit      | vitest — live parser enumeration + allowlist       | Test written: `packages/agent-cli/src/utils/__tests__/cli-flag-wiring.test.ts` > "TC-01: every parsed field has a consumer outside cli-args.ts (or a reasoned allowlist entry)"                 |
| TC-02 | unit      | vitest — search-logic positive/negative assertions | Test written: same file > "TC-02: the search logic detects wired and unwired names correctly" + "TC-02: extractor enumerates known fields"                                                      |
| TC-03 | static    | grep rule entries                                  | Test skipped: doc-content check, no automated test — verified by grep (rows 58/59 in `.agents/rules/common-mistakes.md`), evidence in [GATE-COMPLETE: TC-03]                                    |
| TC-04 | static    | grep spec clause                                   | Test skipped: doc-content check, no automated test — verified by grep ("Event Continuity (mandatory)" + CLI-059 in `.agents/specs/transparent-workflow.md`), evidence in [GATE-COMPLETE: TC-04] |
| TC-05 | live      | agent-cli test suite + consistency scan            | Test skipped: live-run criterion, not a single test — covered by full suite (107/107) + `harness:scan:consistency`, evidence in [GATE-VERIFY] and [GATE-COMPLETE: TC-05]                        |

## Tasks

- `.agents/tasks/completed/HARNESS-006.md` — created 2026-06-11, archived 2026-06-11 (4 tasks: T1 → TC-01/02, T2 → TC-03, T3 → TC-04, T4 → TC-05; all complete)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: INFRA` (valid prefix from the 11-value list); `tags: [harness, cli, docs]` present
- Problem: concrete symptoms with incident IDs (CLI-053/054 unread flags, CLI-057 `count`/`head_limit` schema drift, CLI-053 zero deny-precedence tests, CLI-059 unemitted memory events); reproduction condition stated ("add a field to `IParsedCliArgs` + help text without any consumer — everything stays green"); no TBD/TODO or vague single-sentence description
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (mirrors grep-tool.test.ts style, common-mistakes #54-57 format, transparent-workflow structure checked); Alternatives Considered has 3 entries (A, B, C) each with pro and con; Decision references the trade-off (CI-enforced scoped test vs. false-positive-prone repo scan; rules vs. brittle heuristics/thresholds)
- Completion Criteria: 5 items, all TC-N prefixed (TC-01..TC-05); at least one criterion per sub-item (TC-01/02 → flag wiring, TC-03 → two rule entries for 007/009, TC-04 → event continuity clause, TC-05 → suite + scan); each uses command or observable-behavior form; no banned vague phrases
- Test Plan: section present; 5 rows matching 5 TC-Ns (count matches); every row has non-empty Test Type and Tool/Approach; no "TBD"; no manual rows requiring Notes
- Structure: Tasks section present with placeholder; Evidence Log present and empty before this entry; no `## Status` or `## Classification` body sections

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: the orchestrating agent presented the four deferred wait-group items (HARNESS-006 flag-wiring enforcement, HARNESS-007 tool-description rule vs per-tool heuristic tests, HARNESS-009 review rule vs coverage threshold, HARNESS-010 spec clause vs emit-site scan) with recommended lighter forms and trade-off rationale; user replied verbatim: "승인함" (2026-06-11)
- Direct and unambiguous, directed at this spec document: the approval addressed exactly the four items and recommended forms this document covers (Alternatives B + rules + spec clause)
- No Architecture Review or frontmatter type/tags modified after approval
- No implementation started before this gate (no tasks file, no code commits) — NON-COMPLIANCE trigger not met

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-11

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/HARNESS-006.md` exists (untracked, new) with 4 tasks — T1 (TC-01/02 cli-flag-wiring.test.ts), T2 (TC-03 common-mistakes #58/#59), T3 (TC-04 transparent-workflow Event Continuity clause), T4 (TC-05 agent-cli suite + consistency scan)
- Tasks file path recorded in `## Tasks` section of this spec (updated during this gate run, replacing the GATE-APPROVAL placeholder)
- Task ↔ Completion Criteria correspondence: all 5 TC-Ns covered — TC-01 → T1, TC-02 → T1, TC-03 → T2, TC-04 → T3, TC-05 → T4; no TC-N unmapped
- NON-COMPLIANCE trigger not met: no implementation commits or working-tree changes exist for the affected files (`packages/agent-cli/src/utils/__tests__/cli-flag-wiring.test.ts` absent; `common-mistakes.md` and `transparent-workflow.md` unmodified; git status shows only the untracked tasks file)

### [GATE-VERIFY] — ✅ PASS | 2026-06-11

**Status upgrade:** in-progress → verifying

- Tasks file completion: `.agents/tasks/completed/HARNESS-006.md` — all 4 tasks `[x]` (T1 → TC-01/02, T2 → TC-03, T3 → TC-04, T4 → TC-05); no blocked or pending tasks
- Tests: `pnpm --filter @robota-sdk/agent-cli test` → 11 files passed, 107/107 tests passed (matches expected 107)
- Consistency scan: `pnpm harness:scan:consistency` → "harness consistency scan passed.", exit 0
- Build: affected scope is one new test file + two docs (no runtime/package source change); the vitest run compiles the test corpus and serves as the build evidence for the affected scope

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-11

**Test:** `cli-flag-wiring.test.ts` > "TC-01: every parsed field has a consumer…" — live parser enumeration (38 fields) vs agent-cli src corpus with reasoned allowlist. **First run immediately caught `disableUpdateCheck` as unconsumed** — triaged as a corpus false positive (consumed cross-package via whole-args pass-through to `shouldRunStartupCliUpdateCheck` in agent-framework) and allowlisted with the precise reason — proving both the detection power and the allowlist discipline. Pass.

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-11

**Tests:** search-logic positive (`deniedTools` found) / negative (fake name absent) assertions; extractor enumerates known fields; allowlist-entries-must-still-be-parsed guard. All pass (4/4 in the file).

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-11

**Evidence:** common-mistakes #58 (description-schema consistency test on tool change, grep-tool.test.ts TC-03 worked example, CLI-057 incident) and #59 (security decision-branch tests, permission-gate.test.ts worked example, CLI-053 incident) added.

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-11

**Evidence:** transparent-workflow.md "Event Continuity (mandatory)" clause added with the CLI-059 incident.

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-11

**Commands:** agent-cli 107/107 (11 files, includes the new wiring test); `harness:scan:consistency` passed.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-11

**Status upgrade:** verifying → done

- Completion Criteria: all 5 TC checkboxes `[x]` (TC-01..TC-05); each has a matching `[GATE-COMPLETE: TC-N]` Evidence Log entry with command/result
- Artifact check TC-01/02: `packages/agent-cli/src/utils/__tests__/cli-flag-wiring.test.ts` exists (3,721 bytes) with named tests "TC-01: every parsed field has a consumer outside cli-args.ts (or a reasoned allowlist entry)", "TC-02: the search logic detects wired and unwired names correctly", "TC-02: extractor enumerates known fields", plus allowlist-integrity guard — all green in the 107/107 run
- Artifact check TC-03: `.agents/rules/common-mistakes.md` rows 58 (description-schema consistency test, grep-tool.test.ts TC-03 worked example, CLI-057) and 59 (security decision-branch unit tests, permission-gate.test.ts worked example, CLI-053) present — verified by grep
- Artifact check TC-04: `.agents/specs/transparent-workflow.md` contains "## Event Continuity (mandatory)" clause citing incident CLI-059 — verified by grep
- Artifact check TC-05: `pnpm --filter @robota-sdk/agent-cli test` → 107/107 passed; `pnpm harness:scan:consistency` → passed, exit 0 (re-run during this guard sequence)
- Test Plan: all 5 TC-N rows updated with a test reference (TC-01/02) or explicit skip reason (TC-03/04/05) — no row silently unaddressed
- Tasks file archived: `.agents/tasks/completed/HARNESS-006.md` (all 4 tasks `[x]`); `## Tasks` section updated to the archived path
