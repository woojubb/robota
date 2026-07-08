---
name: architecture-conformance-audit
description: Orchestrates a repeatable doc-vs-code architecture conformance audit — sequences dependency-graph extraction, per-document claim verification, finding classification, and improvement-proposal authoring into the INFRA-002 report schema. Use before a release, after cross-package work, or when GATE-CONFORMANCE runs.
---

# Architecture Conformance Audit (orchestrator)

Repeatable orchestrator for a doc-vs-code architecture conformance audit. Codifies the INFRA-002
methodology so it can run on demand instead of as a one-shot manual pass. This skill sequences the
single-responsibility step skills; it does not itself extract graphs, judge claims, or write rules.

## Rule Anchor

- `AGENTS.md` > Document Discovery Policy + "prefer a mechanical check over adding more prose"
- `.agents/rules/spec-workflow.md` > GATE-CONFORMANCE
- `.agents/project-structure.md` > dependency-direction rules (the truth this audit checks docs against)

## When to Use

- Before a `develop → main` release, or after any cross-package change.
- When `GATE-CONFORMANCE` is invoked (see `backlog-gate-guard`).
- On demand to refresh `.design/architecture-audit/<date>/`.

## Steps

1. **Mechanical baseline.** Run `pnpm harness:conformance` (dependency-direction + workspace-package-name
   guard) and `pnpm harness:scan`. Capture both verbatim. This is the deterministic floor — no human
   judgement. See [dependency-graph-extraction](../dependency-graph-extraction/SKILL.md). **A green baseline
   is a floor, not a ceiling:** several guards assert only that referenced _names/tokens_ exist, not that a
   documented _edge/shape/direction_ is real (see [harness-governance](../harness-governance/SKILL.md)
   "Assert the relation, not a proxy"). Treat guard **coverage gaps** — a boundary the audit can violate
   that no guard catches — as first-class findings, and recommend the relation-asserting guard in step 4.
2. **Per-document verification.** For each canonical architecture document (the set in
   [doc-claim-verification](../doc-claim-verification/SKILL.md) > Canonical Document Set), assign every
   checkable claim a verdict via [doc-claim-verification](../doc-claim-verification/SKILL.md).
   **Enumerate the set mechanically — do not hand-list it.** The architecture-map has nested subtrees
   (e.g. `agent-cli/`); enumerate with `find .agents/specs/architecture-map -name '*.md'` and
   `ls packages/*/docs/SPEC.md`, then verify EVERY file. A risk-based pass may _prioritise_ recently
   changed docs, but must still report which canonical docs were covered vs. deferred (no silent scoping).
3. **Classify + report.** Turn verdicts into `AF-NN` findings with severity and a counts table via
   [conformance-finding-report](../conformance-finding-report/SKILL.md), written to
   `.design/architecture-audit/<date>/conformance-audit-report.md`.
4. **Improvement proposal.** Map P0/P1 findings to remediation + follow-up backlogs + guard
   recommendations via [improvement-proposal-authoring](../improvement-proposal-authoring/SKILL.md),
   written to `.design/architecture-audit/<date>/improvement-proposal.md`.
5. **Report the gate verdict.** Surface the `harness:conformance` exit code + JSON summary as the
   machine-readable result; the prose findings are the analytic layer on top.

## Output

Two documents under `.design/architecture-audit/<date>/` (report + proposal) plus the captured
`harness:conformance` / `harness:scan` baselines. Structure must match the INFRA-002 schema (see
`conformance-finding-report`). Reference exemplar: `.design/architecture-audit/2026-06-13/`.

## What This Skill Does NOT Do

- Run gates or decide PASS/FAIL → that is `backlog-gate-guard` (GATE-CONFORMANCE).
- Fix any finding → fixes are spun out as follow-up backlogs (spec-before-code).
- Restate dependency-direction rules → those live in `.agents/project-structure.md`.
