---
name: dependency-graph-extraction
description: Extracts the actual workspace dependency graph (agent-* → agent-* edges) from package.json + imports and runs the mechanical conformance checks, emitting the ground-truth edge set + violations the rest of the audit verifies documents against. Use as step 1 of architecture-conformance-audit.
---

# Dependency Graph Extraction

Single-responsibility step: produce the mechanical ground truth for an architecture conformance audit —
the real package dependency edge set plus the deterministic guard results. Pure extraction; it assigns
no verdicts and edits no docs.

## Rule Anchor

- `.agents/project-structure.md` > dependency-direction rules
- `AGENTS.md` > Document Discovery Policy — prefer a mechanical check over adding more prose

## When to Use

Step 1 of [architecture-conformance-audit](../architecture-conformance-audit/SKILL.md), or standalone
when you only need the current dependency edge set.

## Steps

1. **Edge set.** For each `packages/*/package.json`, read `dependencies` + `peerDependencies` and keep
   only `@robota-sdk/*` entries. Emit one line per package: `name → [deps]`. (Reproducible via a short
   `node -e` over the package.json files.)
2. **Mechanical guards.** Run `pnpm harness:conformance` — it composes
   `scripts/harness/check-dependency-direction.mjs` (bidirectional / re-export / agent-core zero-deps /
   plugin-layer rules) with the workspace-package-name guard, and prints a JSON summary between
   `CONFORMANCE_JSON_BEGIN`/`END`. Capture the exit code and JSON verbatim.
3. **Baseline.** Run `pnpm harness:scan` and capture its full output as the consistency baseline.

## Output

- The `agent-* → agent-*` edge set (verbatim).
- The `harness:conformance` JSON summary + exit code.
- The `harness:scan` output.

These are consumed by [doc-claim-verification](../doc-claim-verification/SKILL.md) (to diff documented
edges against reality) and recorded in the report's "Mechanical Conformance Baseline" + "Dependency
Graph Ground Truth" sections.

## What This Skill Does NOT Do

- Judge whether documents match the graph → that is `doc-claim-verification`.
- Modify `package.json` or fix violations → extraction only.
