# @robota-sdk/agent-subagent-runner

Child-process subagent runner for the Robota SDK. Runs subagents in isolated child processes with IPC, worktree isolation, and log streaming.

## Installation

```bash
pnpm add @robota-sdk/agent-subagent-runner
```

## Overview

This package is an optional add-on for `@robota-sdk/agent-framework`. It enables spawning subagents in separate Node.js child processes, giving each subagent full process isolation while maintaining structured IPC communication back to the parent session.

```
agent-cli
  └── createChildProcessSubagentRunnerFactory()
        └── ChildProcessSubagentRunner  ← this package
              ├── fork()                ← Node.js child_process.fork
              ├── IPC messages          ← TSubagentWorkerParentMessage / TSubagentWorkerChildMessage
              └── worktree isolation    ← via agent-executor
```

## Usage

```typescript
import { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';

const factory = createChildProcessSubagentRunnerFactory({
  providerConfig,
  logsDir,
  // workerPath is optional — defaults to the bundled worker entry point
});
```

Pass `factory` to `createAgentRuntime({ subagentRunnerFactory: factory })`.

## API

### Functions

| Export                                             | Description                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `createChildProcessSubagentRunnerFactory(options)` | Returns a `TSubagentRunnerFactory` that spawns subagents in child processes |
| `getDefaultSubagentWorkerPath()`                   | Resolves the path to the bundled worker entry point                         |

### Classes

| Export                       | Description                                             |
| ---------------------------- | ------------------------------------------------------- |
| `ChildProcessSubagentRunner` | Implements `ISubagentRunner` using `child_process.fork` |

### Types

| Export                               | Description                                           |
| ------------------------------------ | ----------------------------------------------------- |
| `IChildProcessSubagentRunnerOptions` | Options for `createChildProcessSubagentRunnerFactory` |
| `ISubagentWorkerStartPayload`        | IPC payload sent from parent to worker on start       |
| `TSubagentWorkerParentMessage`       | Union of all messages the parent sends to the worker  |
| `TSubagentWorkerChildMessage`        | Union of all messages the worker sends to the parent  |
| `TSubagentWorkerWireValue`           | Serializable value type used in IPC messages          |

### Type Guards

| Export                          | Description                               |
| ------------------------------- | ----------------------------------------- |
| `isSubagentWorkerParentMessage` | Narrows to `TSubagentWorkerParentMessage` |
| `isSubagentWorkerChildMessage`  | Narrows to `TSubagentWorkerChildMessage`  |

## Dependencies

- `@robota-sdk/agent-executor` — worktree isolation and background task primitives
- `@robota-sdk/agent-framework` — runtime types (`ISubagentRunner`, `TSubagentRunnerFactory`)

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../LICENSE-COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
