# @robota-sdk/agent-executor

Runtime building blocks for long-running agent runtime work: a background task manager with a lifecycle
state machine, queueing, cancellation, watchdogs, events and log pages; runners for shell processes,
scheduled tasks and tool invocations; a subagent manager built on the same layer, with optional Git
worktree isolation; and helpers that build a provider from a serializable profile.

It provides services and ports that higher packages assemble. It does not create sessions, tools or
prompts, does not read configuration files, and does not create Git worktrees itself (a worktree
adapter you supply does). Its own runners are the only place it spawns child processes.
`@robota-sdk/agent-framework` builds its subagents and background jobs on this package; the task
and result types come from `@robota-sdk/agent-interface-execution`.

## Installation

```bash
npm install @robota-sdk/agent-executor @robota-sdk/agent-core
```

Requires Node.js 22.12 or later.

## Usage

Run a shell command as a background task and wait for it:

```typescript
import {
  BackgroundTaskManager,
  createDefaultBackgroundTaskRunners,
} from '@robota-sdk/agent-executor';

const manager = new BackgroundTaskManager({ runners: createDefaultBackgroundTaskRunners() });
const unsubscribe = manager.subscribe((event) => console.log(event.type));

const task = await manager.spawn({
  kind: 'process',
  label: 'print a line',
  mode: 'background',
  parentSessionId: 'my-session',
  depth: 0,
  cwd: process.cwd(),
  command: 'echo hello',
});

const result = await manager.wait(task.id);
if (result.kind === 'process') {
  console.log(result.exitCode, result.output); // 0 'hello\n'
}

unsubscribe();
await manager.shutdown();
```

Task results and states are discriminated by `kind`: `exitCode` and `signalCode` exist only on
`process` results and `usage` only on `agent` results, so check `kind` before reading them.

## Main exports

| Area               | Exports                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Background tasks   | `BackgroundTaskManager` (`spawn`, `wait`, `list`, `get`, `cancel`, `close`, `send`, `readLog`, `subscribe`, `shutdown`, scheduled-task pause/resume/edit), `BackgroundTaskError` |
| Runners            | `createDefaultBackgroundTaskRunners`, `createManagedShellProcessRunner`, `createScheduledTaskRunner`, `createToolInvocationBackgroundTaskRunner`, `IBackgroundTaskRunner`        |
| Shell resolution   | `resolveBackgroundTaskShellCommand`: the executable and arguments for `sh`/`bash`, PowerShell/`pwsh` or `cmd`; an unknown explicit shell is refused before spawning              |
| State machine      | `transitionBackgroundTaskStatus`, `isTerminalBackgroundTaskStatus`, `getBackgroundTaskTransitions`                                                                               |
| Logs and observers | `createBackgroundTaskLogPage`, `createLimitedOutputCapture`, `deliverToObservers`                                                                                                |
| Subagents          | `SubagentManager` (spawn, wait, send, cancel agent jobs through an `ISubagentRunner`), `createWorktreeSubagentRunner`, `subagentExecutionRoot`                                   |
| Providers          | `createProviderFromProfile`, `createProviderFromExactProfile`, `resolveProfileApiKey`                                                                                            |
| Connection checks  | `verifyConnectionEnvironment`, `findConnectionEnvironmentDivergence`, `sealConnectionEnvironment`, `connectionEnvironmentNames`, `TRANSPORT_ENVIRONMENT`                         |

- **Subagents.** `SubagentManager` runs `agent` tasks through a runner you supply (for example the
  child-process runner in `@robota-sdk/agent-subagent-runner`). Wrapping that runner with
  `createWorktreeSubagentRunner` gives a job requested with `isolation: 'worktree'` its own Git
  worktree, prepared and removed by your `ISubagentWorktreeAdapter`; the `WorktreeCreate` and
  `WorktreeRemove` hooks fire around it.
- **Logs.** Task handles may report `logPath` and `transcriptPath`. The manager copies them into the
  task state, so a session record can store references while high-frequency output stays in
  append-only JSONL logs.
- **Providers across processes.** `createProviderFromExactProfile` builds a provider from a profile
  another process resolved, exactly as given, and refuses a credential reference that resolves to
  nothing. `sealConnectionEnvironment` records a keyed digest of the variables that decide where a
  provider connects (base URL, proxy and TLS settings, the credential variable), and
  `verifyConnectionEnvironment` checks another process's environment against it, so a hand-off to a
  process that would connect somewhere else can be refused; `findConnectionEnvironmentDivergence`
  names the variables that differ.

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract, ownership and boundaries
- [Hook event catalog](../agent-core/docs/HOOK-CATALOG.md) — the `WorktreeCreate`/`WorktreeRemove` hooks

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
