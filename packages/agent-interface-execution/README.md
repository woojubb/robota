# @robota-sdk/agent-interface-execution

The execution contracts of the Robota SDK: what a background task is and which states it moves
through, how independent jobs are grouped and awaited, what a subagent is asked to do and what it
returns, and the execution-workspace records a surface uses to show where work came from and what
it is doing.

The package contains type declarations only, with no classes and no runtime code. It is the shared
vocabulary between the runtime that schedules work and the surfaces that display it. Its only
dependency is `@robota-sdk/agent-core`, for shared types.

## Installation

```bash
npm install @robota-sdk/agent-interface-execution
```

## Usage

Background-task requests, results and states are unions discriminated by `kind`
(`'agent' | 'process' | 'scheduled' | 'tool-invocation'`):

```ts
import type { TBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

function describeTask(task: TBackgroundTaskState): string {
  switch (task.kind) {
    case 'agent':
      return `${task.label} [${task.agentType ?? 'agent'}] ${task.status}`;
    case 'scheduled':
      return `${task.label} next run ${task.nextFireAt ?? 'not scheduled'}`;
    case 'process':
    case 'tool-invocation':
      return `${task.label} ${task.commandPreview ?? ''} ${task.status}`;
  }
}
```

A session exposes these states through its background-task capability
(`listBackgroundTasks()`, declared in `@robota-sdk/agent-interface-session`).

## What it defines

| Family                | Main types                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background tasks      | `TBackgroundTaskRequest`, `TBackgroundTaskState`, `TBackgroundTaskResult` (one member per kind), `TBackgroundTaskStatus`, `IBackgroundTaskError`, `TBackgroundTaskEvent`, log pages and list filters |
| Background job groups | `IBackgroundJobGroupState`, `IBackgroundJobGroupCreateRequest`, `TBackgroundJobWaitPolicy`, `IBackgroundJobResultEnvelope`, `TBackgroundJobGroupEvent`                                               |
| Subagents             | `ISubagentSpawnRequest`, `ISubagentJobState`, `ISubagentJobResult`, `TSubagentJobStatus`                                                                                                             |
| Execution workspace   | `IExecutionWorkspaceSnapshot`, `IExecutionWorkspaceEntry`, `IExecutionOrigin`, `IExecutionDetailPage`, `TExecutionControl`, `TExecutionNormalizedState`                                              |

## Where it sits

- Depends on `@robota-sdk/agent-core` (types only) and on no other `agent-interface-*` package.
- `@robota-sdk/agent-executor` runs background tasks and subagents;
  `@robota-sdk/agent-subagent-runner` runs subagents in child processes;
  `@robota-sdk/agent-framework` wires them into a session.
- `@robota-sdk/agent-session` persists task and group state in the session record.
- `@robota-sdk/agent-interface-session` names these types in its session capabilities;
  `@robota-sdk/agent-command`, `@robota-sdk/agent-transport`, `@robota-sdk/agent-ui-terminal` and
  `@robota-sdk/agent-ui-web` use them to control and display work.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract, the boundaries, its invariants, and how a forked
  conversation reaches a background task.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
