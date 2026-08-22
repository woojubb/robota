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

```text
layer 0 (no outbound edges)
  agent-interface-transport   agent-interface-command
  agent-interface-execution   agent-interface-analytics

layer 1  agent-interface-session  →  command, execution, analytics
layer 2  agent-interface-session-mobility  →  session
```

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

Rules:

- An `agent-interface-*` package must not contain classes or runtime logic. **Mechanized on two
  edges by `scripts/harness/scan-interface-runtime.mjs` (HARNESS-103).** SOURCE: no `class`/`enum`
  declaration and no bare value import. ENTRY: the package's `src/index.ts` may publish its
  contracts' VOCABULARY (a `const` holding a VALUE) and their DISCRIMINATORS (a function returning
  a type predicate `x is T`, however it is declared) — anything else exported as a runtime value is
  a mechanism and belongs in an
  owner package, or under `testing/` if it is a double (`contracts→agent-interface-*,
doubles→owner /testing`). Pre-existing mechanisms are frozen per package in
  `scripts/harness/interface-entry-baseline.json` and the count may only shrink. The entry edge
  exists because the source edge alone measured something narrower than this rule's words, so a
  100-line prototype-walking forwarder sat outside the rule and inside the green.
- An `agent-interface-*` package's internal dependencies are a subset of `{agent-core}` —
  contracts never depend on implementation packages (INFRA-025; mechanized as the
  `INTERFACE-DEPS` rule in the `deps` scan). `agent-interface-transport` owns the
  background-task/subagent/compaction data contracts and, post-DATA-001, the
  session/workspace/command/event/usage contract families; `agent-executor`/`agent-session` import
  them and keep only runtime SPI.
- Implementation packages (`agent-transport` with subpath `/headless`; the per-concern `agent-transport-tui` / `-ws` / `-http` / `-mcp` packages; `agent-provider` with subpaths `/anthropic`, `/openai`, etc.; `agent-command`) depend on the corresponding `agent-interface-*` package, not on `agent-framework`, for interface types. The transport-facing contract types (command, interaction, event, workspace, session, and transport contracts) live in `agent-interface-transport` as their SSOT (per INFRA-010). This is **mechanically enforced** by `scripts/harness/check-interface-imports.mjs` (wired into `pnpm harness:scan` as the `interface-imports` scan): any implementation package that imports an `agent-interface-transport`-exported symbol from `@robota-sdk/agent-framework` fails the gate. Runtime values and framework-owned types (e.g. `TInteractiveSessionOptions`, `ICommandHostContext`, `ICommandModule`, `TSettingsData`) still come from `agent-framework`.
- `agent-framework` depends on the `agent-interface-transport` package to consume the contracts it needs (it does not depend on `agent-interface-tui`, which only `agent-transport-tui` consumes).
- Do not place interface packages in `agent-core` — `agent-core` is zero-deps and owns foundational primitives only.
