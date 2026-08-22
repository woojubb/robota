---
name: architecture-conformance-audit
description: Thin router for the doc-vs-code architecture conformance audit (GATE-CONFORMANCE). Routes to the mechanical conformance scan plus architecture-refresh, where conformance remains a separate channel beside the four-dimension audit fanout and downstream guardians/appliers own all judgement. Use before a release, after cross-package work, or when GATE-CONFORMANCE runs.
---

# Architecture Conformance Audit (router)

The conformance audit is owned by the **agent loop**, not by a prose skill chain. This router only
names the two layers; every judgement lives in the agents (see
[enforcement-architecture.md](../../rules/enforcement-architecture.md) — no skill-tree tiers).

1. **Mechanical floor.** This step is deliberately concrete: it is the only part of the audit that must
   be _reproducible byte-for-byte_ by whoever re-runs it, so the commands and output markers are named
   literally rather than pointed at (per the neutrality note in
   [harness-composition-design.md](../../specs/harness-composition-design.md)).
   - Run the conformance scan — `pnpm harness:conformance` (see the `harness:*` scripts in the root
     `package.json` for the current name). Exit 0 = conformant; capture its exit code and the JSON
     summary printed between `CONFORMANCE_JSON_BEGIN`/`END` **verbatim**.
   - Run `pnpm harness:scan` and capture its **full** output as the consistency baseline for this audit.
   - Derive the dependency edge set from the manifests — for each workspace package manifest, keep the
     workspace-internal entries of `dependencies` and `peerDependencies` and emit one `name → [deps]`
     line per package. That the manifests, not any document, are the ground truth is a rule owned by
     [.agents/project-structure.md](../../project-structure.md) (which also owns the package listing and
     the dependency-direction rules the scan enforces).

   This step assigns no verdicts — it produces the input step 2 diffs the documents against.

2. **Agent loop.** Dispatch the [architecture-refresh](../architecture-refresh/SKILL.md) pipeline. It runs
   `architecture-conformance-auditor` as the separate doc↔code channel (HOLDS/DRIFT/VIOLATION/PHANTOM/
   UNDOCUMENTED + `ACTIONABLE FINDINGS: <n>`) beside
   [architecture-audit-fanout](../architecture-audit-fanout/SKILL.md), then sequences synthesis,
   verification, depth, reconciliation, and `architecture-fixer` / `architecture-implementer` routing
   until every material finding is resolved.
3. **Remediation planning.** When findings need follow-up backlogs + guard recommendations, use
   [improvement-proposal-authoring](../improvement-proposal-authoring/SKILL.md).

PASS/FAIL is decided by GATE-CONFORMANCE (`.agents/rules/spec-workflow.md` > GATE-CONFORMANCE, run
via `backlog-gate-guard`): the scan exits 0 and no unresolved P0 finding remains.
