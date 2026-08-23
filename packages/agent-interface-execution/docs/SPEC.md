# SPEC.md — @robota-sdk/agent-interface-execution

## Scope

This package owns the **execution-bounded contract families**: background tasks, background job
groups, subagent jobs, and execution workspaces. It is the SSOT for those type contracts, shared
between the runtime that schedules execution and the surfaces that display it.

It contains type declarations only. No class, no runtime logic, no mechanism.

## Boundaries

**Not owned here.**

| Concern                                                    | Owner                                                                         |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Session, interaction, event, turn and driver contracts     | `agent-interface-transport` (until issue #2110 moves them to a session owner) |
| Command contracts                                          | `agent-interface-transport` (until issue #2108)                               |
| Transport adapter, config, channel and admission contracts | `agent-interface-transport`                                                   |
| The RUNTIME that executes a background task                | `agent-executor`, `agent-subagent-runner`                                     |
| Persisting or projecting execution state                   | `agent-session`, `agent-transport-*`                                          |

**This package does not implement anything it declares.** A consumer that wants behavior depends on
an owner package; this one gives it the vocabulary to describe the behavior.

## Architecture Overview

**Layer 0.** Its internal dependency set is `{@robota-sdk/agent-core}` and it depends on **no peer
`agent-interface-*` package**. Composition runs downward into it — `agent-interface-session` names
these types; this package never names a session type. The layer is declared in
[`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md)
and enforced by `scripts/harness/interface-layers.mjs` through two guards (ARCH-101).

Four modules, one contract family each, and the dependency between them runs one way:

```text
subagent-contracts        → background-task-contracts
background-group-contracts → background-task-contracts
workspace-contracts        → background-task-contracts, background-group-contracts
```

`workspace-contracts` reaching `IBackgroundJobGroupState` is the edge that used to run through a
re-export in `session-contracts`; ARCH-103 redirected it to the declaring module. That was the only
upward edge in the interface tree.

## Type Ownership

| Type                                                                                     | Location                            | Purpose                                    |
| ---------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| `TBackgroundTaskRequest` and its four request shapes                                     | `src/background-task-contracts.ts`  | what is being asked of the executor        |
| `IBackgroundTaskState`, `IBackgroundTaskResult`, `IBackgroundTaskError`                  | `src/background-task-contracts.ts`  | the lifecycle of one task                  |
| `IBackgroundTaskLogCursor`, `IBackgroundTaskLogPage`, `IBackgroundTaskListFilter`        | `src/background-task-contracts.ts`  | reading a task's output and the task list  |
| `IBackgroundTaskUsage`                                                                   | `src/background-task-contracts.ts`  | token/cost attribution for a task          |
| `IBackgroundJobGroupState`, `IBackgroundJobGroupSummary`, `IBackgroundJobResultEnvelope` | `src/background-group-contracts.ts` | several tasks waited on as one unit        |
| `TBackgroundJobWaitPolicy`, `TBackgroundJobGroupStatus`                                  | `src/background-group-contracts.ts` | how a group completes                      |
| `ISubagentJobState`, `ISubagentJobResult`, `ISubagentSpawnRequest`                       | `src/subagent-contracts.ts`         | a subagent job as a data record            |
| `IExecutionWorkspaceSnapshot`, `IExecutionWorkspaceEntry`, `IExecutionWorkspaceEvent`    | `src/workspace-contracts.ts`        | the switchable view over running work      |
| `IExecutionDetailRecord`, `IExecutionDetailPage`, `IExecutionDetailCursor`               | `src/workspace-contracts.ts`        | the detail pane behind one workspace entry |

60 declarations in total. `src/index.ts` is the single entry point; there is no subpath export.

## Public API Surface

| Export           | Kind | Description                               |
| ---------------- | ---- | ----------------------------------------- |
| every name above | type | contract declarations; see Type Ownership |

**No runtime value is exported.** The Interface Package Rule permits a package's entry to publish its
contracts' vocabulary (a `const` holding a value) and their discriminators (a type predicate); this
package currently needs neither, and `scan-interface-runtime` refuses anything else.

## Extension Points

None by design. A contract package is extended by amending a declaration, not by subclassing or
registering. A consumer needing a narrower shape declares it in its own package and states how it
relates to the type here.

## Error Taxonomy

| Error                  | Code                           | Category                          | Recoverable                 |
| ---------------------- | ------------------------------ | --------------------------------- | --------------------------- |
| `IBackgroundTaskError` | `TBackgroundTaskErrorCategory` | data contract, not a thrown error | described, not decided here |

`IBackgroundTaskError` is the SHAPE of a failure that crossed a boundary. This package throws nothing
and decides no recovery policy — `TBackgroundTaskTimeoutReason` and `TBackgroundTaskErrorCategory`
give an owner the vocabulary to report why, and the owner decides what follows.

## Test Strategy

The package has no tests of its own and needs none: it declares types and exports no behavior, so the
only assertion available is that it compiles, which `pnpm typecheck` makes on every run.

Its contracts are exercised by the suites of the packages that implement them — `agent-executor`,
`agent-subagent-runner`, `agent-framework` and the transport surfaces. Three harness scans police the
package itself: `interface-runtime` (no mechanism), `interface-imports` (consumers import contracts
from here, not from `agent-framework`), and `interface-family-owner` (the four modules are placed in
their declared owner and every edge is a legal downward layer composition).

## Class Contract Registry

None. This package declares no class, and `scan-interface-runtime` refuses one.
