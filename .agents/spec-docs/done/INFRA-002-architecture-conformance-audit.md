---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-002: Architecture Conformance Audit & Improvement Proposal

## Problem

The repository declares its architecture across a multi-tier authority hierarchy:

1. `ARCHITECTURE.md` (root, SSOT entry point)
2. `.agents/project-structure.md` (package boundaries + dependency-direction rules)
3. `.agents/specs/ARCHITECTURE-MAP.md` → `.agents/specs/architecture-map/*.md` (9 focused subdocuments)
4. `packages/*/docs/SPEC.md` (17 package-level contracts)

These documents were authored and updated incrementally over many feature cycles (most recently the
FLOW-001~006 wakeup/scheduling stack, which added cross-package wiring between `agent-executor`,
`agent-framework`, `agent-command`, and `agent-cli`). There is currently **no evidence that the
documented architecture still matches the implemented system**. Concretely:

- Dependency-direction rules in `project-structure.md` (strict one-way, no pass-through re-exports,
  `agent-core` zero-deps, interface packages = types-only, composition-root exemption for `agent-cli`)
  are asserted in prose but not continuously verified against the actual `package.json` dependency
  graph and `import` statements.
- The architecture-map subdocuments (`dependency-direction.md`, `agent-system.md`,
  `transport-architecture.md`, `cross-cutting-contracts.md`, etc.) describe layer ownership and
  contracts that recent backlogs may have drifted from (e.g. new host-context bridges, new command
  modules, new background-task event surfaces).
- `.design/` carries draft/Korean documents (`package-ownership-and-import-rules.md`) and audit
  reports (`architecture-audit/`, `arch-map-audit/`) whose conclusions may already be stale or may
  contradict the canonical `.agents/` documents.
- Planned-but-uncreated packages (`packages/auth/`, `packages/credits/` from ADR-002) are referenced
  as if part of the live structure in some documents.

**Reproduction condition:** Run `pnpm harness:scan` and manually cross-read each architecture document
against the current `packages/*/package.json` dependencies and source imports — there is no single
report that records which claims hold, which have drifted, and which are outright contradicted.

This backlog does **not** fix the violations directly. Per the spec-before-code HARD GATE, fix specs
cannot be authored before the audit reveals concrete findings. The deliverable here is the audit
report + prioritized improvement proposal, from which follow-up fix backlogs are spun out.

## Architecture Review

### Affected Scope

Read-only audit producing documents. No production code changes in this backlog.

- **Audited inputs (read-only):**
  - `ARCHITECTURE.md`
  - `.agents/project-structure.md`
  - `.agents/specs/ARCHITECTURE-MAP.md`
  - `.agents/specs/architecture-map/*.md` (repository-overview, dependency-direction,
    capability-placement, agent-system, agent-team, transport-architecture,
    agent-cli-composition, apps-and-deployment, cross-cutting-contracts, architecture-lessons)
  - `packages/*/docs/SPEC.md` (17 files)
  - `packages/*/package.json` (dependency graph ground truth)
  - All `packages/*/src/**` `import` statements (boundary ground truth)
  - `.design/` architecture documents and prior audit reports
- **Produced outputs (new files):**
  - One audit report document (findings + evidence)
  - One improvement proposal document (prioritized remediation + follow-up backlog mapping)
- **Tooling used:** `pnpm harness:scan`, dependency-direction check, `rg` for import-graph extraction

### Alternatives Considered

1. **Single bundled backlog: audit + all fixes in one PR.**
   - Pro: one PR, one review.
   - Con: violates spec-before-code — fix specs cannot exist before findings are known; produces an
     unbounded, unreviewable diff mixing analysis with cross-package refactors; violates
     one-backlog-per-PR. Rejected.

2. **Audit-only backlog (this one) → produce improvement-proposal doc → spin out one fix backlog per
   actionable finding.**
   - Pro: respects spec-before-code (each fix gets its own spec authored from concrete evidence);
     keeps each PR scoped and reviewable; the audit report becomes a durable conformance baseline;
     findings get prioritized before committing implementation effort.
   - Con: more total backlogs/PRs; the fixing is deferred to follow-ups.

3. **Skip the document; just run `harness:scan` and fix whatever it flags.**
   - Pro: fastest.
   - Con: `harness:scan` only checks mechanical consistency (specs present, docs structure); it does
     not detect prose-vs-code architectural drift, stale subdocument claims, or doc-vs-doc
     contradictions. Misses the actual problem. Rejected.

### Decision

