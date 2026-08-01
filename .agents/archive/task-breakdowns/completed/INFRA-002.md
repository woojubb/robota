# INFRA-002: Architecture Conformance Audit & Improvement Proposal

- **Status**: in-progress
- **Created**: 2026-06-13
- **Branch**: (TBD — feature branch off develop)
- **Scope**: repo-wide read-only audit; outputs under `.design/architecture-audit/2026-06-13/` + `.agents/spec-docs/draft/`

## Objective

Produce a read-only architecture conformance audit report and a prioritized improvement proposal
that verify every canonical architecture document against code reality (dependency graph + imports),
capture the `pnpm harness:scan` baseline, and spin out a follow-up draft backlog for each P0 finding.

## Plan

- [x] TC-01: Produce conformance audit report with one verdict row (HOLDS/DRIFT/VIOLATION/CONTRADICTION/STALE)
      for every canonical architecture document (ARCHITECTURE.md, project-structure.md, ARCHITECTURE-MAP.md,
      all 9 architecture-map subdocs, each of the 17 `packages/*/docs/SPEC.md`); every non-HOLDS verdict cites
      evidence as `file:line`, an import statement, or a `package.json` dependency.
- [x] TC-02: Mechanically extract the `agent-*` dependency-edge set (from `package.json` + `src/**` import scan),
      diff against documented one-way direction, and list every direction-violating edge as a VIOLATION
      (or an explicit "no direction violations found" backed by the full edge list).
- [x] TC-03: Execute `pnpm harness:scan` and capture its full output verbatim as the mechanical-conformance
      baseline; reconcile each reported issue into a finding or mark out-of-scope with a reason.
- [x] TC-04: Give every finding an `AF-NN` ID, a severity (P0/P1/P2), and a classification; end the report
      with a counts-by-severity summary table.
- [x] TC-05: Produce improvement proposal that, for every P0/P1 finding, gives a remediation + proposed
      follow-up backlog ID + type prefix (code fix / doc correction / rule-or-harness guard), and states
      explicitly whether a mechanical guard is recommended.
- [x] TC-06: Create one follow-up draft backlog (`.agents/spec-docs/draft/<TYPE>-NNN-*.md`) for each P0 finding,
      referencing its `AF-NN` source.

## Test Plan

Verification per TC (see spec `## Test Plan` for the authoritative table). This is a read-only audit
producing documents — no `packages/*` production code changes — so each TC is verified by inspecting
the produced documents and re-running the captured commands:

- TC-01/04: document inspection — a verdict row exists for every enumerated architecture doc; every
  finding carries an `AF-NN` ID + severity; the counts-by-severity summary table sums correctly.
- TC-02: re-derive the `agent-*` dependency edge set via `node scripts/harness/check-dependency-direction.mjs`
  - `package.json`/import scan and confirm it matches the report's table.
- TC-03: `pnpm harness:scan` is executed; its verbatim output is captured and each issue reconciled.
- TC-05: cross-reference each P0/P1 finding to a remediation + follow-up backlog ID in the proposal.
- TC-06: `ls .agents/spec-docs/draft/` shows one new draft per P0 finding, each citing its `AF-NN`.

## Progress

### 2026-06-13

- Task file created at GATE-IMPLEMENT. Status set to in-progress.

## Decisions

- Audit-only backlog (spec Decision: Alternative 2) — fixes deferred to follow-up backlogs authored
  from concrete evidence, respecting spec-before-code and one-backlog-per-PR.

## Blockers

- (none)

## Result

Audit complete. Deliverables under `.design/architecture-audit/2026-06-13/`:

- `conformance-audit-report.md` — per-document verdicts for all 30 canonical docs (3 authority + 10
  architecture-map + 17 package SPECs), 25 findings (AF-01..AF-25), counts P0=3 / P1=11 / P2=9 / Info=2.
- `improvement-proposal.md` — remediation + follow-up backlog mapping + per-finding mechanical-guard recommendation.
- `harness-scan-baseline.txt` — verbatim `pnpm harness:scan` (23/23, exit 0).

Key results: dependency graph is mechanically clean (no direction violations; agent-core + interface-\*
zero-dep). All drift is in prose/diagrams — stale package renames (`agent-sdk`/`agent-sessions`), a
phantom `agent-team` package/doc, undocumented FLOW-001~006 wake contracts, and an auth/credits
live-vs-planned contradiction across authority docs.

Follow-up P0 drafts created (TC-06): `INFRA-004` (AF-01 agent-core SSOT), `INFRA-005` (AF-02 auth/credits
planned), `INFRA-006` (AF-03 agent-cli dep chain). P1/P2 thematic backlogs + mechanical guards proposed
for INFRA-003 to implement.
