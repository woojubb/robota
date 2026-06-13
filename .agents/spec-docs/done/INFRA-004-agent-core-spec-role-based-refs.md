---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-004: agent-core SPEC role-based consumer references

> Source: INFRA-002 audit finding **AF-01** (P0, VIOLATION). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`packages/agent-core/docs/SPEC.md` is the SSOT contract for the zero-dependency foundation package, yet
it names specific consumer packages — `agent-session`, `agent-tools`, `agent-team`, `agent-plugin-*` —
in its "Consumed By" section (§842-845) and Layer diagram (§49-53). This violates the SSOT-no-external-refs
rule: foundation packages must describe consumers by role, never by name (a foundation package must not
encode knowledge of who depends on it). It also propagates the phantom `agent-team` and `agent-plugin-*`
names (which do not exist as packages — see AF-04/AF-06).

**Reproduction condition:** `rg '@robota-sdk/agent-(session|tools|team|plugin)' packages/agent-core/docs/SPEC.md`
returns consumer-name references inside the zero-dep foundation SPEC.

## Architecture Review

### Affected Scope

- `packages/agent-core/docs/SPEC.md` (doc correction only — no code change).

### Alternatives Considered

1. **Leave as-is / minor wording tweak.** Pro: least effort. Con: keeps the rule violation and phantom
   names; foundation SPEC keeps encoding consumer identities. Rejected.
