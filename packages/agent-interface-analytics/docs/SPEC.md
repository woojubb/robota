# SPEC.md — @robota-sdk/agent-interface-analytics

## Package Identity

- **npm name**: `@robota-sdk/agent-interface-analytics`
- **Layer**: Layer 0 — the dependency set that places it there is declared in this package's manifest
  and enforced by `check-dependency-direction.mjs`; not restated here. The layer itself is declared in
  [`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md)
  and enforced by `scripts/harness/interface-layers.mjs` (ARCH-101).
- **SDK**: (none — contract declarations only)
- **Platform**: node

## Scope

This package owns the **usage and run-trace contracts**: how many tokens a turn consumed, what it
cost, which execution unit it is attributed to, and the per-turn timeline a trace view renders.

It contains type declarations only. No class, no runtime logic, no mechanism.

## Boundaries

| Concern                                       | Owner                                           |
| --------------------------------------------- | ----------------------------------------------- |
| Assembling a report from recorded usage       | `agent-session-analytics`                       |
| Recording usage as a turn completes           | `agent-framework`                               |
| Model pricing, and computing a turn's cost    | `agent-core`                                    |
| Carrying a report across the sidecar boundary | `agent-transport-protocol`                      |
| Rendering a trace or cost view                | `agent-transport-tui`, `agent-transport-gui`    |
| Session, turn and interaction contracts       | `agent-interface-transport` (until issue #2110) |

**This package declares the SHAPE of a measurement. It measures nothing and decides no policy** — not
what counts as a turn, not how cost is derived, not what a report should contain.

## Architecture Overview

**Layer 0 with an empty dependency set.** Every field of every declaration here is a primitive or
another declaration in this package, so it depends on nothing at all — not even `agent-core`. It is
the only contract package in the family with no dependencies, and that is a property worth keeping:
the moment one of these types needs a foreign type, the boundary has moved.

Composition runs downward into it. `agent-interface-transport`'s `turn-contracts` names
`IUsageSnapshot` for `ITurnHandle.usage`; this package names no session, turn or transport type.

**This family was not a file.** Its seven declarations lived inside `session-contracts.ts` in the
transport package, which is why the owner map records it as `symbols@session-contracts` and why
ARCH-105 was a split rather than a move.

## Type Ownership

| Type                             | Location                 | Purpose                                                                                         |
| -------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `IUsageSnapshot`                 | `src/usage-contracts.ts` | one turn's token counts, context window and cost status                                         |
| `IUsageSource`                   | `src/usage-contracts.ts` | which execution unit consumed it — main thread, subagent, background task, tool, command, skill |
| `IUsageSourceTotals`             | `src/usage-contracts.ts` | one source's rolled-up totals and share                                                         |
| `IUsageBySourceReport`           | `src/usage-contracts.ts` | the whole-session read model, including the timeline                                            |
| `ISpanEntry`                     | `src/usage-contracts.ts` | one operation's duration, as recorded on the session timeline                                   |
| `IRunTraceSpan`, `IRunTraceTurn` | `src/usage-contracts.ts` | the trace projection — spans grouped under their owning turn                                    |

7 declarations. `src/index.ts` is the single entry point; there is no subpath export.

## Public API Surface

| Export           | Kind | Description                               |
| ---------------- | ---- | ----------------------------------------- |
| every name above | type | contract declarations; see Type Ownership |

**No runtime value is exported.** `scan-interface-runtime` refuses anything beyond a contract's
vocabulary and its discriminators, and this package needs neither.

## Extension Points

None by design. A consumer needing a different projection declares it in its own package and states
how it relates to the types here.

## Error Taxonomy

| Error | Code | Category | Recoverable |
| ----- | ---- | -------- | ----------- |
| —     | —    | —        | —           |

This package declares no error type and throws nothing. `IUsageSnapshot.costStatus` distinguishes
`unknown` / `estimated` / `exact`, which is a statement about **confidence in a measurement**, not a
failure — an unpriced model yields `unknown` and no `costUsd`, and that is a normal outcome.

## Test Strategy

`src/__tests__/contracts.test.ts` asserts the exported shapes. Four of the seven had **no assertion
anywhere** before this package existed — only `IUsageSnapshot` was covered, incidentally, in the
transport package's contract test. Extracting the family was the moment that became visible, and they
are covered now.

Beyond that the package declares types and exports no behavior, so the remaining assertion available
is that it compiles, which `pnpm typecheck` makes on every run. The contracts are exercised by
`agent-session-analytics` (which assembles the report) and `agent-transport-protocol` (which carries
it).

## Class Contract Registry

None. This package declares no class, and `scan-interface-runtime` refuses one.
