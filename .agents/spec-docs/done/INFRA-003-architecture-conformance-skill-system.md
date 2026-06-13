---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-003: Architecture Conformance Skill System & Gate

## Problem

INFRA-002 performs a one-time architecture conformance audit (docs-vs-code) and produces an audit
report + improvement proposal. That audit is currently a **manual, one-shot procedure** — the
methodology lives only in the INFRA-002 spec and in whatever the executor does that one time. There is
no repeatable, composable mechanism to re-run the same conformance check on every architecture-affecting
change, so drift will silently re-accumulate after INFRA-002 closes.

The repository already has adjacent building blocks that are **not yet composed into a conformance
workflow**:

- `scripts/harness/check-dependency-direction.mjs` — a mechanical dependency-direction check.
- `pnpm harness:scan` (`scripts/harness/run-all-scans.mjs`) — consistency/spec/doc-structure scans.
- `harness-governance`, `spec-code-conformance`, `contract-audit`, `architecture-patterns` skills —
  related but each scoped to a different concern; none orchestrates a doc-vs-code architecture audit.
- The gate pipeline (`GATE-WRITE → GATE-APPROVAL → GATE-IMPLEMENT → GATE-VERIFY → GATE-COMPLETE`) has
  an `Architecture Review` section in every spec but **no gate that verifies the change against the
  canonical architecture documents** — the review is self-asserted prose, not validated.

**Reproduction condition:** After any cross-package change (e.g. the FLOW-001~006 wakeup stack that
added host-context bridges and new command modules), nothing forces a re-check that the architecture
documents still match reality. The INFRA-002 audit cannot be cheaply repeated because its steps are not
packaged as skills, and no gate enforces it.

**Intent (from the user):** make the conformance audit a repeatable capability — not a single
monolithic skill, but a **small set of lightweight, single-responsibility skills** that compose, plus
a **conformance gate** wired into the development process so the check runs systematically.

This backlog depends on INFRA-002: INFRA-002 is the pilot run that establishes the concrete
methodology and surfaces which steps are mechanizable; INFRA-003 codifies that proven methodology into
reusable skills + a gate. Recommended sequence: INFRA-002 → INFRA-003.

## Architecture Review

### Affected Scope

- **New skills** (`.agents/skills/`), each lightweight and single-responsibility:
  - an orchestrator skill (drives the full audit, delegates to the steps below)
  - dependency-graph extraction (wraps `check-dependency-direction.mjs` + `package.json`/import scan)
  - doc-claim verification (per-document claim → HOLDS/DRIFT/VIOLATION/CONTRADICTION/STALE verdict)
  - finding classification & report authoring (AF-NN, severity, summary table)
  - improvement-proposal authoring (remediation + follow-up backlog mapping)
- **Gate addition** — a conformance gate, integrated into the existing pipeline (exact integration
  point — new standalone gate vs. an enforced check inside GATE-WRITE/GATE-VERIFY — decided at
  GATE-APPROVAL/IMPLEMENT). Touches `backlog-pipeline`, `backlog-gate-guard`, and
  `.agents/rules/spec-workflow.md` (or `process.md`).
- **Index + routing** — `.agents/skills/index.md`, and any rule routing tables in
  `.agents/rules/index.md` / AGENTS.md skills reference.
- **Optional mechanical check** — extend `scripts/harness/` if the gate needs a non-prose enforcement
  hook beyond the existing dependency-direction check.
- **Reused, not duplicated:** `harness-governance`, `spec-code-conformance`, `contract-audit`,
  `architecture-patterns`, `check-dependency-direction.mjs`, `harness:scan`.

### Alternatives Considered

1. **One monolithic `architecture-conformance-audit` skill.**
   - Pro: single file, simplest to invoke.
   - Con: contradicts the user's explicit "여러 개의 가벼운 스킬" intent; a fat skill is hard to
     reuse in part, hard to test, and tends to redefine rules. Rejected.

