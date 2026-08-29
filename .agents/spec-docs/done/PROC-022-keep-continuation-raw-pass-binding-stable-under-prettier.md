---
status: done
type: RULE
tags: [workflow, harness]
lane: L2
---

# PROC-022: Keep continuation raw PASS binding stable under Prettier

Paired with `.agents/tasks/completed/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md`.
Arising from [issue #2547](https://github.com/woojubb/robota/issues/2547), discovered while closing
[issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

A staged `gateImplementContinuation` checkpoint passes
`node scripts/harness/scan-user-execution-plan-order.mjs --staged`, but the mandatory pre-commit
Prettier task inserts a blank Markdown separator before the appended level-3 heading. The current
`rawGateImplementPassEntries` slice assigns that structural separator to the preceding PASS entry.
The committed history therefore immediately fails with `parent raw PASS entries must remain
byte-identical in exact prefix order before exactly one appended entry`, even though no byte inside
the prior PASS changed.

Reproduction: start from a formatted in-progress spec whose final content is a valid
GATE-IMPLEMENT PASS, append a valid continuation directly at EOF, run the staged scanner, format the
Markdown with the repository Prettier configuration, commit, then replay the history scanner.

## Prior Art Research

Waived: this is an incompatibility between two repository-local authorities—the raw checkpoint
parser and mandatory Markdown formatter. Their current implementation, contract tests, and
pre-commit ordering are the complete authoritative comparison set.

## Architecture Review

### Affected Scope

- `scripts/harness/checkpoint-evidence-contract.mjs` — define raw PASS boundaries without assigning
  formatter-owned blank heading separators to the preceding entry.
- `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs` — lock the boundary semantics
  while preserving internal-byte sensitivity.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — reproduce a formatted
  continuation and retain mutation, reorder, deletion, squash, and no-ff controls.
- `.agents/rules/backlog-execution.md` — state that inter-entry Markdown separator lines are
  structural and excluded from each raw PASS body.

### Alternatives Considered

1. End each raw entry before contiguous blank lines that immediately precede the next visible
   level-3-or-higher heading.
   - Pro: matches formatter-stable Markdown structure while retaining every byte inside the PASS.
   - Con: the boundary helper must distinguish structural separator lines from entry content.
2. Exempt checkpoint specs from Prettier or bypass lint-staged for checkpoint commits.
   - Pro: leaves the parser unchanged.
   - Con: creates an unformatted exception and weakens mandatory hook coverage; rejected.
3. Normalize all whitespace before hashing and prefix comparison.
   - Pro: avoids formatter sensitivity broadly.
   - Con: would hide meaningful internal trailing-space mutations and weaken byte binding; rejected.

### Decision

**Alternative 1.** Preserve exact bytes from the GATE-IMPLEMENT heading through its final nonblank
line, including internal spaces and blank lines. Exclude only contiguous blank separator lines that
immediately precede the next visible heading. At EOF, retain the existing terminal newline. This
makes a Prettier-required heading separator stable without normalizing or rewriting PASS content.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — raw-byte, mutation, reorder, squash, no-ff, and three-PR fixtures remain controls.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no package, app, interface, layer, or product surface is added.

## Fallback & Degradation Declaration

Any mutation inside a predecessor PASS, incomplete evidence region, digest mismatch, deletion,
reorder, or ancestry mismatch remains a hard refusal. Only formatter-owned blank heading separators
are excluded from entry identity.

## Solution

1. Add a contract fixture whose parent PASS ends at EOF and whose continuation uses the
   Prettier-style blank separator.
2. Adjust raw-end selection to stop before contiguous blank lines immediately preceding the next
   visible heading.
3. Retain explicit assertions that internal trailing spaces and prior PASS mutations change identity
   and are refused.
4. Run focused contract/plan-order tests, affected scans, and the full harness contract tier.

## Affected Files

- `.agents/rules/backlog-execution.md`
- `scripts/harness/checkpoint-evidence-contract.mjs`
- `scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

## Completion Criteria

- [x] TC-01: a parent PASS ending at EOF and the same PASS followed by a Prettier-style blank
      separator produce byte-identical predecessor entries and the same `priorPassDigest`.
- [x] TC-02: changing trailing spaces or any non-separator byte inside the predecessor PASS changes
      its digest and the continuation prefix validation refuses replacement, deletion, and reorder.
- [x] TC-03: a real temporary Git continuation history with the formatted separator returns
      `findHistoryFindings(...) === []`, while existing squash/no-ff ancestry controls remain green.
- [x] TC-04: focused Vitest, affected harness scans, and `pnpm harness:test:contracts` all exit 0.

## Test Plan

| TC-ID | Test Type        | Tool / Approach                                                       | Notes                                           |
| ----- | ---------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| TC-01 | Unit contract    | `checkpoint-evidence-contract.test.mjs` EOF/separator fixture         | Test written: formatter-stable raw boundary     |
| TC-02 | Mutation/control | existing raw-byte mutation suite plus explicit internal-space control | Test written: raw bytes remain sensitive        |
| TC-03 | Integration      | `scan-user-execution-plan-order.test.mjs` temporary formatted history | Test written: formatted continuation history    |
| TC-04 | Regression suite | focused Vitest, affected scans, and full harness contract tier        | Test written: owner suites and repository gates |

## User Execution Test Scenarios

Not applicable — this changes repository-internal Markdown parsing and Git-order enforcement only;
it exposes no CLI, TUI, browser, SDK, configuration, or product behavior.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block.
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` was present before this transition.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT · INFRA · PERF · SECURITY · OBSERVABILITY: `type: RULE` is allowed.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags: [workflow, harness]` is present.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): the staged scanner passes, mandatory Prettier inserts a heading separator, and history replay fails with the exact raw-prefix diagnostic.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): the Problem names the EOF parent, valid continuation append, staged scan, repository formatter, commit, and history replay sequence.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: the Problem is concrete multi-sentence prose with no TBD/TODO.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` is present.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec — NOT third-party source code per `research.md`), OR explicitly states no comparable reference was found: the section uses the explicit repository-local waiver route.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare or missing section is FAIL: the Waived line identifies the raw parser, formatter, tests, and hook ordering as the authoritative local comparison set.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): the alternatives compare boundary exclusion, formatter exemption, and broad normalization against the two local authorities.
- GATE-WRITE — All 4 checklist items are `[x]`: all 5 displayed checklist items are checked.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: the checked item names raw-byte, mutation, reorder, squash, no-ff, and three-PR controls.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives each carry Pro and Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: it excludes only formatter-owned structural separators while preserving exact internal bytes and rejecting broad normalization.
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interface surface, or reclassifies a layer / product-family boundary, the Sibling scan / Decision MUST (a) name the analogous existing layer it mirrors + its product-family classification, and (b) show reuse is at the shared contract/core level, not a dependency on a sibling PRODUCT. See `spec-workflow.md` "New-Surface Architecture Placement". (N/A only if no new surface/boundary is introduced.): N/A — only an existing parser, rule text, and their existing tests change; no package, app, interface, layer, or product-family boundary is introduced.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: all 4 criteria are TC-prefixed.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: TC-01 covers stable boundaries, TC-02 internal-byte protection, TC-03 Git integration behavior, and TC-04 repository regressions.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): each TC names digest equality/change, a scanner result, a refusal, or exact command exit behavior.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of the prohibited phrases appears in Completion Criteria.
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` is present.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 rows match TC-01 through TC-04.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): all 4 rows have Test Type and Tool/Approach.
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: there are 0 manual rows.
- GATE-WRITE — Tasks section present with placeholder: the unchecked exact paired Task path is present.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): the section was empty before this first structured entry.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): neither forbidden body section exists.

**Independent guardian verdict:** `GATE-WRITE: PASS` — all 20 mechanical and 7 semantic criteria are satisfied. The observable incompatibility, exact reproduction, repository-local authority set, alternatives, narrow boundary decision, N/A surface placement, and one-to-one TC coverage are executable and fail closed.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잠재적으로 모두 사전 승인함"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** a97d823e4301 (review 22da853d, type/tags 42a75dd9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a97d823e4301) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 303 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md",
  "specPath": ".agents/spec-docs/todo/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md",
    ".agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs -t "keeps a predecessor raw PASS"`
**Exit:** 0
**Output:** direct EOF-versus-Prettier separator identity and digest assertions passed.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
**Exit:** 0
**Output:** internal trailing-space sensitivity and replacement/deletion/reorder controls passed; owner suites 153/153.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-30

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t "accepts the Prettier blank separator"`
**Exit:** 0
**Output:** formatted temporary Git continuation returned no history findings; full plan-order suite passed 136/136.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-30

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts && pnpm harness:test:contracts`
**Exit:** 0
**Output:** 60 affected scans passed with 1 declared skip; contract tier passed 195 files and 4,299 tests.

### [GATE-VERIFY] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 4/4 tasks `[x]` in .agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 60 scans passed, 1 skipped (43 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/active/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md, M .agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/checkpoint-evidence-contract.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` → exit 0 (Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature' ⏎ Switched to a new branch 'feature'); all 2 supplied commands exit 0

### [GATE-COMPLETE] — ✅ PASS | 2026-08-30

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-30; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 4/4 tasks `[x]` in .agents/tasks/PROC-022-keep-continuation-raw-pass-binding-stable-under-prettier.md
