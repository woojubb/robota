# Agent Command Workflows Specification

## Scope

Provides the agent-cli `/workflows` command module — a bridge that surfaces the DAG workflow engine
inside the agent CLI by composing `@robota-sdk/dag-framework` in-process. Owns the `workflows`
`ICommandModule`, its subcommand dispatch, and the per-subcommand executors (`list`, `run`).

## Boundaries

- Does NOT own DAG execution — that belongs to `@robota-sdk/dag-framework` (and the DAG subsystem).
- Does NOT depend on `@robota-sdk/dag-cli` (a sibling product shell); it composes the reusable DAG
  framework material directly.
- Does NOT own command contracts — those belong to `@robota-sdk/agent-framework` /
  `@robota-sdk/agent-interface-transport`.
- Does NOT own CLI composition — `@robota-sdk/agent-cli` registers this module in its default set.

## Architecture Overview

A thin bridge package. `createWorkflowsCommandModule()` returns an `ICommandModule` whose
`ISystemCommand.execute` parses a leading subcommand token and dispatches to an executor. Each executor
constructs a `LocalDagRuntimeProvider` (default node registry) from `dag-framework` and returns an
`ICommandResult`. No state is held; providers are created per invocation.

## Type Ownership

| Type                                     | Location | Purpose                                               |
| ---------------------------------------- | -------- | ----------------------------------------------------- |
| (none — this package owns no SSOT types) | —        | Consumes command + DAG contracts from owner packages. |

## Public API Surface

| Export                                 | Kind     | Description                                                         |
| -------------------------------------- | -------- | ------------------------------------------------------------------- |
| `createWorkflowsCommandModule`         | function | Returns the `workflows` `ICommandModule` for agent-cli composition. |
| `createWorkflowsCommandEntry`          | function | Returns the `workflows` `ICommand` metadata entry.                  |
| `WorkflowsCommandSource`               | class    | `ICommandSource` exposing the `workflows` command.                  |
| `executeWorkflowsList`                 | function | Executor for `/workflows list`.                                     |
| `executeWorkflowsRun`                  | function | Executor for `/workflows run <file>`.                               |
| `AGENT_COMMAND_WORKFLOWS_PACKAGE_NAME` | const    | Package-name constant.                                              |

## Extension Points

New subcommands are added by extending the dispatch in `workflows-command-module.ts` and adding an
executor module. Subcommands compose `dag-framework` (and other DAG packages) — never `dag-cli`.

## Error Taxonomy

Executors return `ICommandResult` with `success: false` and a human-readable `message` for terminal
failures (missing file, unreadable/invalid DAG, failed run). Errors are surfaced, never silently
swallowed; no fallback to a default workflow.

## Test Strategy

`src/__tests__/workflows-command-module.test.ts` covers: module shape + slash-free name + subcommands;
`list` dispatch against the in-process catalog; usage/unknown-subcommand handling; `run` usage error.

## Class Contract Registry

### Interface Implementations

| Interface        | Implementor                              | Kind       | Location                          |
| ---------------- | ---------------------------------------- | ---------- | --------------------------------- |
| `ICommandSource` | `WorkflowsCommandSource`                 | production | `src/workflows-command-module.ts` |
| `ICommandModule` | (factory) `createWorkflowsCommandModule` | production | `src/workflows-command-module.ts` |

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Owner                                     | Consumer    | Location                                    |
| ----------------------------------------- | ----------- | ------------------------------------------- |
| `agent-framework` command contracts       | this module | `src/`                                      |
| `dag-framework` `LocalDagRuntimeProvider` | executors   | `src/list-command.ts`, `src/run-command.ts` |