2. **Rewrite consumer references in role-based language** ("session-layer consumers", "tool-layer
   consumers", "plugin extensions"), removing all specific `@robota-sdk/agent-*` consumer names. Pro:
   resolves the rule violation and the phantom names in one pass. Con: requires careful rewrite of the
   Layer diagram. Chosen.

### Decision

Alternative 2 — rewrite to role-based descriptions. This is also the canonical fix the proposed
workspace-package-name guard (INFRA-003 / AF-06) will enforce going forward.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — single file: `packages/agent-core/docs/SPEC.md`
- [x] Sibling scan 완료 — N/A: single-doc correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records the SSOT-no-external-refs rationale

## Solution

Replace every specific consumer-package name in `agent-core/docs/SPEC.md` "Consumed By" and Layer
diagram with role-based descriptions; remove the phantom `agent-team` / `agent-plugin-*` names.

## Affected Files

- `packages/agent-core/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: `rg -n '@robota-sdk/agent-' packages/agent-core/docs/SPEC.md` returns no consumer-package
      reference (only self-references to `@robota-sdk/agent-core`, if any, remain).
- [x] TC-02: The "Consumed By" section and Layer diagram describe consumers by role, and `pnpm harness:scan`
      still exits 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                    | Notes                            |
| ----- | ---------------------- | -------------------------------------------------- | -------------------------------- |
| TC-01 | CI pipeline smoke test | `rg` grep assertion over `agent-core/docs/SPEC.md` | Command-form: zero consumer refs |
| TC-02 | CI pipeline smoke test | `pnpm harness:scan` exit 0                         | doc-only change                  |

## Tasks

- [x] `.agents/tasks/completed/INFRA-004.md` — 완료 후 아카이브 (TC-01, TC-02 + Test Plan)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present, `status: draft`, `type: INFRA` (valid 11-prefix), `tags: [typescript]` present.
Problem: concrete symptom (rg reproduction + named sections §842-845/§49-53), reproduction condition present, no TBD/TODO/vague text.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` with explicit `N/A: single-doc correction`; 2 alternatives with pro/con each; Decision references SSOT-no-external-refs trade-off.
Completion Criteria: TC-01, TC-02 both TC-N-prefixed, both Command-form, no banned vague language.
Test Plan: section present; 2 rows match 2 TC-N (count matches); each row has non-empty Test Type + Tool; no "manual" rows requiring Notes justification.
Structure: Tasks section present with placeholder; Evidence Log empty before this entry; no `## Status` or `## Classification` body sections.
Repro verified: `rg '@robota-sdk/agent-(session|tools|team|plugin)' packages/agent-core/docs/SPEC.md` returns 16 matches, confirming the stated violation.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved
Explicit approval: user was presented with next-step options and replied "1", selecting "후속 정리 백로그 진행 — INFRA-004/005/006 (P0 draft) → GATE-WRITE부터" — a direct, unambiguous authorization to advance the P0 follow-up cleanup backlogs INFRA-004/005/006, which explicitly names INFRA-004.
Directed at this spec: the selected option names INFRA-004 by ID; approval is unambiguous and applies to this document.
No post-approval drift: frontmatter (`type: INFRA`, `tags: [typescript]`) and Architecture Review section unchanged since GATE-WRITE PASS; no type/tags or Architecture Review modification after approval.
No implementation started: `## Tasks` confirms `.agents/tasks/INFRA-004.md` is 미생성 (not created); no NON-COMPLIANCE trigger.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress
Tasks file created: `.agents/tasks/INFRA-004.md` exists.
Tasks file path recorded: spec `## Tasks` section now links `.agents/tasks/INFRA-004.md` (placeholder replaced).
Tasks correspond to Completion Criteria: one task per TC-N — TC-01 (remove consumer-package names from "Consumed By", rg returns no consumer refs) and TC-02 (role-based Layer diagram rewrite + `pnpm harness:scan` exit 0).
Test Plan section present: `.agents/tasks/INFRA-004.md` contains a `## Test Plan` section measuring 924 chars (≥50 required by the test-plans scan [AF-24]); includes the 2-row TC table plus prose describing how each TC-N is verified.
No NON-COMPLIANCE: no implementation commits precede tasks file creation; this is a doc-only spec with no prior code edits.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying
Tasks complete: `.agents/tasks/INFRA-004.md` — both tasks (TC-01, TC-02) marked `[x]`; none blocked or pending.
Completion Criteria: spec `## Completion Criteria` TC-01 and TC-02 both `[x]`; `## Tasks` placeholder `[x]`.
TC-01 verified: `rg -n '@robota-sdk/agent-' packages/agent-core/docs/SPEC.md` → 2 matches, both permitted — line 16 (`@robota-sdk/agent-*` wildcard stating the zero-dependency rule, role-based, not a named consumer) and line 238 (`@robota-sdk/agent-core` self-reference). No specific consumer-package names (no `agent-session`/`agent-tools`/`agent-team`/`agent-plugin-*`).
TC-02 verified: `pnpm harness:scan` → SCAN_EXIT:0, all 23 scans passed.
Build/Test: N/A — doc-only change to `packages/agent-core/docs/SPEC.md`, no `packages/*` source modified, so `pnpm build` / `pnpm test` are not applicable.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

**Verification:** `rg -n '@robota-sdk/agent-' packages/agent-core/docs/SPEC.md` (run at GATE-VERIFY) → 2 matches, both permitted: line 16 `@robota-sdk/agent-*` wildcard (zero-dependency rule, role-based) and line 238 `@robota-sdk/agent-core` self-reference. Zero specific consumer-package names (`agent-session`/`agent-tools`/`agent-team`/`agent-plugin-*`). Exit 0.
**Test reference:** TC-01 is a command-form `rg` smoke assertion over `agent-core/docs/SPEC.md` (Test Plan row 1) — evidence is the grep assertion above; no separate test file required for a doc-only grep gate.
Completion Criteria checkbox TC-01 = `[x]`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

**Verification:** `pnpm harness:scan` → SCAN_EXIT:0, all 23 scans passed (run at GATE-VERIFY). "Consumed By" section and Layer diagram now describe consumers by role; phantom `agent-team` / `agent-plugin-*` names removed.
**Test reference:** TC-02 is a command-form `pnpm harness:scan` exit-0 smoke check (Test Plan row 2) — evidence is the scan result above; no separate test file required for a doc-only scan gate.
Completion Criteria checkbox TC-02 = `[x]`.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done
All Completion Criteria checked: TC-01 `[x]`, TC-02 `[x]`.
Per-TC Evidence: both TC-01 and TC-02 have `[GATE-COMPLETE: TC-N]` entries with the exact command, observed result, and exit code.
Test Plan addressed: both TC-N rows have a recorded test reference (command-form `rg` / `harness:scan` smoke checks); no row silently unaddressed.
User-Execution done-gate: N/A — spec has no `## User Execution Test Scenarios` section (doc-only correction, AF-01); Test Plan evidence (rg + harness:scan, verified at GATE-VERIFY) is the evidence.
Tasks file archived: `.agents/tasks/INFRA-004.md` → `.agents/tasks/completed/INFRA-004.md`.
`## Tasks` section updated to reference the archived path.
Prior-gate evidence chain complete: GATE-WRITE, GATE-APPROVAL, GATE-IMPLEMENT, GATE-VERIFY all PASS in this log.
