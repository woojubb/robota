---
status: draft
type: RULE
tags: [harness, scan, graph, oracle]
---

# HARNESS-900: the projected interface graph is checked against a source that cannot decay with it

## Problem

`scan-interface-family-owner` proves the contract-family owner map yields an **acyclic** package
graph. That proof is only as wide as what `projectGraph` can parse.

It once parsed **relative imports only**. Correct while every contract family shares a package — and
blind the moment a leaf moves one out, because the same dependency is then written as
`@robota-sdk/agent-interface-<owner>`.

Measured after three leaves: `session-contracts`' edges into execution, command and analytics had all
become package specifiers, the projection lost every one, and `session` appeared to depend on
nothing. **ACYCLICITY WAS GREEN THROUGHOUT** — fewer edges make acyclicity _easier_ to satisfy, so
the verdict strengthened at exactly the rate the evidence disappeared.

Issue #2215 names the class: **a guard whose green strengthens as its subject disappears is worse
than one that fails, because it reports increasing confidence about decreasing evidence.** It is
temporal, not structural — the check is correct when written and is degraded by subsequent,
legitimate work, which is why "review it more carefully at authoring time" cannot catch it.

## Prior Art Research

The remedy is the one the issue proposes and it is checked before it is built rather than after:

```
manifest edges between agent-interface-* packages   4
edges the projection carries                        4
identical
```

The premise holds. `agent-interface-transport`'s `package.json` declared its dependency on
`agent-interface-execution` **the whole time the projected edge was missing** — the oracle would have
gone red on the first leaf rather than the third.

Two weaker fallbacks the issue names, and why they are not the answer on their own:

- **Declare the edge count.** Adopted, but as a secondary: `measurement-provenance` already forces a
  scan to declare what it examined, and a graph-shaped scan was declaring its NODE count while the
  number that collapsed was the EDGE count.
- **Ratchet the edge count as non-decreasing.** Rejected. A legitimate decoupling refactor _should_
  remove edges, so it fires on correct work. It separates "removed" from "became invisible" only when
  paired with the oracle, at which point the oracle is doing the work.

## Solution (draft direction)

`manifestEdges()` reads `agent-interface-*` dependencies out of `package.json`.
`manifestEdgesMissingFromProjection()` reports every declared edge the projection does not carry.

**Independence is the property that matters.** The two are produced by different work at different
times — one by an import statement, one by a manifest entry written and removed by hand — so a parser
that stops seeing a kind of edge cannot take the oracle down with it.

**One direction only.** A projected edge with no manifest entry is a _missing dependency
declaration_: a different defect with a different owner. One finding must not stand for two.

## Completion Criteria (draft)

- [x] TC-01: the oracle reads a non-empty edge set from the manifests — an oracle that reads nothing
      agrees with every projection, which is the unfalsifiable green this scan exists to refuse.
- [x] TC-02: every manifest edge is carried by the projection on the current tree.
- [x] TC-03: a projection blind to package specifiers is CAUGHT — and the same case asserts that the
      blind projection is still acyclic, so it proves the old verdict would have passed.
- [x] TC-04: a projected edge the manifests do not declare is NOT faulted.
- [x] TC-05: the `::examined::` line declares the edge count alongside the node count.

## Test Plan

| TC          | Verification                              | Type/Tool                                              | Reference                                                        |
| ----------- | ----------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| TC-01…TC-04 | unit, against the real tree               | vitest                                                 | `scripts/harness/__tests__/scan-interface-family-owner.test.mjs` |
| TC-05       | the scan's own provenance line            | `node scripts/harness/scan-interface-family-owner.mjs` | stdout                                                           |
| red proof   | oracle made vacuous → exactly TC-03 fails | vitest                                                 | same file                                                        |

## User Execution Test Scenarios

**Not user-facing, and the reason is stated rather than asserted.** This changes a harness scan's
failure conditions. No product surface, command, flag or output changes; nothing a user runs behaves
differently. The nearest executable surface is `pnpm harness:scan`, which is a developer gate.

What a reader can run instead, which is the evidence and not a substitute for a user scenario:

```
node scripts/harness/scan-interface-family-owner.mjs
  → ::examined:: … 4 manifest edge(s) cross-checked against the projection   → passed

remove the package-specifier branch from projectGraph
  → FAILED, four UNPROJECTED EDGE findings
  → and `agent-interface-session` moves into migration wave 1 — the exact reported symptom
```

## Evidence Log

_GATE entries appended by the pipeline._
