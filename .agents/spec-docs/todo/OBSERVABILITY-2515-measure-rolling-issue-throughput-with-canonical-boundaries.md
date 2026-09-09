---
status: approved
type: OBSERVABILITY
tags: [cli, rest, async]
lane: L1
---

# OBSERVABILITY-2515: measure rolling issue throughput with canonical boundaries

Paired with `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`. Arising from [issue #2515](https://github.com/woojubb/robota/issues/2515).

## Problem

On `origin/develop`, the requested canonical invocation `node scripts/harness/issue-throughput.mjs
--repo woojubb/robota --window 168h` fails because the command does not exist. Operators therefore
fall back to ad-hoc GitHub queries whose timezone, `[start,end)` boundary, pagination, issue
qualification, and failure behavior are not consistent, so creation, closure, open-queue, and net
growth counts cannot be compared reliably.

## Prior Art Research

Waived: user explicitly prohibited subagents for this task; the repository's existing checked-in
`scripts/harness/github-api.mjs` pagination contract and the #2515 parent agreement are sufficient
local prior art for this internal operator command.

## Architecture Review

### Affected Scope

- `scripts/harness/issue-throughput.mjs`
- `scripts/harness/__tests__/issue-throughput.test.mjs`
- `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`
- `.agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`

### Alternatives Considered

1. Keep using ad-hoc `gh api` or search queries for each measurement.
   - Pro: no new checked-in code.
   - Con: boundary, pagination, qualification, and failure semantics drift between operators.
2. Add a direct Node ESM command that reuses the checked pagination helper and injects its reader in tests.
   - Pro: one repeatable read-only contract with deterministic tests and visible failures.
   - Con: adds a small maintenance command and a second API read for the open snapshot.
3. Use one GitHub GraphQL query for all counts.
   - Pro: fewer apparent requests.
   - Con: introduces a separate pagination and schema contract without improving the required REST
     operator workflow already established by `github-api.mjs`.

### Decision

Choose alternative 2. The command will use `fetchAllPages` for REST collection reads, filter issue
records locally with exact UTC half-open comparisons, exclude pull requests, and calculate
`net = created - closed`. `open` is the current open issue snapshot returned by the same repository
endpoint at measurement time; `created` and `closed` are events inside the requested window. The
command will accept either `--window <hours>h` with an optional `--end <ISO-8601>` or an explicit
`--start <ISO-8601> --end <ISO-8601>` pair, normalize display timestamps to UTC, and exit non-zero
on malformed input or any API/query failure. It will not mutate GitHub state or use `/tmp`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: this is an internal operator measurement command, not a product CLI command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Parse and validate repository, explicit UTC-normalizable window boundaries, and the mutually
   exclusive `--window` versus `--start/--end` forms in `scripts/harness/issue-throughput.mjs`.
2. Read the repository's current open issue collection and the all-issues collection updated since
   the window start through `fetchAllPages`; exclude records carrying `pull_request`.
3. Count `created_at` and `closed_at` events only when their instants satisfy `[start,end)`, derive
   `net`, and emit a stable JSON envelope containing repository, UTC boundaries, query semantics,
   pagination semantics, and counts.
4. Add Vitest coverage using injected deterministic paginated readers for boundary inclusion and
   exclusion, timezone normalization, pagination/count aggregation, invalid arguments, and visible
   API failure. Keep the shipped command read-only and independent of session or temporary files.

## Affected Files

- `scripts/harness/issue-throughput.mjs`
- `scripts/harness/__tests__/issue-throughput.test.mjs`
- `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`
- `.agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`

## Completion Criteria

- [ ] TC-01: `node scripts/harness/issue-throughput.mjs --repo woojubb/robota --start <ISO> --end <ISO>` exits 0 for a successful read and emits JSON containing the repository, normalized UTC `start`/`end`, literal `[start,end)` boundary, UTC timezone, query/pagination semantics, and `open`/`created`/`closed`/`net` counts.
- [ ] TC-02: `pnpm exec vitest run scripts/harness/__tests__/issue-throughput.test.mjs` exits 0 while its deterministic fixtures prove start-inclusive/end-exclusive timestamps, pull-request exclusion, multi-page aggregation, timezone normalization, and non-zero visible failure for API/query errors.
- [ ] TC-03: From a clean checkout, the direct command is rerunnable without session history or `/tmp` state, performs only GitHub reads, and has no issue suppression, relabeling, deduplication, or other mutation path.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | Process integration | Spawn the command with a deterministic injected reader or safe read-only fixture and assert the JSON envelope | Confirms the operator-facing contract and exact boundary/display fields. |
| TC-02 | Log / event assertion | `pnpm exec vitest run scripts/harness/__tests__/issue-throughput.test.mjs` | OBSERVABILITY-derived coverage includes pagination, boundary, timezone, and failure output. |
| TC-03 | Process integration | Run the direct command from a clean temporary checkout and inspect the command/API path | No `/tmp` or session dependency; read-only behavior is asserted from source and invocation. |

## User Execution Test Scenarios

Not applicable — this is an internal operator measurement command and changes no behavior reachable
through the Robota CLI, TUI, browser UI, or public SDK.

## Tasks

- [ ] `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-10

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <1 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 1 changed path(s) — committed and working-tree changes vs origin/develop (merge base efa1b8885c5c) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md) is at or above the floor L0)
**Review fingerprint:** 2d9efe062ab4 (review 2d770936, type/tags 36785b34)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `efa1b8885c5c` · base `origin/develop@efa1b8885c5c` · document `.agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md` blob `cb2f84464c84` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-10, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <1 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 1 changed path(s) — committed and working-tree changes vs origin/develop (merge base efa1b8885c5c) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md) is at or above the floor L0)
**Review fingerprint:** 2d9efe062ab4 (review 2d770936, type/tags 36785b34)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <1)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2d9efe062ab4) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `efa1b8885c5c` · base `origin/develop@efa1b8885c5c` · document `.agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md` blob `8eadcdab00da` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: OBSERVABILITY` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (3 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 431 chars, 2 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <1)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2d9efe062ab4) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `efa1b8885c5c` · base `origin/develop@efa1b8885c5c` · document `.agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md` blob `039553d05db1` (untracked)
