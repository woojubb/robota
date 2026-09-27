# @robota-sdk/dag-core

The domain contracts of Robota's DAG workflow engine: definition, run and task types, the port
interfaces that storage, queue, lease, clock and executor adapters implement, the run and task state
machines, definition decoding and validation, and the `TResult` / `IDagError` result shape. Every other
`dag-*` package builds on these contracts instead of declaring its own.

Internal package: private to this monorepo (`"private": true`) and not published to npm. It is part of
the DAG workflow subsystem described in [The DAG packages](#the-dag-packages) below.

## Where it sits

- Depends on: no other `@robota-sdk/*` package.
- Used by: every other `dag-*` package, every `dag-node-*` node package,
  [`@robota-sdk/agent-command-workflows`](../agent-command-workflows/README.md) and
  [`apps/dag-runtime-server`](../../apps/dag-runtime-server/docs/README.md).

## Main exports

- Domain types: `IDagDefinition`, `IDagNode`, `IDagEdgeDefinition`, `IDagRun`, `ITaskRun`,
  `INodeManifest`, `IPortDefinition`, `TPortPayload`, `IDagNodeDefinition`.
- Results and errors: `TResult<T, E>`, `IDagError`, and builders such as `buildValidationError`,
  `buildDispatchError` and `buildTaskExecutionError`.
- Ports: `IStoragePort`, `IQueuePort`, `ILeasePort`, `IClockPort`, `ITaskExecutorPort`,
  `IRunDraftStore`, `IAssetStore`, `IPromptBackendPort`, `IDagRuntimeProvider`.
- State: `DagRunStateMachine`, `TaskRunStateMachine`, the status constants `DAG_RUN_STATUS` and
  `TASK_RUN_STATUS`, and the event constants `RUN_EVENTS` and `TASK_EVENTS`.
- Decoding and validation: `decodeDagDefinition`, `decodeDagWorkflowFile`, `DagDefinitionValidator`,
  `DagDefinitionService`.
- Execution support: `LifecycleTaskExecutorPort`, `NodeLifecycleRunner`, `TaskSnapshotBudget`,
  `RootCreditBudget`, `TimeSemanticsService`.

Operations return `TResult` values (`{ ok: true, value }` or `{ ok: false, error }`) instead of
throwing.

## Usage

```ts
import { readFile } from 'node:fs/promises';
import {
  DagDefinitionValidator,
  DagRunStateMachine,
  decodeDagDefinition,
  formatDagDecodeIssues,
} from '@robota-sdk/dag-core';

// Decode untrusted JSON into an IDagDefinition, then check its structure.
const decoded = decodeDagDefinition(JSON.parse(await readFile('workflow.json', 'utf8')));
if (!decoded.ok) {
  throw new Error(formatDagDecodeIssues(decoded.error));
}

const validated = DagDefinitionValidator.validate(decoded.value);
if (!validated.ok) {
  for (const error of validated.error) console.error(`${error.code}: ${error.message}`);
}

// State machines are pure lookups that return the next status and its domain event.
const transition = DagRunStateMachine.transition('queued', 'START');
if (transition.ok) {
  console.log(transition.value.nextStatus); // 'running'
  console.log(transition.value.domainEvents); // ['run.running']
}
```

## The DAG packages

All DAG packages are internal. Read them bottom-up: contracts first, then the packages that build on
them.

| Layer       | Package                                                             | Role                                                              |
| ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Contracts   | `dag-core`                                                          | Domain types, ports, state machines, decoding and validation      |
| Authoring   | [`dag-node`](../dag-node/README.md)                                 | Base class and helpers for writing node types                     |
| Authoring   | [`dag-node-*`](../dag-nodes/README.md)                              | One concrete node type per package, under `packages/dag-nodes/`   |
| Authoring   | [`dag-nodes-default`](../dag-nodes-default/docs/README.md)          | The default node catalog                                          |
| Authoring   | [`dag-builder`](../dag-builder/docs/README.md)                      | Pipeline specs and workflow files to `IDagDefinition`             |
| Authoring   | [`dag-cost`](../dag-cost/README.md)                                 | CEL cost formulas and the cost-metadata model                     |
| Execution   | [`dag-runtime`](../dag-runtime/README.md)                           | Create, start, query and cancel runs                              |
| Execution   | [`dag-worker`](../dag-worker/README.md)                             | Execute queued tasks and advance runs                             |
| Execution   | [`dag-scheduler`](../dag-scheduler/README.md)                       | Scheduled, batch and catch-up run triggers                        |
| Execution   | [`dag-projection`](../dag-projection/README.md)                     | Read models for runs, lineage and dashboards                      |
| Adapters    | [`dag-adapters-local`](../dag-adapters-local/README.md)             | In-memory and file-based ports                                    |
| Adapters    | [`dag-adapters-sqlite`](../dag-adapters-sqlite/docs/README.md)      | SQLite storage and queue                                          |
| API         | [`dag-api`](../dag-api/README.md)                                   | Controllers, service ports and the problem-details error envelope |
| API         | [`dag-orchestration-client`](../dag-orchestration-client/README.md) | HTTP client for a `/v1/dag/*` server                              |
| Composition | [`dag-framework`](../dag-framework/README.md)                       | `createDagFramework()` and the local and HTTP runtime providers   |

Users reach this subsystem through the CLI's `/workflows` command
([`@robota-sdk/agent-command-workflows`](../agent-command-workflows/README.md), see the
[CLI guide](../../content/guide/cli.md)) and through the
[`apps/dag-runtime-server`](../../apps/dag-runtime-server/docs/README.md) HTTP server.

## Documentation

- [docs/README.md](docs/README.md) — overview of this package's docs.
- [docs/SPEC.md](docs/SPEC.md) — the contract: definitions, run and task state, cancellation,
  budgets, lineage and host-supplied capabilities.
