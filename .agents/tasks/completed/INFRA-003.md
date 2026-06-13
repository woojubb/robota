# INFRA-003: Architecture Conformance Skill System & Gate

- **Status**: in-progress
- **Created**: 2026-06-13
- **Branch**: (TBD — feature branch off develop)
- **Scope**: `.agents/skills/`, `.agents/skills/index.md`, `backlog-pipeline`/`backlog-gate-guard`, `.agents/rules/spec-workflow.md` or `process.md`, `scripts/harness/*` (optional); no `packages/*` production code

## Objective

Codify the INFRA-002 conformance methodology as a set of lightweight, single-responsibility,
composable skills plus a conformance gate wired into the development pipeline, so the doc-vs-code
architecture audit becomes a repeatable, systematically enforced capability rather than a one-shot
manual procedure. Depends on INFRA-002 (the pilot run); implement after INFRA-002 lands.

## Plan

- [x] TC-01: Author at least 4 new single-responsibility skills under `.agents/skills/` (orchestrator +
      dependency-graph extraction + doc-claim verification + finding-classification/report; improvement
      proposal may be its own skill or a documented orchestrator step). Each `SKILL.md` has valid
      `name` + `description` frontmatter; `ls .agents/skills/` shows each new directory.
- [x] TC-02: Register every new skill in `.agents/skills/index.md` with a description and a working
      relative link; `rg` for each new skill name in `index.md` returns a match.
- [x] TC-03: Define a conformance gate with an explicit trigger condition and explicit PASS/FAIL criteria,
      documented in its rule anchor (`spec-workflow.md` or `process.md`) and wired into
      `backlog-pipeline`/`backlog-gate-guard`; the gate's mechanical core invokes
      `scripts/harness/check-dependency-direction.mjs`. (Integration point — standalone GATE-CONFORMANCE
      vs. enforced check inside GATE-WRITE/GATE-VERIFY vs. `harness:` CI entrypoint — decided here.)
- [x] TC-04: Follow the orchestrator skill end-to-end and confirm it produces an audit report whose
      section structure matches the INFRA-002 report schema (per-doc verdict rows + AF-NN findings +
      counts-by-severity table); attach the produced report as Evidence.
- [x] TC-05: Run the AGENTS.md conflict-scan
      (`rg -n "any/unknown may|fallback to|temporary workaround" .agents/skills`) and confirm no new
      violations are introduced; confirm no new skill redefines a rule (each cites a Rule Anchor instead
      of restating constraints).
- [x] TC-06: Make the gate executable as a documented command/entrypoint; run it against the current
      repository and confirm a deterministic PASS/FAIL plus a machine-readable summary (e.g. violation
      count); capture the command and its output as Evidence.

## Test Plan

Type INFRA + process-tooling deliverable: the skills are markdown and the gate is a command, so
verification is document/frontmatter inspection, index-link checks, and real gate-command execution.
There are no `packages/*` production code changes. The authoritative TC table lives in the spec's
`## Test Plan`; each TC is verified as follows:

- TC-01: `ls .agents/skills/` shows each new skill directory; inspect each new `SKILL.md` for valid
  `name` + `description` frontmatter.
- TC-02: `rg "<skill-name>" .agents/skills/index.md` returns a match for every new skill (CI smoke test).
- TC-03: inspect the rule anchor + pipeline docs and confirm the gate is wired with a trigger condition
  and explicit PASS/FAIL criteria, and that its mechanical core invokes `check-dependency-direction.mjs`.
- TC-04: run the orchestrator and diff the produced report's section structure against the INFRA-002
  schema (per-doc verdict rows + AF-NN findings + counts-by-severity table); attach the report.
- TC-05: run the conflict-scan `rg` over `.agents/skills` and confirm zero new hits (CI smoke test).
- TC-06: execute the gate command against the repo and assert a deterministic exit code + summary output
  (CI smoke test); capture the command and output.

## Progress

### 2026-06-13

- Task file created at GATE-IMPLEMENT. Status set to in-progress.

## Decisions

- Decompose the audit into lightweight single-responsibility skills + an orchestrator + a conformance
  gate (spec Decision: Alternative 2) — composition over duplication; mechanical steps delegate to the
  existing `check-dependency-direction.mjs` and `harness:scan`; skills cite Rule Anchors and never
  redefine rules (rules/skills boundary).
- Gate integration point (standalone vs. enforced check vs. CI entrypoint) is a TC-03 decision, to be
  recorded here when made.

## Blockers

- Sequencing: depends on INFRA-002 landing first (INFRA-002 establishes the concrete methodology that
  INFRA-003 codifies).

## Result

Built the architecture-conformance skill system + gate:

- **5 lightweight skills** under `.agents/skills/`: `architecture-conformance-audit` (orchestrator),
  `dependency-graph-extraction`, `doc-claim-verification`, `conformance-finding-report`,
  `improvement-proposal-authoring` (each ≤54 lines, single-responsibility, cites a Rule Anchor).
  Registered in `index.md` under a new "Architecture Conformance" group.
- **GATE-CONFORMANCE** defined in `spec-workflow.md` (trigger + PASS/FAIL), criteria in
  `backlog-gate-guard`, out-of-band note in `backlog-pipeline`.
- **Mechanical core** `scripts/harness/check-architecture-conformance.mjs` (`pnpm harness:conformance`):
  composes `check-dependency-direction.mjs` + a workspace-package-name guard; emits a machine-readable
  JSON summary. Run against the repo → exit 1, 100 package-name violations / 23 unknown tokens
  (the INFRA-002 baseline drift — more exhaustive than the manual audit).
- **AF-24 fixed**: `backlog-gate-guard` GATE-IMPLEMENT now requires a `## Test Plan` section in the
  task file (the prior INFRA-002 task file tripped the `test-plans` scan without one).

Decision (TC-03 integration point): **standalone gate**, NOT in the blocking `harness:scan` aggregate,
until INFRA-004~009 clear the baseline drift; promote to the aggregate once `harness:conformance` exits 0.

`pnpm harness:scan` → 23/23 exit 0. Follow-up: promote the gate into CI after the P0/P1 doc-correction
backlogs land.