**Alternative 2.** This backlog is a read-only audit that produces (a) an architecture conformance
audit report and (b) a prioritized improvement proposal that maps each P0/P1 finding to a proposed
follow-up fix backlog (with type prefix). The actual remediation happens in those follow-up backlogs,
each authored from the concrete evidence this audit surfaces. Trade-off accepted: more backlogs, but
each stays within spec-before-code and one-backlog-per-PR.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — read-only audit; outputs are two new documents, no code change
- [x] Sibling scan 완료 — N/A: not a CLI command family; this is a repo-wide conformance audit
- [x] 대안 최소 2개 검토 완료 — 3 alternatives evaluated above
- [x] 결정 근거 문서화 완료 — Decision section records the spec-before-code rationale

## Solution

Produce two documents under a dated audit folder (proposed: `.design/architecture-audit/2026-06-13/`,
final location confirmed at GATE-IMPLEMENT):

1. **Conformance audit report** — for every canonical architecture document, enumerate its concrete
   structural claims and assign each a verdict against code reality:
   - `HOLDS` — claim matches implementation (cite confirming evidence: `file:line` or package.json dep).
   - `DRIFT` — claim is directionally right but stale/incomplete (cite the gap).
   - `VIOLATION` — code contradicts the claim (cite the offending `import` / dependency / `file:line`).
   - `CONTRADICTION` — two documents assert conflicting things (cite both).
   - `STALE` — claim references something that no longer / does not yet exist (e.g. planned packages).
     Each finding gets an ID (`AF-NN`), a severity (P0 blocks correctness/boundary integrity, P1 real
     drift, P2 cosmetic/doc-only), and evidence.

2. **Improvement proposal** — a prioritized remediation plan. For each P0/P1 finding: proposed fix,
   proposed follow-up backlog ID + type prefix (e.g. `BEHAVIOR-NNN`, `INFRA-NNN`), and whether the fix
   is a code change, a doc correction, or a rule/harness addition. Include a recommendation on whether
   any contradiction warrants a mechanical guard (per AGENTS.md "prefer a mechanical check over prose").

The dependency-graph ground truth is extracted mechanically: build the actual `agent-*` → `agent-*`
edge set from each `package.json` plus a `src/**` import scan, and diff it against the documented
one-way direction in `dependency-direction.md` / `project-structure.md`. `pnpm harness:scan` output is
captured verbatim as the mechanical-conformance baseline.

## Affected Files

- `.design/architecture-audit/2026-06-13/conformance-audit-report.md` (NEW — final path confirmed at GATE-IMPLEMENT)
- `.design/architecture-audit/2026-06-13/improvement-proposal.md` (NEW)
- (Read-only inputs: all architecture docs + `packages/*/package.json` + `packages/*/src/**` — not modified)

## Completion Criteria

- [x] TC-01: A conformance audit report file exists and contains one verdict row
      (`HOLDS`/`DRIFT`/`VIOLATION`/`CONTRADICTION`/`STALE`) for every canonical architecture document
      listed in Affected Scope (ARCHITECTURE.md, project-structure.md, ARCHITECTURE-MAP.md, all 9
      architecture-map subdocs, and each of the 17 `packages/*/docs/SPEC.md`); every non-`HOLDS` verdict
      cites evidence as a `file:line`, an import statement, or a `package.json` dependency.
      → `conformance-audit-report.md` §4 (per-document verdict summary; 3 authority + 10 arch-map +
      17 SPEC rows) and §5 (findings with `file:line` evidence).
- [x] TC-02: The report includes a mechanically-extracted `agent-*` dependency-edge set (from
      `package.json` + `src/**` import scan) diffed against the documented one-way direction, with every
      edge that violates the declared direction listed as a `VIOLATION` finding (or an explicit
      "no direction violations found" statement backed by the full edge list).
      → `conformance-audit-report.md` §3 (full 17-package edge set; "NO dependency-direction violations").
- [x] TC-03: `pnpm harness:scan` is executed and its full output is captured verbatim in the report as
      the mechanical-conformance baseline, with each reported issue reconciled into a finding or marked
      out-of-scope with a reason.
      → `harness-scan-baseline.txt` (verbatim, 23/23 exit 0); §2 reconciles `test-plans` (AF-24) +
      `file-size` (AF-25).
- [x] TC-04: Every finding has an `AF-NN` ID, a severity (`P0`/`P1`/`P2`), and a classification; the
      report ends with a counts-by-severity summary table.
      → `conformance-audit-report.md` §5 (AF-01..AF-25) + §6 (counts: P0=3, P1=11, P2=9, Process/Info=2).
