---
name: dependency-graph-extraction
description: Extracts the actual workspace-internal dependency graph from package.json + imports and runs the mechanical conformance checks, emitting the ground-truth edge set + violations the rest of the audit verifies documents against. Use as the mechanical-floor step of architecture-conformance-audit, or standalone.
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
   only workspace-internal entries (packages under this workspace's npm scope — see
   [.agents/project-structure.md](../../project-structure.md), the SSOT for the package listing).
   Emit one line per package: `name → [deps]`. (Reproducible via a short `node -e` over the
   package.json files.)
2. **Mechanical guards.** Run `pnpm harness:conformance` — it composes
   `scripts/harness/check-dependency-direction.mjs` (the dependency-direction rules owned by
   `.agents/project-structure.md`: bidirectional / re-export / zero-dependency-core / plugin-layer)
   with the workspace-package-name guard, and prints a JSON summary between
   `CONFORMANCE_JSON_BEGIN`/`END`. Capture the exit code and JSON verbatim.
3. **Baseline.** Run `pnpm harness:scan` and capture its full output as the consistency baseline.

## Output

- The workspace-internal dependency edge set (verbatim).
- The `harness:conformance` JSON summary + exit code.
- The `harness:scan` output.

These are consumed by the `architecture-conformance-auditor` agent (dispatched via
[architecture-refresh](../architecture-refresh/SKILL.md)) to diff documented edges against reality.

## What This Skill Does NOT Do

- Judge whether documents match the graph → that is the `architecture-conformance-auditor` agent.
- Modify `package.json` or fix violations → extraction only.
