---
title: 'HARNESS-900: cross-check the projected interface graph against the package manifests'
issue: https://github.com/woojubb/robota/issues/2215
status: todo
created: 2026-08-25
priority: medium
urgency: soon
area: harness
depends_on: []
---

# HARNESS-900: cross-check the projected interface graph against the package manifests

## Objective

`scan-interface-family-owner` proves the contract-family owner map yields an acyclic package graph,
and that proof is only as wide as what `projectGraph` can parse. It once read relative imports only —
correct while every family shared a package, and blind the moment a leaf moved one out and the same
dependency became a package specifier.

**Acyclicity stayed green while the graph emptied**, because fewer edges make acyclicity easier to
satisfy. The verdict strengthened at the rate the evidence disappeared, which is the class issue
#2215 names.

Give the projection an oracle that cannot decay with it: the package manifests declare the same
edges, are written by different work at a different time, and a parser that stops seeing a kind of
import cannot take them down.

## Plan

- [x] Test the issue's proposal before building it — do the manifest edges and the projected edges
      correspond today? (4 and 4, identical: the oracle is implementable and green now.)
- [x] `manifestEdges()` — read `agent-interface-*` dependencies from `package.json`.
- [x] `manifestEdgesMissingFromProjection()` — every declared edge the projection does not carry.
      One direction only: a projected edge with no manifest entry is a missing dependency
      declaration, a different defect with a different owner.
- [x] Wire it into the scan's failure classes and declare the edge count in `::examined::`.
- [x] Reproduce the historical defect and confirm the oracle catches it where acyclicity did not.
- [x] Red-proof the new cases.
- [ ] Land and close issue #2215.

## User execution

**Not user-facing.** This changes a harness scan's failure conditions; the product surface, its
commands and its output are untouched. The scenario a user could run to see it is the scan itself,
which is `pnpm harness:scan` and is a developer surface, not a user one.

Evidence a reader can re-run instead:

```
node scripts/harness/scan-interface-family-owner.mjs
  → ::examined:: … 4 manifest edge(s) cross-checked against the projection
  → passed

remove the package-specifier branch from projectGraph
  → FAILED with four UNPROJECTED EDGE findings
  → and `agent-interface-session` moves into migration wave 1, the exact reported symptom
```

## Verification

- `pnpm harness:scan` — 143 passed, 3 skipped, 0 failed.
- `pnpm harness:test` — 1149 passed across 73 files.
- Red proof: making the oracle return an empty list fails exactly the historical-defect case and
  leaves the other 41 green.