- [x] TC-05: An improvement proposal file exists that, for every `P0` and `P1` finding, gives a
      proposed remediation and a proposed follow-up backlog ID + type prefix (code fix / doc correction /
      rule-or-harness guard), and states explicitly whether a mechanical guard is recommended.
      → `improvement-proposal.md` §2 (P0) + §3 (P1) with backlog IDs + per-finding mechanical-guard column.
- [x] TC-06: A follow-up draft backlog (`.agents/spec-docs/draft/<TYPE>-NNN-*.md`) is created for each
      `P0` finding, referencing its `AF-NN` source.
      → `INFRA-004` (AF-01), `INFRA-005` (AF-02), `INFRA-006` (AF-03) in `.agents/spec-docs/draft/`.

## Test Plan

Type INFRA + audit deliverable: verification is document-existence + content-assertion + a real
`harness:scan` run. No production code is changed, so there is no unit/integration code under test;
each TC is verified by inspecting the produced documents and re-running the captured commands.

| TC-ID | Test Type              | Tool / Approach                                                                                                               | Notes                                                                                                 |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TC-01 | manual                 | Document inspection — confirm a verdict row exists for every enumerated doc; spot-check 3 cited `file:line` evidences resolve | Coverage is the assertion; no automated test can judge audit completeness                             |
| TC-02 | manual                 | Re-derive the dependency edge set via `rg` + `package.json` parse and confirm it matches the report's table                   | Mechanical extraction is reproducible; reviewer re-runs the extraction command recorded in the report |
| TC-03 | CI pipeline smoke test | Run `pnpm harness:scan`; diff its live output against the verbatim capture in the report                                      | Command-form: `pnpm harness:scan` exit code + output captured                                         |
| TC-04 | manual                 | Document inspection — every finding has AF-NN + severity + classification; summary table sums correctly                       | Structural completeness check                                                                         |
| TC-05 | manual                 | Document inspection — every P0/P1 finding maps to a remediation + follow-up backlog ID + prefix                               | Cross-reference report findings ↔ proposal entries                                                    |
| TC-06 | manual                 | `ls .agents/spec-docs/draft/` shows one new draft per P0 finding, each citing its AF-NN                                       | Command-form: directory listing matches P0 count                                                      |

## Tasks

Task breakdown: [`.agents/tasks/completed/INFRA-002.md`](../../tasks/completed/INFRA-002.md) (archived at GATE-COMPLETE; one task per TC-01..TC-06)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags: [typescript]` present.
- Problem: concrete symptom (no single conformance report; `pnpm harness:scan` + manual cross-read required) + reproduction condition present; no TBD/TODO/vague single-sentence.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with explicit `N/A: not a CLI command family`; 3 Alternatives with pro/con each (≥2 required); Decision references trade-off (more backlogs vs. spec-before-code + one-backlog-per-PR).
- Completion Criteria: TC-01..TC-06 all TC-N prefixed; each command/observable form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: present; 6 rows for TC-01..TC-06 — count matches Completion Criteria (6 = 6); each row has non-empty Test Type + Tool/Approach; all 5 `manual` rows carry non-empty Notes justifying lack of automated test.
- Structure: Tasks section present with placeholder; Evidence Log present and empty; no `## Status` or `## Classification` body sections.
- Referenced docs verified to exist: ARCHITECTURE.md, .agents/project-structure.md, .agents/specs/ARCHITECTURE-MAP.md, 9 architecture-map subdocs, 17 `packages/*/docs/SPEC.md`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval: user was asked how to advance the two draft backlogs (INFRA-002, INFRA-003) through the gate pipeline and explicitly selected the option **"둘 다 GATE-APPROVAL까지"** (advance both through GATE-APPROVAL). This is a direct, unambiguous authorization covering INFRA-002.
- Approval directed at this spec document: INFRA-002 is one of the two explicitly named backlogs included in "both" (둘 다).
- No Architecture Review or frontmatter type/tags modified after approval: frontmatter remains `status: review-ready` / `type: INFRA` / `tags: [typescript]`; Architecture Review Checklist all `[x]` — unchanged since GATE-WRITE.
- NON-COMPLIANCE trigger (implementation started before gate): none — `.agents/tasks/INFRA-002.md` not yet created; Affected Files (audit report + improvement proposal) not yet produced. No implementation work begun.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/INFRA-002.md` exists (verified — did not exist prior to this gate run).
- Tasks file path recorded in spec `## Tasks` section: links to `.agents/tasks/INFRA-002.md` (relative `../../tasks/INFRA-002.md`).
- Tasks correspond to Completion Criteria (one task per TC-N): Plan section has 6 checkboxes mapping 1:1 to TC-01..TC-06 (6 = 6); each task restates its TC verdict/deliverable requirement.
- Task file follows task-tracking format: Status=in-progress, Created=2026-06-13, Objective, Plan, Progress (dated 2026-06-13), Decisions, Blockers, Result sections all present.
- NON-COMPLIANCE trigger (implementation commits exist but no tasks file): not triggered — no implementation commits exist; Affected Files outputs (audit report, improvement proposal, P0 draft backlogs) not yet produced. Tasks file now exists.

