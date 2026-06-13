---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-011: Architecture doc P2 cleanup batch

> Source: INFRA-002 audit findings **AF-15, AF-16, AF-17, AF-21, AF-22, AF-23** (P2). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`. (AF-20 was already resolved by
> INFRA-007 — `agent-web-ui` SPEC title is correct.)

## Problem

Six low-severity cosmetic/accuracy drifts remain across architecture docs:

- **AF-15** `capability-placement.md:51-52` — `Assembly --> Adapters` and `Assembly --> Orchestration`
  are aspirational layer-ownership arrows, not actual package edges (`agent-framework` depends only on
  `agent-tools` among Adapters; not on `agent-provider`/`agent-plugin`/`agent-remote-client`). Readers may
  mistake them for real dependencies.
- **AF-16** `.agents/project-structure.md:78` — "`agent-framework` depends on `agent-interface-*` packages"
  (plural) overstates: only `agent-interface-transport` is wired, not `agent-interface-tui`.
- **AF-17** `.agents/specs/ARCHITECTURE-MAP.md:3` — "Source-verified against `develop` on 2026-05-07" is
  stale (~5 weeks old as of this audit).
- **AF-21** `packages/agent-framework/docs/SPEC.md` — the Scope statement omits `agent-interface-transport`
  from the list of packages it composes (it is a real dependency).
- **AF-22** `.agents/specs/architecture-map/repository-overview.md:15` — lists `agent-web (browser monitor)`
  as a package in the runtime family, but the package is `agent-web-ui` (`agent-web` is an app under `apps/`).
- **AF-23** `packages/agent-command/docs/SPEC.md:11` — "Transport layer … owned by `agent-transport-*`"
  uses the phantom split-package form; the package is the single `agent-transport`.

**Reproduction condition:** each cited `file:line` shows the stale/inaccurate text above.

## Architecture Review

### Affected Scope

- `.agents/specs/architecture-map/capability-placement.md`
- `.agents/project-structure.md`
- `.agents/specs/ARCHITECTURE-MAP.md`
- `packages/agent-framework/docs/SPEC.md`
- `.agents/specs/architecture-map/repository-overview.md`
- `packages/agent-command/docs/SPEC.md`
- (doc correction only — no `packages/*` production code)

### Alternatives Considered

1. **Leave the P2 items.** Pro: zero effort. Con: documented drift persists; the audit's tail is never
   closed; some (AF-22, AF-23) are stale package names that mislead. Rejected.
2. **Batch all six P2 fixes in one PR.** Pro: closes the audit tail in one reviewable doc-only change; no
   per-item PR overhead for trivial fixes. Con: touches six files (but each edit is a one-liner/note).
   Chosen — these are all cosmetic doc accuracy fixes with no interdependencies.

### Decision

Alternative 2 — one batched P2 cleanup PR. Note: AF-14 (the Interface Package Rule reality, adjacent to
AF-16's line 77) is intentionally NOT touched here — it is owned by the INFRA-010 refactor (extract
interface types to `agent-interface-*`), which will make that rule true rather than relaxing it.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 6 docs listed above; no `packages/*` source
- [x] Sibling scan 완료 — N/A: batched doc cleanup, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records batch-over-leave + the AF-14/INFRA-010 boundary

## Solution

- AF-15: add a note in `capability-placement.md` that the `Assembly -->` arrows to Adapters/Orchestration
  are ownership-policy arrows, not actual package edges (only `agent-framework → agent-tools` is real).
- AF-16: change `project-structure.md:78` plural to the real single `agent-interface-transport`.
- AF-17: update the `ARCHITECTURE-MAP.md` source-verified date to 2026-06-13.
- AF-21: add `agent-interface-transport` to the agent-framework SPEC Scope list.
- AF-22: in `repository-overview.md`, replace the `agent-web (browser monitor)` package entry with
  `agent-web-ui` and add `agent-interface-transport`/`agent-interface-tui`.
- AF-23: change agent-command SPEC `agent-transport-*` → `agent-transport`.

## Affected Files

- `.agents/specs/architecture-map/capability-placement.md`
- `.agents/project-structure.md`
- `.agents/specs/ARCHITECTURE-MAP.md`
- `packages/agent-framework/docs/SPEC.md`
- `.agents/specs/architecture-map/repository-overview.md`
- `packages/agent-command/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: AF-22/AF-23 stale names gone —
      `rg -n 'agent-web \(browser monitor\)' repository-overview.md` and
      `rg -n 'agent-transport-\*' packages/agent-command/docs/SPEC.md` both return nothing; the
      agent-framework SPEC Scope line names `agent-interface-transport` (AF-21).
- [x] TC-02: AF-15 note present in `capability-placement.md` (the Assembly→Adapters/Orchestration arrows
      are labelled ownership-policy, not package edges); AF-16 line names `agent-interface-transport`
      (not plural `agent-interface-*`); AF-17 date is `2026-06-13`.
- [x] TC-03: `pnpm harness:scan` exits 0 (incl. conformance).

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                      | Notes           |
| ----- | ---------------------- | ------------------------------------------------------------------------------------ | --------------- |
| TC-01 | CI pipeline smoke test | `rg` grep assertions over repository-overview / agent-command / agent-framework SPEC | Command-form    |
| TC-02 | CI pipeline smoke test | `rg` grep over capability-placement / project-structure / ARCHITECTURE-MAP           | Command-form    |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                                           | doc-only change |

## Tasks

- `.agents/tasks/completed/INFRA-011.md` — archived (TC-01, TC-02, TC-03 + Test Plan)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix); `tags: [typescript]` present.
Problem: concrete symptoms with `file:line` per AF-15/16/17/21/22/23; reproduction condition stated; no TBD/TODO/vague.
Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with explicit `N/A: batched doc cleanup, not a command family`; Alternatives Considered has 2 entries with pro/con each; Decision references batch-over-leave trade-off + AF-14/INFRA-010 boundary.
Completion Criteria: TC-01/TC-02/TC-03 all carry TC-N prefix; each is Command form (`rg`, `pnpm harness:scan`); no banned vague phrases.
Test Plan: section present; 3 rows match 3 TC-N (count matches); each row has non-empty Test Type and Tool/Approach; no row uses "manual" Tool so manual-notes requirement is N/A.
Structure: Tasks section present with placeholder; Evidence Log present and empty before this run; no `## Status`/`## Classification` body sections.
TC-N count: 3 in Completion Criteria == 3 in Test Plan.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved
Explicit approval: user approved the follow-up sequencing plan that explicitly includes INFRA-011 (the P2 cleanup batch) with "승인", and repeatedly directed continued execution with "진행해" / "계속 이어서 진행해" — all on the explicit-approval list.
Direct & unambiguous: the "승인" targets the sequencing plan that names INFRA-011; not a clarifying-question answer, not approval of a different item.
No post-approval drift: frontmatter unchanged (`status: review-ready`, `type: INFRA`, `tags: [typescript]`); Architecture Review section untouched since GATE-WRITE; only prior Evidence Log entry is GATE-WRITE (2026-06-13).
NON-COMPLIANCE check clear: no implementation work started before this gate — `.agents/tasks/INFRA-011.md` still `미생성`, no spec file edits or code commits exist.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress
Tasks file created: `.agents/tasks/INFRA-011.md` exists.
Path recorded in `## Tasks`: spec `## Tasks` section now links `.agents/tasks/INFRA-011.md` (replaced the `미생성` placeholder).
Tasks correspond to Completion Criteria: file has one task per TC-N — TC-01 (AF-21/22/23 stale names + framework Scope), TC-02 (AF-15/16/17 note/plural/date), TC-03 (`pnpm harness:scan` exit 0); 3 tasks == 3 TC-N in Completion Criteria.
Test Plan section present and ≥50 chars: `## Test Plan` section in the tasks file documents the command-driven `rg` / `harness:scan` approach per TC-N (well over 50 chars). [AF-24]

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying
Tasks file completion: `.agents/tasks/INFRA-011.md` — all 3 tasks (TC-01, TC-02, TC-03) marked `[x]`; none blocked or pending.
Spec `## Completion Criteria`: TC-01/TC-02/TC-03 all `[x]`.
TC-01: `rg 'agent-web \(browser monitor\)' repository-overview.md` → exit 1 (gone); `rg 'agent-transport-\*' packages/agent-command/docs/SPEC.md` → exit 1 (gone); agent-framework SPEC Scope line 5 names `agent-interface-transport` (present).
TC-02: AF-15 ownership-policy note present in `capability-placement.md:61` ("arrows are ownership policy, not package edges"); `project-structure.md:78` names singular `agent-interface-transport` (not plural `agent-interface-*`); `ARCHITECTURE-MAP.md:3` source-verified date reads `2026-06-13`.
TC-03: `pnpm harness:scan` → "all 24 scans passed", exit 0 (conformance core PASS, dependencyDirection pass).
Build/Test: N/A — doc-only change, no `packages/*` production code touched (per Affected Scope).

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

Verification command: `rg -n 'agent-web \(browser monitor\)' .agents/specs/architecture-map/repository-overview.md` → no match, exit 1 (stale entry gone); `rg -n 'agent-transport-\*' packages/agent-command/docs/SPEC.md` → no match, exit 1 (phantom split-package form gone); `rg -n 'agent-interface-transport' packages/agent-framework/docs/SPEC.md` → match at line 5 (Scope composition list names `agent-interface-transport`), exit 0.
Test reference: TC-01 is a CI pipeline smoke test (command-form `rg` assertions); no automated test file — verification is the grep commands above run directly against the doc files. Doc-only change, no unit test applicable.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

Verification command: `rg -n 'ownership' .agents/specs/architecture-map/capability-placement.md` → AF-15 note present at lines 61-62 ("arrows are ownership policy, not package edges"); `rg -n 'agent-interface-transport|agent-interface-\*' .agents/project-structure.md` → line 78 names the single `agent-interface-transport` (not plural in the dependency statement); `rg -n '2026-06-13|Source-verified' .agents/specs/ARCHITECTURE-MAP.md` → line 3 reads "Source-verified against `develop` on 2026-06-13".
Test reference: TC-02 is a CI pipeline smoke test (command-form `rg` assertions); no automated test file — verification is the grep commands above. Doc-only change, no unit test applicable.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

Verification command: `pnpm harness:scan` → "all 24 scans passed" (incl. conformance, dependencyDirection pass), exit code 0.
Test reference: TC-03 is the `pnpm harness:scan` CI smoke test itself — the harness scan is the automated verification; no separate test file required.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done
All Completion Criteria `[x]`: TC-01, TC-02, TC-03 confirmed checked.
Per-TC GATE-COMPLETE evidence recorded above (TC-01/TC-02 grep assertions + outputs; TC-03 harness:scan exit 0). Each TC-N row in `## Test Plan` is a command-form CI smoke test; verification is the command itself, recorded inline as the test reference (no unit-test file applicable — doc-only change).
User-Execution done-gate: N/A — spec has no `## User Execution Test Scenarios` section (doc-only P2 batch AF-15/16/17/21/22/23).
Tasks file archived: `.agents/tasks/INFRA-011.md` → `.agents/tasks/completed/INFRA-011.md` (git mv).
`## Tasks` section updated to reference the archived path `.agents/tasks/completed/INFRA-011.md`.