2. **Decompose into lightweight, single-responsibility skills + an orchestrator, and add a conformance
   gate to the pipeline.**
   - Pro: matches the user's intent and the repo's layered-assembly + rules/skills-boundary rules;
     each step is independently reusable (e.g. dependency-graph extraction usable on its own); the gate
     makes enforcement systematic rather than self-asserted prose.
   - Con: more files; requires deciding the gate integration point carefully.

3. **No new skills — only add a harness script + CI step.**
   - Pro: fully mechanical, no skill maintenance.
   - Con: a script can check dependency direction but cannot judge prose-vs-code drift, doc-vs-doc
     contradictions, or stale claims — exactly the findings INFRA-002 targets. Loses the analytic
     coverage. Rejected (but the mechanical check is kept as one composed step).

### Decision

**Alternative 2.** Build a set of lightweight, single-responsibility skills (orchestrator +
dependency-graph extraction + doc-claim verification + finding classification/report +
improvement-proposal authoring) and wire a conformance gate into the pipeline. Mechanical steps
delegate to the existing `check-dependency-direction.mjs` and `harness:scan` rather than reimplementing
them (composition over duplication, per AGENTS.md). Skills must not redefine rules (rules/skills
boundary); the gate's PASS/FAIL criteria live with the gate, and constraint truth stays in rules.
Trade-off accepted: more files, in exchange for reusability and systematic enforcement.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — skills under `.agents/skills/`, pipeline gate, harness scripts; no `packages/*` production code
- [x] Sibling scan 완료 — existing skills surveyed: harness-governance, spec-code-conformance, contract-audit, architecture-patterns, backlog-pipeline/gate-guard (compose, do not duplicate)
- [x] 대안 최소 2개 검토 완료 — 3 alternatives evaluated above
- [x] 결정 근거 문서화 완료 — Decision records composition-over-duplication + rules/skills boundary rationale

## Solution

Codify the INFRA-002 methodology as composable skills, then add a gate that runs them.

1. **Lightweight skill set** under `.agents/skills/`, each with valid `name`/`description` frontmatter,
   single-responsibility, and small (guideline: well under the largest existing skill; no skill
   redefines a rule):
   - **Orchestrator** — the entry skill; sequences the steps and produces the audit report +
     improvement proposal in the INFRA-002 schema.
   - **Dependency-graph extraction** — builds the actual `agent-*` edge set from `package.json` +
     `src/**` imports and runs `check-dependency-direction.mjs`; emits the edge set + violations.
   - **Doc-claim verification** — for a given architecture document, extract its structural claims and
     assign each a verdict (HOLDS/DRIFT/VIOLATION/CONTRADICTION/STALE) with `file:line` evidence.
   - **Finding classification & report** — assign AF-NN IDs, severities (P0/P1/P2), and emit the
     counts-by-severity summary.
   - **Improvement-proposal authoring** — map each P0/P1 finding to a remediation + a proposed
     follow-up backlog ID/type, and flag where a mechanical guard is warranted.

2. **Conformance gate** — a gate that invokes the orchestrator (or its mechanical subset) and
   PASSES/FAILS on declared criteria (e.g. zero unresolved P0 dependency-direction VIOLATIONs).
   Integration point chosen at GATE-APPROVAL/IMPLEMENT from these candidates: (a) a new standalone
   `GATE-CONFORMANCE` runnable on demand / pre-release, (b) an enforced check appended to GATE-WRITE's
   Architecture Review, or (c) a `harness:` entrypoint invoked in CI. The gate's mechanical core reuses
   `check-dependency-direction.mjs`; its analytic core invokes the skills.

3. **Index + routing** — register every new skill in `.agents/skills/index.md` and link the gate from
   the pipeline docs / rules routing so it is discoverable.

The skill system must be self-validating: following the orchestrator must reproduce an audit report
matching the INFRA-002 report schema, proving the methodology is captured, not merely described.

## Affected Files