### [GATE-VERIFY] — ❌ FAIL | 2026-06-13

**Status remains:** in-progress
**Failed criteria:**

- Tasks file completion state: `.agents/tasks/INFRA-002.md` Plan section has 6 task checkboxes (TC-01..TC-06) — **all still `[ ]` unchecked** (lines 16, 20, 23, 25, 27, 30), despite the `## Result` section narrating the audit as complete. GATE-VERIFY requires every task marked `[x]`; FAIL trigger is "any task unchecked."
  **Required action:** Mark all 6 TC-01..TC-06 task checkboxes `[x]` in `.agents/tasks/INFRA-002.md` (the underlying work is verified complete — see deliverable evidence below), then re-run GATE-VERIFY.

**Deliverable evidence checked (all SATISFIED — only the checkbox state blocks PASS):**

- TC-01: `conformance-audit-report.md` §4 has per-document verdict rows — Authority tier (3: ARCHITECTURE.md, project-structure.md, ARCHITECTURE-MAP.md), Architecture-map subdocs (10 rows), Package SPECs (17/17). Every non-HOLDS verdict cites `file:line` / import / package.json evidence in §5. ✔
- TC-02: §3 lists the full 17-package `agent-*` edge set extracted from package.json, with explicit "**Result: NO dependency-direction violations.**"; `agent-core` + both `agent-interface-*` confirmed zero-dep. ✔
- TC-03: `harness-scan-baseline.txt` captures verbatim `pnpm harness:scan` (ends "all 23 scans passed"). §2 reconciles scan output into AF-24 (`test-plans`) + AF-25 (`file-size`). Live re-run of `pnpm harness:scan` = **exit 0, "all 23 scans passed"** (matches baseline). ✔
- TC-04: §5 findings AF-01..AF-25 each carry an `AF-NN` ID + severity (P0/P1/P2/Process-Info) + classification; §6 counts table sums P0=3, P1=11, P2=9, Process/Info=2, Total=25 (3+11+9+2=25 ✔). ✔
- TC-05: `improvement-proposal.md` §2 (P0) + §3 (P1) give per-finding remediation + proposed follow-up backlog ID + fix kind + a "Mechanical guard?" column for every P0/P1 finding. ✔
- TC-06: three P0 draft backlogs exist in `.agents/spec-docs/draft/` — `INFRA-004` (cites AF-01), `INFRA-005` (cites AF-02 + AF-08), `INFRA-006` (cites AF-03); each has valid `status: draft` / `type: INFRA` frontmatter. ✔

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks file completion state: `.agents/tasks/INFRA-002.md` Plan section has 6 task checkboxes (TC-01..TC-06) — **all now `[x]`** (lines 16, 20, 23, 25, 27, 30); `grep '\[ \]'` returns NONE, `grep -c '\[x\]'` = 6. The prior FAIL was solely unchecked boxes; that is now resolved.
- No tasks blocked or pending: `## Blockers` = `(none)`; no pending/blocked markers in the task file.
- Build/test for affected packages: read-only audit — `git status --porcelain -- packages/` returns ZERO changed production files (only audit docs, draft backlogs, and the task file changed). No `packages/*` production code was modified, so no affected package build/test is invalidated; there are no affected production packages under test.
- `pnpm harness:scan` (captured baseline command + TC-03 gate criterion): live re-run = **exit 0, "all 23 scans passed"**, matching `harness-scan-baseline.txt`.

**Deliverable evidence re-confirmed (all SATISFIED):**

- TC-01: `conformance-audit-report.md` §4 — Authority tier (ARCHITECTURE.md, project-structure.md, ARCHITECTURE-MAP.md), Architecture-map subdocs, Package SPECs (17/17 present, 17/17 English); non-HOLDS verdicts cite `file:line` / import / package.json evidence in §5. ✔
- TC-02: §3 full 17-package `agent-*` edge set extracted via `check-dependency-direction.mjs` + package.json; explicit "**Result: NO dependency-direction violations.**" ✔
- TC-03: `harness-scan-baseline.txt` ends "all 23 scans passed"; §2 reconciles scan output into AF-24 (`test-plans`) + AF-25 (`file-size`); live re-run exit 0. ✔
- TC-04: §5 findings AF-01..AF-25 each carry AF-NN ID + severity + classification; §6 counts table P0=3 / P1=11 / P2=9 / Process-Info=2 (sums to 25). ✔
- TC-05: `improvement-proposal.md` §2 (P0) + §3 (P1) give per-finding remediation + proposed follow-up backlog ID + fix kind + a "Mechanical guard?" column. ✔
- TC-06: three P0 drafts in `.agents/spec-docs/draft/` — `INFRA-004` (AF-01), `INFRA-005` (AF-02), `INFRA-006` (AF-03); each valid `status: draft` / `type: INFRA` frontmatter. ✔

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

