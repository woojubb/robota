---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-006: agent-cli SPEC dependency chain correction

> Source: INFRA-002 audit finding **AF-03** (P0, CONTRADICTION). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`packages/agent-cli/docs/SPEC.md` documents the dependency chain `agent-cli → agent-sdk → agent-sessions
→ agent-core` plus an Import Rules table listing `agent-sdk`, `agent-sessions`, `agent-provider-*`
(SPEC.md:296, §49-52). None of `agent-sdk`, `agent-sessions`, `agent-provider-*` exist as packages, and
the SPEC omits the three real dependencies. The actual `package.json` deps are:
`agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport`.
This is the single most misleading consumer-facing SPEC — it describes a dependency topology that does
not exist.

**Reproduction condition:** diff the SPEC's dependency section against
`node -p "Object.keys({...require('./packages/agent-cli/package.json').dependencies}).filter(k=>k.startsWith('@robota-sdk/'))"`.

## Architecture Review

### Affected Scope

- `packages/agent-cli/docs/SPEC.md` (doc correction only — no code change).

### Alternatives Considered

1. **Patch only the obviously-wrong names.** Pro: minimal. Con: leaves the chain structure wrong and the
   three real deps undocumented. Rejected.
2. **Rewrite the dependency section + Import Rules table to the real 6-edge graph** (from the INFRA-002
   ground-truth edge set), removing all phantom package names. Pro: makes the SPEC accurate. Con: none
   material. Chosen.

### Decision

Alternative 2 — rewrite to the real dependency graph. The proposed workspace-package-name guard
(INFRA-003 / AF-06) will prevent recurrence by failing on any non-existent `@robota-sdk/agent-*` token.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — single file: `packages/agent-cli/docs/SPEC.md`
- [x] Sibling scan 완료 — N/A: single-doc correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records accuracy-to-ground-truth rationale

## Solution

Replace the SPEC's dependency chain and Import Rules table with the real 6 production dependencies and
remove `agent-sdk` / `agent-sessions` / `agent-provider-*` / `agent-runtime` references.

## Affected Files