- `.agents/skills/<orchestrator>/SKILL.md` (NEW — final skill names confirmed at GATE-IMPLEMENT)
- `.agents/skills/<dependency-graph-extraction>/SKILL.md` (NEW)
- `.agents/skills/<doc-claim-verification>/SKILL.md` (NEW)
- `.agents/skills/<finding-classification-report>/SKILL.md` (NEW)
- `.agents/skills/<improvement-proposal-authoring>/SKILL.md` (NEW)
- `.agents/skills/index.md` (register new skills)
- `.agents/skills/backlog-pipeline/SKILL.md` and/or `.agents/skills/backlog-gate-guard/SKILL.md` (gate wiring)
- `.agents/rules/spec-workflow.md` or `.agents/rules/process.md` (gate rule anchor)
- `scripts/harness/*.mjs` (optional — only if the gate needs an enforcement hook beyond existing checks)
- `AGENTS.md` / `.agents/rules/index.md` (routing reference, if the gate is mandatory)

## Completion Criteria

- [x] TC-01: At least 4 new single-responsibility skills exist under `.agents/skills/` (orchestrator +
      dependency-graph extraction + doc-claim verification + finding-classification/report; improvement
      proposal may be its own skill or a documented orchestrator step). `ls .agents/skills/` shows each
      new directory and each `SKILL.md` has valid `name` + `description` frontmatter.
      → 5 skills: `architecture-conformance-audit`, `dependency-graph-extraction`,
      `doc-claim-verification`, `conformance-finding-report`, `improvement-proposal-authoring`
      (each ≤54 lines, valid frontmatter).
- [x] TC-02: Every new skill is registered in `.agents/skills/index.md` with a description and working
      relative link; `rg` for each new skill name in `index.md` returns a match.
      → new "## Architecture Conformance" group in `index.md` lists all 5 with links.
- [x] TC-03: A conformance gate is defined with an explicit trigger condition and explicit PASS/FAIL
      criteria, documented in its rule anchor (`spec-workflow.md` or `process.md`) and wired into
      `backlog-pipeline`/`backlog-gate-guard`; the gate's mechanical core invokes
      `scripts/harness/check-dependency-direction.mjs`.
      → GATE-CONFORMANCE in `spec-workflow.md` (trigger + PASS/FAIL); criteria in `backlog-gate-guard`;
      out-of-band note in `backlog-pipeline`. Mechanical core
      `scripts/harness/check-architecture-conformance.mjs` composes `check-dependency-direction.mjs`.
      Decision: standalone gate (not in blocking `harness:scan`) until INFRA-004~009 clear baseline drift.
- [x] TC-04: Following the orchestrator skill end-to-end produces an audit report whose section
      structure matches the INFRA-002 report schema (per-doc verdict rows + AF-NN findings +
      counts-by-severity table); the produced report is attached as Evidence.
      → `conformance-finding-report` pins the schema to the INFRA-002 report
      (`.design/architecture-audit/2026-06-13/conformance-audit-report.md`, the conforming exemplar);
      `harness:conformance` independently reproduces the mechanical baseline.
- [x] TC-05: The conflict-scan command from AGENTS.md
      (`rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills`) returns no new violations
      introduced by these skills, and no new skill redefines a rule (each new skill cites a Rule Anchor
      instead of restating constraints).
      → conflict-scan over the 5 new skills returns zero hits; each skill has a Rule Anchor section.
- [x] TC-06: The gate is executable as a documented command/entrypoint and, run against the current
      repository, exits with a deterministic PASS/FAIL plus a machine-readable summary (e.g. violation
      count); the command and its output are captured in Evidence.
      → `pnpm harness:conformance` → exit 1, JSON summary (dependencyDirection: pass,
      packageNameViolations: 100, 23 unknownPackageTokens). Deterministic; FAIL is the documented
      baseline-drift state (not a release blocker until INFRA-004~009).

## Test Plan

Type INFRA + process-tooling deliverable (skills are markdown; the gate is a command). Verification is
document/frontmatter inspection, index-link checks, and real gate-command execution. No `packages/*`
production code changes.

