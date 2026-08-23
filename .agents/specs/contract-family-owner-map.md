# Contract-Family Owner Map

**Owner:** ARCH-100 (registered as issue #2080, under tracker issue #2068).
**Parsed by:** `scripts/harness/scan-interface-family-owner.mjs` (`interface-family-owner` scan).
**Routed from:** [`.agents/project-structure.md`](../project-structure.md) § Interface Package Rule.

`@robota-sdk/agent-interface-transport` is named for transport and owns eleven contract families —
commands, sessions, persistence, workspace, background execution, subagents, analytics/usage,
admission, peers, handoff, and transport. 21 workspace packages depend on it; `agent-executor`,
`agent-session`, and `agent-command` each reach it for their own domain's contracts.

This document is the SSOT for where each family is going, in what order, and why that order is forced.
The reasoning behind it — alternatives, prior art, the decision — lives in the paired spec-doc
`.agents/spec-docs/todo/ARCH-100-contract-family-owner-map-and-acyclic-target-graph.md` and is not
repeated here.

## The owner map

<!-- arch-100:owner-map -->

One family, one owner. This table is the SSOT: `scripts/harness/scan-interface-family-owner.mjs`
PARSES it — it is not restated in the scan, because a second copy is the drift this map exists to
prevent. Rows are `| owner | contract modules | leaf |`.

| Target owner                       | Contract modules                                                                                                                                                                        | Leaf        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `agent-interface-transport`        | `transport-adapter`, `transport-config`, `channel-contracts`, `admission`                                                                                                               | issue #2113 |
| `agent-interface-command`          | `command-contracts`, `capability-contracts`                                                                                                                                             | issue #2108 |
| `agent-interface-execution`        | `background-task-contracts`, `background-group-contracts`, `subagent-contracts`, `workspace-contracts`                                                                                  | issue #2109 |
| `agent-interface-session`          | `session-contracts`, `session-capability-contracts`, `session-summary-contracts`, `interaction-contracts`, `event-contracts`, `driver-contracts`, `turn-contracts`, `compact-contracts` | issue #2110 |
| `agent-interface-session-mobility` | `peer-message-contracts`, `handoff-contracts`, `session-mobility-contracts`                                                                                                             | issue #2111 |
| `agent-interface-analytics`        | symbols@`session-contracts`: `IUsageSource`, `IUsageSnapshot`, `ISpanEntry`, `IUsageSourceTotals`, `IRunTraceSpan`, `IRunTraceTurn`, `IUsageBySourceReport`                             | issue #2112 |

`capability-contracts` goes with **command**, not transport: its only importer is `command-contracts`,
and leaving it behind would give the command owner an edge onto a package named for transport — the
exact defect issue #2068 exists to remove.

The analytics row is `symbols@<module>` because that family is **not a file**. Those seven types are
declared inside `session-contracts.ts`; family boundaries and file boundaries do not coincide here, so
a file-level move plan for issue #2112 would silently fail.

## Target dependency graph, and the two corrections it rests on

### Layer declaration (ARCH-101 · issue #2180)

<!-- arch-101:layer-map -->

The owner ruled that the general layer rule governs this prefix: an `agent-interface-*` package may
compose another **when the layers differ and the composition is one-directional**. Only **same-layer**
dependencies are forbidden, and an upward dependency is forbidden by the same sentence.

So these numbers are not description. They are **the thing that authorizes each edge**, and both
guards read this table through one parser (`scripts/harness/interface-layers.mjs`). Rows are
`| layer | package |`.

| Layer | Package                            |
| ----- | ---------------------------------- |
| 1     | `agent-interface-transport`        |
| 0     | `agent-interface-command`          |
| 0     | `agent-interface-execution`        |
| 0     | `agent-interface-analytics`        |
| 1     | `agent-interface-session`          |
| 2     | `agent-interface-session-mobility` |

```text
layer 0   transport   command   execution   analytics     (no edges among them)
layer 1   session      → command, execution, analytics
layer 2   mobility     → session
```

**`agent-interface-transport` is at layer 1 TODAY and drops to layer 0 when issue #2113 narrows it.**
The layer declares what a package HOLDS, not what it will hold. Until issue #2110 moves the session
family out, this package still owns `session-contracts` and `session-capability-contracts`, which name
execution and command types — so it composes downward exactly as the session owner will, and layer 1
is what authorizes those edges. Declaring the target 0 early would have made the real
`transport → execution` edge read as same-layer and refused a legal migration. Move it to 0 in the
same change that removes the last non-transport family.

A layer-0 package depends on no other `agent-interface-*` package. `agent-interface-tui` is not in the
table: it composes no peer and is depended on by none, so it has no layer to declare until it does.

**There is no family root here, and there must never be one.** The owner's rule is that a family root
may not depend on its own members — only the reverse — and that an aggregator over a family carries a
**completely different prefix**, with its purpose in the name. This family has no `agent-interface`
root package and no aggregator, so the root→member direction is vacuous by construction rather than
enforced. If a bundle over these six is ever wanted it may be named neither `agent-interface` nor
`agent-interface-*`; adding one under either name would create the root the rule forbids. No guard
checks this, deliberately — a check that can never fire is its own defect, and the naming rule
forecloses the case.

The graph is acyclic **only** with these two corrections, each a precondition of its leaf:

1. **issue #2109** — `workspace-contracts.ts` imports `IBackgroundJobGroupState` from
   `./session-contracts.js`, which merely re-exports it; it is declared in
   `background-group-contracts.ts`. Import it from its declaring module. One line, and it removes 2 of
   the 12 cycles that exist today.
2. **issue #2112** — extract the analytics family by SYMBOL, not by file (see the map note above).

`agent-interface-transport/src` currently contains **12 module cycles**, all through
`session-contracts`. They are legal today only because they sit inside one package, where TypeScript
tolerates type-level circularity; split the families without correcting them and each becomes a hard
package cycle. What remains after correction (`session-contracts` ↔ `session-capability-contracts` ↔
`turn-contracts` ↔ `event-contracts`) stays **inside** the session owner, so it does not make the
package graph cyclic. Issue #2110 inherits it rather than being surprised by it.

## Migration order

Extract owners with no outbound edges first, so a moved family never reaches back into the package it
just left.

| Wave | Owners                                     | Leaves                                |
| ---- | ------------------------------------------ | ------------------------------------- |
| 1    | command, execution, analytics              | issue #2108, issue #2109, issue #2112 |
| 2    | session                                    | issue #2110                           |
| 3    | session-mobility                           | issue #2111                           |
| 4    | transport narrowed, omnibus barrel deleted | issue #2113                           |

**This is a constraint, not a preference.** Issue #2110 may not run before issue #2108, issue #2109
and issue #2112 —
the session owner depends on all three, so starting there creates the temporary cycle the map exists
to prevent. Wave 1's three leaves are mutually independent and may run in parallel.

## The guard

`interface-family-owner` (`scripts/harness/scan-interface-family-owner.mjs`), registered in
`scripts/harness/run-all-scans.mjs` beside `interface-imports` and `interface-runtime`. It parses the table above and
fails on three conditions: **ASSIGNMENT** (a contract module unassigned or assigned twice),
**ACYCLICITY** (the projected package graph has a cycle), **PLACEMENT** (an `agent-interface-*`
package holds a module the map assigns elsewhere). Placement is inert until families actually move and
becomes the enforcing edge as the migration leaves (issue #2108 through issue #2113) land.

---

The Interface Package Rule itself — no runtime logic, the `{agent-core}` dependency subset, the
implementation-package import direction — stays in
[`.agents/project-structure.md`](../project-structure.md) § Interface Package Rule and is not
restated here. This document owns ownership, order and acyclicity; that one owns the rule.
