---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-009: Fix undeclared/incorrect mermaid nodes in architecture diagrams

> Source: INFRA-002 audit finding **AF-11** (P1, CONTRADICTION). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

Two architecture-map mermaid diagrams reference graph nodes that are never declared, so they render as
phantom nodes and (in one case) assert an edge that contradicts reality:

- `.agents/specs/architecture-map/dependency-direction.md` — edges use `Playground` (`ProductShells --> Playground`)
  and `TypeContracts` (`Assembly --> TypeContracts`, `TransportShells --> TypeContracts`) as endpoints,
  but neither node is declared in the flowchart's node list. The same diagram's node labels also carry
  the phantom `agent-team` (no such package) and present `auth`/`credits` without a planned marker.
- `.agents/specs/architecture-map/agent-system.md` — edges `IfaceTransport --> Core` and `IfaceTui --> Core`
  use undeclared nodes `IfaceTransport`/`IfaceTui`, AND the `--> Core` edges are factually wrong:
  `agent-interface-transport` / `agent-interface-tui` are zero-dependency type-contract packages and do
  NOT depend on `agent-core`.

**Reproduction condition:** open either file's mermaid block and check each edge endpoint against the
declared node list — `Playground`, `TypeContracts`, `IfaceTransport`, `IfaceTui` have no node declaration.

## Architecture Review

### Affected Scope

- `.agents/specs/architecture-map/dependency-direction.md`
- `.agents/specs/architecture-map/agent-system.md`
- (doc correction only — no `packages/*` production code)

### Alternatives Considered

1. **Delete the offending edges only.** Pro: smallest change, diagrams become valid. Con: loses real
   structural relationships (the interface-contract layer is a genuine part of the graph). Rejected.
2. **Declare the missing nodes correctly and fix the wrong edges** — add a `TypeContracts` node
   (`agent-interface-transport`, `agent-interface-tui`) and a `Playground` node (`agent-playground`),
   declare `IfaceTransport`/`IfaceTui`, and remove the incorrect `Iface* --> Core` edges (zero-dep
   packages). Also clean the node labels (drop phantom `agent-team`, mark `auth`/`credits` planned).
   Pro: diagrams become both valid AND accurate. Con: slightly larger edit. Chosen.

### Decision

Alternative 2 — make the diagrams valid (every edge endpoint declared) and accurate (no phantom package,
no false zero-dep→core edge). Node-label cleanups (phantom `agent-team`, planned `auth`/`credits`) are
included because they live in the same diagrams being edited (coherent single-diagram fix).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 2 architecture-map diagrams; no `packages/*` source
- [x] Sibling scan 완료 — N/A: diagram correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records valid-and-accurate over delete-only

## Solution

Edit both mermaid blocks so every edge endpoint resolves to a declared node, the interface-contract
packages appear as their own (zero-dep) node without a false `--> Core` edge, `agent-playground` is a
declared node, the phantom `agent-team` is removed, and `auth`/`credits` carry a planned marker.

## Affected Files

- `.agents/specs/architecture-map/dependency-direction.md`
- `.agents/specs/architecture-map/agent-system.md`

## Completion Criteria

- [x] TC-01: In both files' mermaid blocks, every edge endpoint (left/right of `-->`) is a declared node
      — verified by extracting declared node ids and edge endpoints and confirming the endpoint set is a
      subset of the declared-node set (zero undeclared endpoints).
- [x] TC-02: Neither diagram contains the phantom token `agent-team`; the interface packages
      (`agent-interface-transport`/`agent-interface-tui`) have no `--> Core`/`--> agent-core` edge.
- [x] TC-03: `pnpm harness:scan` exits 0 (incl. the conformance scan).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                            | Notes                                                                                                                                                                                               |
| ----- | ---------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | CI pipeline smoke test | node/`rg` script: edge endpoints ⊆ declared node ids in each mermaid block | Command-form: zero undeclared. Test ref: command-driven verification (no unit test file) — node script extracted declared node ids vs edge endpoints, endpoint set ⊆ declared set, zero undeclared. |
| TC-02 | CI pipeline smoke test | `rg` grep assertion over the 2 files                                       | Command-form: no agent-team / no Iface→Core. Test ref: `rg "agent-team"` exit 1 + `rg "Iface[A-Za-z]* --+> Core\|--+> agent-core"` exit 1 over both files.                                          |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                                 | doc-only change. Test ref: `pnpm harness:scan` exit 0 (24 scans incl. conformance PASS).                                                                                                            |

## Tasks