- `packages/agent-cli/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `rg -n '@robota-sdk/agent-(sdk|sessions|provider-|runtime)' packages/agent-cli/docs/SPEC.md`
      returns nothing.
- [x] TC-02: The SPEC's dependency section lists exactly the 6 real deps
      (`agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport`).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                                                                                                    | Notes                                           |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| TC-01 | CI pipeline smoke test | `rg` grep assertion over `agent-cli/docs/SPEC.md`                                                                                                                  | Command-form: zero phantom names                |
| TC-02 | CI pipeline smoke test | `rg` over the dependency-chain diagram + Import Rules table: the 6 real dep names present, none of `agent-sdk`/`agent-sessions`/`agent-provider-*`/`agent-runtime` | Command-form: grep over the dependency sections |

## Tasks

- [x] `.agents/tasks/completed/INFRA-006.md` — archived (TC-01, TC-02 + Test Plan; all tasks `[x]`)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present, `status: draft`, `type: INFRA` (valid 11-prefix value), `tags: [typescript]` present — PASS.
Problem: concrete symptom (phantom `agent-sdk`/`agent-sessions`/`agent-provider-*` at SPEC.md:296 §49-52 vs real 6 deps) + reproduction condition (node/require diff command); no TBD/TODO/vague — PASS.
Architecture Review: all 4 checklist items `[x]`; Sibling scan `[x]` with explicit `N/A: single-doc correction` reason; 2 alternatives each with Pro/Con; Decision references accuracy-to-ground-truth trade-off — PASS.
Completion Criteria: TC-01, TC-02 both TC-N prefixed, command-form (`rg` assertions), no banned vague language — PASS.
Test Plan: `## Test Plan` present; 2 rows (TC-01, TC-02) matching 2 Completion Criteria TC-N (count matches); each row has non-empty Test Type + Tool/Approach; no manual rows requiring Notes — PASS.
Structure: Tasks section present with placeholder; Evidence Log present and empty prior to this entry; no `## Status` or `## Classification` body sections — PASS.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved
Explicit approval: User replied "1" selecting "후속 정리 백로그 진행 — INFRA-004/005/006 (P0 draft)" — a direct, unambiguous authorization to advance the P0 follow-up cleanup backlogs, naming INFRA-006 explicitly — PASS.
Direct & unambiguous: the selection confirms the design and authorizes implementation for INFRA-006 specifically (not a clarifying-question answer, not approval of a different item) — PASS.
No post-approval drift: frontmatter `type: INFRA` / `tags: [typescript]` and the Architecture Review checklist (all 4 `[x]`) unchanged after approval — PASS.
NON-COMPLIANCE check: no implementation started — `.agents/tasks/INFRA-006.md` not yet created (placeholder: "GATE-APPROVAL 통과 후 생성"), no SPEC.md edits made — PASS.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress
Tasks file created: `.agents/tasks/INFRA-006.md` exists — PASS.
Tasks file path recorded in spec `## Tasks` section ("생성 완료 (TC-01, TC-02 + Test Plan)") — PASS.
Tasks correspond to Completion Criteria: 2 tasks created — TC-01 (remove phantom `@robota-sdk/agent-(sdk|sessions|provider-|runtime)` refs; verify `rg` returns nothing) and TC-02 (rewrite dependency section + Import Rules table to the 6 real deps); one task per TC-N — PASS.
Test Plan present in tasks file: `## Test Plan` section (~398-char prose paragraph + 2-row table) well over the ≥50-char requirement [AF-24] — PASS.
NON-COMPLIANCE check: no implementation commits exist for `packages/agent-cli/docs/SPEC.md`; tasks file created before any code change — PASS.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying
Tasks completion: both tasks in `.agents/tasks/INFRA-006.md` are `[x]` (TC-01, TC-02); none blocked or pending — PASS.
TC-01: `rg -n '@robota-sdk/agent-(sdk|sessions|provider-|runtime)' packages/agent-cli/docs/SPEC.md` → zero matches, exit code 1 (no phantom scoped names) — PASS.
TC-02: dependency-chain diagram (SPEC.md §295-307) + Import Rules table (§45-56) contain all 6 real dep names (`agent-command`=54, `agent-core`=15, `agent-framework`=36, `agent-provider`=3, `agent-subagent-runner`=3, `agent-transport`=15 occurrences) and none of the four forbidden patterns `agent-sdk`/`agent-sessions`/`agent-provider-*`/`agent-runtime`. Real deps cross-checked against `package.json` (`node -p` → exactly the 6) — PASS.
harness:scan: `pnpm harness:scan` → all 23 scans passed, exit 0 — PASS.
build/test: N/A — doc-only change to `packages/agent-cli/docs/SPEC.md`, no source code modified.
Note (out of gate scope): the diagram retains `agent-session`/`agent-tools`/`agent-executor` as transitive/forbidden-row references; these are real workspace packages (not the four phantom patterns) and fall outside TC-01/TC-02's defined failure set, so they do not block this gate.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

**Command:** `rg -n '@robota-sdk/agent-(sdk|sessions|provider-|runtime)' packages/agent-cli/docs/SPEC.md`
**Output:** (no matches) — **exit code 1**. Zero scoped phantom dependency references remain. Checkbox `[x]` confirmed.
**Test reference:** Test Plan TC-01 (CI pipeline smoke test, `rg` grep assertion) — verified by the command above (zero matches). Doc-only correction; no unit-test artifact applicable.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

**Command:** `node -p "Object.keys(require('./packages/agent-cli/package.json').dependencies).filter(k=>k.startsWith('@robota-sdk/'))"` + `rg` over the SPEC dependency-chain diagram + Import Rules table.
**Output:** package.json scoped deps = exactly the 6 real deps (`@robota-sdk/agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport`). SPEC dependency section/Import Rules table list all 6 (occurrence counts: agent-command 54, agent-core 15, agent-framework 36, agent-provider 3, agent-subagent-runner 3, agent-transport 15); none of the four forbidden scoped patterns present. Checkbox `[x]` confirmed.
**Test reference:** Test Plan TC-02 (CI pipeline smoke test, `rg` over dependency sections) — verified by the commands above. Doc-only correction; no unit-test artifact applicable.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done
Completion Criteria: both TC-01 and TC-02 checkboxes `[x]`, each with a matching `[GATE-COMPLETE: TC-N]` evidence entry above — PASS.
Test Plan: both TC-01 and TC-02 rows carry a command-form `rg` test reference (no row left silently unaddressed) — PASS.
Gate chain integrity: in-order WRITE → APPROVAL → IMPLEMENT → VERIFY → COMPLETE chain present and authoritative — PASS.
User-Execution done-gate: N/A — spec has no `## User Execution Test Scenarios` section (doc-only correction, AF-03).
Tasks file archived: `.agents/tasks/INFRA-006.md` → `.agents/tasks/completed/INFRA-006.md` — PASS.
`## Tasks` section updated to reference archived path with all tasks `[x]` — PASS.