This backlog is a read-only audit with NO "User Execution Test Scenarios" section, so the User-Execution done-gate does not apply. Per the spec Test Plan, verification for every TC is document-existence + content-assertion + command re-run — the Test Plan evidence is the document deliverables, already verified at GATE-VERIFY. No production code changed (`packages/*` untouched), so there is no unit/integration code under test.

**Completion Criteria — all `[x]`:** Completion Criteria TC-01..TC-06 all checked (`grep -cE '\[x\] TC-0'` over §Completion Criteria = 6/6).

**Per-TC verification + test reference / skip reason:**

- `[GATE-COMPLETE: TC-01]` Conformance report `.design/architecture-audit/2026-06-13/conformance-audit-report.md` exists (26,686 bytes); §4 carries per-document verdict rows (3 authority + 10 arch-map + 17 SPEC), non-HOLDS verdicts cite `file:line`/import/package.json in §5. Test: **skipped (audit deliverable)** — completeness is a document-inspection assertion, no automated test can judge audit coverage (Test Plan TC-01 = `manual`). ✔
- `[GATE-COMPLETE: TC-02]` §3 full 17-package `agent-*` edge set extracted via `scripts/harness/check-dependency-direction.mjs` + package.json; explicit "**Result: NO dependency-direction violations.**" Test: **mechanical re-run** — `node scripts/harness/check-dependency-direction.mjs` / `pnpm harness:scan` reproduces the clean edge set (Test Plan TC-02 = `manual` reproducible extraction). ✔
- `[GATE-COMPLETE: TC-03]` `harness-scan-baseline.txt` captures `pnpm harness:scan` verbatim; tail = "all 23 scans passed"; §2 reconciles output into AF-24 (`test-plans`) + AF-25 (`file-size`). Test reference: **command re-run** `pnpm harness:scan` → exit 0, "all 23 scans passed" (matches baseline). ✔
- `[GATE-COMPLETE: TC-04]` §5 findings AF-01..AF-25 each carry AF-NN ID + severity + classification; §6 counts table P0=3 / P1=11 / P2=9 / Process-Info=2 = 25. Test: **skipped (structural inspection)** — sum verified by hand (3+11+9+2=25); Test Plan TC-04 = `manual`. ✔
- `[GATE-COMPLETE: TC-05]` `improvement-proposal.md` (13,362 bytes) §2 (P0) + §3 (P1) give per-finding remediation + follow-up backlog ID + fix kind + "Mechanical guard?" column for every P0/P1 finding. Test: **skipped (cross-reference inspection)** — report findings ↔ proposal entries cross-checked; Test Plan TC-05 = `manual`. ✔
- `[GATE-COMPLETE: TC-06]` `ls .agents/spec-docs/draft/` → `INFRA-004` (cites AF-01), `INFRA-005` (cites AF-02), `INFRA-006` (cites AF-03) — one P0 draft per P0 finding (3 = 3), each `grep`-confirmed to cite its AF-NN. Test reference: **command re-run** directory listing matches P0 count (Test Plan TC-06 = `manual`). ✔

**Artifact actions performed by this gate:**

- Tasks file archived to `.agents/tasks/completed/INFRA-002.md` (filesystem move; source `.agents/tasks/INFRA-002.md` confirmed gone). The archived task file's Plan section retains all 6 TC checkboxes `[x]`.
- `## Tasks` section updated to point at the archived path `.agents/tasks/completed/INFRA-002.md`.
- `## Test Plan` rows are already annotated per TC above (test reference for TC-02/03/06 command re-runs; explicit skip reason for the `manual` audit-inspection TCs TC-01/04/05) — no silent unaddressed TC.

**Summary:** All 6 Completion Criteria `[x]` with a matching `[GATE-COMPLETE: TC-N]` evidence line; all 6 Test Plan TC rows have a test reference or explicit skip reason; all deliverables exist; full gate chain (WRITE → APPROVAL → IMPLEMENT → VERIFY → COMPLETE) recorded. Task file archived; `## Tasks` link updated. GATE-COMPLETE authorized.
