---
name: architecture-conformance-audit
description: Thin router for the doc-vs-code architecture conformance audit (GATE-CONFORMANCE). Routes to the mechanical conformance scan plus the architecture-refresh agent loop (architecture-conformance-auditor / architecture-auditor + fixers), which own the audit behavior natively. Use before a release, after cross-package work, or when GATE-CONFORMANCE runs.
---

# Architecture Conformance Audit (router)

The conformance audit is owned by the **agent loop**, not by a prose skill chain. This router only
names the two layers; every judgement lives in the agents (see
[enforcement-architecture.md](../../rules/enforcement-architecture.md) — no skill-tree tiers).

1. **Mechanical floor.** Run the conformance scan — `pnpm harness:conformance` (see the
   `harness:*` scripts in the root `package.json` for the current name) plus `pnpm harness:scan`.
   Exit 0 = conformant; capture the JSON summary verbatim. For just the ground-truth dependency
   edge set, use [dependency-graph-extraction](../dependency-graph-extraction/SKILL.md).
2. **Agent loop.** Dispatch the [architecture-refresh](../architecture-refresh/SKILL.md) pipeline:
   `architecture-conformance-auditor` (doc↔code claim verdicts — HOLDS/DRIFT/VIOLATION/PHANTOM/
   UNDOCUMENTED — with findings + `ACTIONABLE FINDINGS: <n>`) and `architecture-auditor`
   (design-quality judgement), routed to `architecture-fixer` / `architecture-implementer` until a
   round is clean.
3. **Remediation planning.** When findings need follow-up backlogs + guard recommendations, use
   [improvement-proposal-authoring](../improvement-proposal-authoring/SKILL.md).

PASS/FAIL is decided by GATE-CONFORMANCE (`.agents/rules/spec-workflow.md` > GATE-CONFORMANCE, run
via `backlog-gate-guard`): the scan exits 0 and no unresolved P0 finding remains.