- [`.agents/tasks/completed/INFRA-009.md`](../../tasks/completed/INFRA-009.md) — archived (TC-01, TC-02, TC-03 + Test Plan)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix); `tags: [typescript]` present.
- Problem section: concrete symptoms (undeclared nodes `Playground`/`TypeContracts`/`IfaceTransport`/`IfaceTui`, false `Iface* --> Core` edge); reproduction condition present (check each edge endpoint vs declared node list); no TBD/TODO/vague language.
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit `N/A: diagram correction, not a command family`; 2 alternatives each with Pro/Con; Decision references trade-off (valid-and-accurate over delete-only).
- Completion Criteria: TC-01/TC-02/TC-03 all carry TC-N prefix; command/observable form; no banned vague terms.
- Test Plan: section present; 3 rows match 3 TC-N (count match); each row has non-empty Test Type and Tool/Approach, no "TBD"; no "manual" tool rows so Notes-justification N/A.
- Structure: Tasks section with placeholder present; Evidence Log empty before this run; no `## Status`/`## Classification` body sections.
- TC-N count: Completion Criteria = 3, Test Plan = 3 — confirmed match.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval present: user reviewed the follow-up sequencing plan (doc backlogs INFRA-009 → INFRA-008 → INFRA-011 → BEHAVIOR-004, then the decomposed INFRA-010 refactor layers) and replied verbatim: "승인". "승인" is on the explicit-approval list.
- Direct/unambiguous and directed at this spec: the approved sequencing plan leads with INFRA-009 as the first item to advance; approval authorizes advancing INFRA-009 to `approved`.
- No post-approval edits: frontmatter unchanged (`type: INFRA`, `tags: [typescript]`); Architecture Review Checklist intact (4/4 `[x]`, sibling scan `N/A`, 2 alternatives, decision rationale).
- NON-COMPLIANCE trigger clear: no implementation started — Tasks section shows `.agents/tasks/INFRA-009.md` not yet created (deferred to post-GATE-APPROVAL); no code edits/commits.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/INFRA-009.md`.
- Tasks file path recorded in spec `## Tasks` section (linked: `../../tasks/INFRA-009.md`).
- Tasks correspond to Completion Criteria — one task per TC-N: TC-01 (every edge endpoint resolves to a declared node), TC-02 (remove phantom `agent-team`, remove false `Iface* --> Core` edges, mark `auth`/`credits` planned), TC-03 (`pnpm harness:scan` exits 0).
- `## Test Plan` section present in tasks file with 518 chars (≥50) — satisfies the `test-plans` harness scan requirement [AF-24].
- NON-COMPLIANCE trigger clear: no implementation commits exist ahead of the tasks file; tasks file created as the first GATE-IMPLEMENT action.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks file `.agents/tasks/INFRA-009.md`: all 3 tasks `[x]` (TC-01, TC-02, TC-03); none blocked or pending. Spec `## Completion Criteria` TC-01/02/03 all `[x]`.
- TC-01: node script extracted declared node ids and edge endpoints from every mermaid block in both files; endpoint set ⊆ declared-node set with zero undeclared endpoints (dependency-direction block: declared 11, all 11 endpoints declared; agent-system block#0: declared 14, all endpoints declared incl. IfaceTransport/IfaceTui; agent-system block#1: declared 8, all declared). Result: TC-01 PASS.
- TC-02: `rg "agent-team"` over both files exit 1 (no match); `rg "Iface[A-Za-z]* --+> Core|--+> agent-core"` over both files exit 1 (no match). No phantom token, no false interface→core edge. Result: TC-02 PASS.
- TC-03: `pnpm harness:scan` exited 0 — all 24 scans passed incl. `conformance` (✅ Architecture conformance: PASS). Result: TC-03 PASS.
- Build/test: N/A — doc-only change to two architecture-map mermaid diagrams; no `packages/*` source touched.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

**Action:** node/`rg` script extracted declared node ids and edge endpoints from every mermaid block in both `dependency-direction.md` and `agent-system.md`, asserting endpoint set ⊆ declared-node set.
**Result observed:** zero undeclared endpoints (dependency-direction block: 11 declared / all 11 endpoints declared; agent-system block#0: 14 declared / all endpoints declared incl. `IfaceTransport`/`IfaceTui`; agent-system block#1: 8 declared / all declared). Exit code 0.
**Test reference:** command-driven verification (no unit test file) — endpoint-⊆-declared assertion via node script + `rg`. Recorded in `## Test Plan` TC-01 row.
Checkbox `[x]` confirmed in `## Completion Criteria`.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

**Action:** `rg "agent-team"` over both files; `rg "Iface[A-Za-z]* --+> Core|--+> agent-core"` over both files.
**Result observed:** both `rg` invocations exit 1 (no match) — no phantom `agent-team` token, no false interface→core edge. `auth`/`credits` carry planned marker.
**Test reference:** `rg` grep assertions recorded in `## Test Plan` TC-02 row.
Checkbox `[x]` confirmed in `## Completion Criteria`.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

**Action:** `pnpm harness:scan`.
**Result observed:** exit code 0 — all 24 scans passed including `conformance` (✅ Architecture conformance: PASS).
**Test reference:** `pnpm harness:scan` exit 0 recorded in `## Test Plan` TC-03 row.
Checkbox `[x]` confirmed in `## Completion Criteria`.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done
**Summary:**

- All 3 TC-N in `## Completion Criteria` are `[x]` (TC-01, TC-02, TC-03), each with a matching `[GATE-COMPLETE: TC-N]` Evidence entry (command + observed result + exit code).
- `## Test Plan` updated with a command-driven test reference for every TC-N row (TC-01/02/03); no row silently unaddressed.
- Tasks file archived: `.agents/tasks/INFRA-009.md` → `.agents/tasks/completed/INFRA-009.md`.
- `## Tasks` section updated to reference the archived path (`../../tasks/completed/INFRA-009.md`).
- User-Execution done-gate: N/A — doc-only correction (AF-11), no `## User Execution Test Scenarios` section.