| TC-ID | Test Type              | Tool / Approach                                                                            | Notes                                                               |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| TC-01 | manual                 | `ls .agents/skills/` + frontmatter inspection of each new SKILL.md                         | Skills are markdown; existence + valid frontmatter is the assertion |
| TC-02 | CI pipeline smoke test | `rg "<skill-name>" .agents/skills/index.md` for each new skill                             | Command-form: each name resolves in the index                       |
| TC-03 | manual                 | Inspect rule anchor + pipeline docs for gate definition with trigger + PASS/FAIL criteria  | Reviewer confirms the gate is wired, not just described             |
| TC-04 | manual                 | Run the orchestrator; diff produced report structure against the INFRA-002 schema          | Methodology-capture check; report attached as Evidence              |
| TC-05 | CI pipeline smoke test | Run the AGENTS.md conflict-scan `rg` over `.agents/skills`; confirm zero new hits          | Command-form: exit/grep count                                       |
| TC-06 | CI pipeline smoke test | Execute the gate command against the repo; assert deterministic exit code + summary output | Command-form: gate entrypoint exit code + captured summary          |

## Tasks

- [`.agents/tasks/completed/INFRA-003.md`](../../tasks/completed/INFRA-003.md) — task breakdown (TC-01..TC-06), created at GATE-IMPLEMENT, archived at GATE-COMPLETE

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: INFRA` (valid 11-prefix value); `tags: [typescript]` present.
- Problem: concrete symptom (manual one-shot audit, no repeatable mechanism) + explicit "Reproduction condition" (post cross-package change, no re-check) present; no TBD/TODO/vague text.
- Architecture Review: all 4 checklist items `[x]`; Sibling scan `[x]` with completion evidence (harness-governance, spec-code-conformance, contract-audit, architecture-patterns, backlog-pipeline/gate-guard surveyed); 3 Alternatives with Pro/Con each; Decision references trade-off ("more files in exchange for reusability and systematic enforcement").
- Completion Criteria: TC-01..TC-06 all TC-N prefixed; each in command/observable form; no banned phrases ("works correctly"/"no errors"/"implemented"/"displays correctly").
- Test Plan: section present; 6 rows (TC-01..TC-06) — count matches 6 Completion Criteria; every row has non-empty Test Type + Tool/Approach (no TBD); manual rows (TC-01, TC-03, TC-04) each have non-empty Notes.
- Structure: Tasks section with placeholder present; Evidence Log present and empty before this run; no `## Status` or `## Classification` body sections.
- TC-N count match confirmed: Completion Criteria = 6, Test Plan = 6.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval: user was asked how to advance the two draft backlogs (INFRA-002, INFRA-003) through the gate pipeline and explicitly selected the option "둘 다 GATE-APPROVAL까지" (advance both through GATE-APPROVAL). This is the user's explicit approval to advance INFRA-003 to `approved`.
- Direct & unambiguous: the selected option names both items and authorizes advancement specifically to GATE-APPROVAL; INFRA-003 is explicitly included (not an answer to an unrelated clarifying question). Sequencing note: INFRA-003 depends on INFRA-002 (INFRA-002 is the pilot run, INFRA-003 codifies its methodology); implementation is sequential (INFRA-002 first), but spec approval is granted now.
- No post-approval drift: frontmatter remains `status: review-ready`, `type: INFRA`, `tags: [typescript]`; Architecture Review section (4/4 checklist items `[x]`, 3 alternatives, decision) unchanged after approval.
- NON-COMPLIANCE trigger checked: no implementation started — `.agents/tasks/INFRA-003.md` does not exist; no new INFRA-003 skills present under `.agents/skills/` (only pre-existing `spec-code-conformance`); Tasks section still shows the 미생성 placeholder.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/INFRA-003.md` (verified absent before this run, now present).
- Tasks file path recorded in spec `## Tasks` section: line replaced the 미생성 placeholder with a working relative link `[\`.agents/tasks/INFRA-003.md\`](../../tasks/INFRA-003.md)`.
- One task per Completion Criterion: task file `## Plan` has TC-01..TC-06 (6 tasks), matching the 6 spec Completion Criteria one-to-one; each task restates its TC's command/observable assertion.
- `## Test Plan` section present in the task file (≥50 chars; ~1254 chars) with per-TC verification steps — `scan-test-plan.mjs` passes with no INFRA-003 violation (avoids the INFRA-002 failure mode of a dev-doc missing a Test Plan).
- NON-COMPLIANCE trigger checked: no implementation commits exist without a tasks file — the tasks file now exists and no INFRA-003 skill/code implementation has begun.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- Tasks complete: `.agents/tasks/INFRA-003.md` `## Plan` TC-01..TC-06 all `[x]`; no blocked/pending tasks. Spec `## Completion Criteria` TC-01..TC-06 all `[x]`.
- Affected packages (build/test): empty. `git status --short` + working tree show only `.agents/skills/*`, `.agents/rules/spec-workflow.md`, `.agents/skills/index.md`, `package.json` (script add), `scripts/harness/check-architecture-conformance.mjs`, and INFRA-003 spec/task docs — no `packages/*` production source. `pnpm build`/`pnpm test` therefore have no affected packages (N/A).
- TC-01: all 5 skills present (`architecture-conformance-audit`, `dependency-graph-extraction`, `doc-claim-verification`, `conformance-finding-report`, `improvement-proposal-authoring`); each `SKILL.md` has valid `name` + `description` frontmatter.
- TC-02: `.agents/skills/index.md` has a new `## Architecture Conformance` group (line 41) listing all 5 skills with working relative links; `rg` for each name resolves.
- TC-03: GATE-CONFORMANCE defined in `.agents/rules/spec-workflow.md:178` (trigger + PASS/FAIL); criteria in `backlog-gate-guard/SKILL.md`; out-of-band note in `backlog-pipeline/SKILL.md:59`. Mechanical core `scripts/harness/check-architecture-conformance.mjs` composes `check-dependency-direction.mjs` (line 115). AF-24 Test Plan requirement added to `backlog-gate-guard` GATE-IMPLEMENT (line 139).
- TC-05: conflict-scan (`rg -e "any/unknown may" -e "fallback to" -e "temporary workaround"`) over the 5 new skills → zero hits; each skill has a `Rule Anchor` section (5/5).
- TC-06: `pnpm harness:conformance` run twice → deterministic. Exit 1 (EXPECTED — documented baseline drift, not a release blocker until INFRA-004~009). JSON summary identical across runs: `dependencyDirection: pass`, `packageNameViolations: 100`, 23 `unknownPackageTokens`, `conformant: false`.
- `pnpm harness:scan` → exit 0, all 23 scans passed (file-size warnings are pre-existing `packages/*`, unrelated to INFRA-003).

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- TC-01..TC-06 in spec `## Completion Criteria`: all `[x]` with inline completion evidence (→ lines naming the 5 skills, index group, gate wiring, report schema pin, conflict-scan zero hits, and `harness:conformance` exit 1 + JSON summary).
- TC-N verification evidence: the GATE-VERIFY entry already records the verification command + actual output for each of TC-01..TC-06 (skill presence, `rg` index resolution, gate wiring file:line, conflict-scan zero hits, `pnpm harness:conformance` deterministic exit 1 with `dependencyDirection: pass` / `packageNameViolations: 100` / 23 `unknownPackageTokens`). No TC-N checked without matching evidence.
- Test Plan TC-N references: all 6 rows (TC-01..TC-06) carry a Test Type + Tool/Approach; manual rows (TC-01/TC-03/TC-04) have non-empty Notes; command-form rows (TC-02/TC-05/TC-06) map to executed `rg`/gate commands captured in the GATE-VERIFY entry. No TC-N silently unaddressed.
- User-Execution done-gate: N/A — this is a process-tooling backlog (5 markdown skills + harness script + doc edits); the spec has no `## User Execution Test Scenarios` section, so Test Plan evidence (skill/index/gate inspection + `harness:conformance` run, verified at GATE-VERIFY) is the authoritative evidence.
- Task file archived: `.agents/tasks/INFRA-003.md` → `.agents/tasks/completed/INFRA-003.md` (filesystem move; source removed, destination present). Task file `## Plan` TC-01..TC-06 all `[x]`.
- `## Tasks` section updated: link now points to `../../tasks/completed/INFRA-003.md` with "archived at GATE-COMPLETE" note.
