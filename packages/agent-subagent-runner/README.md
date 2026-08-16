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
import {
  createChildProcessSubagentRunnerFactory,
  isSubagentWorkerModeArgv,
  runSubagentWorkerMain,
} from '@robota-sdk/agent-subagent-runner';
import type {
  IProviderDefinition,
  IProviderDefinitionConfig,
  IToolWithEventService,
} from '@robota-sdk/agent-core';
import type { ISubagentWorktreeAdapter } from '@robota-sdk/agent-executor';

declare const providerConfig: IProviderDefinitionConfig;
// The concrete worktree adapter (git/fs I/O) is owned and injected by the composition root.
declare const worktreeAdapter: ISubagentWorktreeAdapter;

// ARCH-021: YOUR product's surface, built at the CHILD's execution root. This package composes
// nothing — an optional parameter falling back to defaults is exactly the defect the port removes.
declare const createMyTools: (context: { readonly cwd: string }) => IToolWithEventService[];
declare const myProviderDefinitions: readonly IProviderDefinition[];

// DIST-006: your entry IS the worker. Dispatch before starting your app, so a subagent child
// re-enters here instead of booting the whole product.
if (isSubagentWorkerModeArgv(process.argv)) {
  runSubagentWorkerMain({
    createTools: createMyTools,
    providerDefinitions: myProviderDefinitions,
  });
}

const factory = createChildProcessSubagentRunnerFactory({
  // How to start a copy of THIS artifact. There is no default: only this process knows how it was
  // packaged. A bundled build names the file it is running; a single-file compiled binary names
  // nothing, because `process.execPath` is the binary and re-executing it re-enters its entry.
  workerEntry: { execPath: process.execPath, args: [process.argv[1] ?? ''] },
  providerConfig,
  logsDir: '.robota/logs',
  worktreeAdapter, // required: no concrete git default — inject the port at the composition root
});
```

Pass `factory` to `createAgentRuntime({ subagentRunnerFactory: factory })`.

## API

### Functions

| Export                                             | Description                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `createChildProcessSubagentRunnerFactory(options)` | Returns a `TSubagentRunnerFactory` that spawns subagents in child processes |
| `isSubagentWorkerModeArgv(argv)`                   | True when this process was started as a subagent worker                     |
| `runSubagentWorkerMain()`                          | Enters worker mode; refuses loudly (exit 2) without an IPC channel          |

### Classes

| Export                       | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `ChildProcessSubagentRunner` | Implements `ISubagentRunner` using `child_process.spawn` |

### Types

| Export                               | Description                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `IChildProcessSubagentRunnerOptions` | Options for `createChildProcessSubagentRunnerFactory`      |
| `ISubagentWorkerEntry`               | How to spawn a copy of the running artifact in worker mode |
| `ISubagentWorkerStartPayload`        | IPC payload sent from parent to worker on start            |
| `TSubagentWorkerParentMessage`       | Union of all messages the parent sends to the worker       |
| `TSubagentWorkerChildMessage`        | Union of all messages the worker sends to the parent       |
| `TSubagentWorkerWireValue`           | Serializable value type used in IPC messages               |

### Type Guards

| Export                          | Description                               |
| ------------------------------- | ----------------------------------------- |
| `isSubagentWorkerParentMessage` | Narrows to `TSubagentWorkerParentMessage` |
| `isSubagentWorkerChildMessage`  | Narrows to `TSubagentWorkerChildMessage`  |

## Dependencies

- `@robota-sdk/agent-executor` — worktree isolation and background task primitives
- `@robota-sdk/agent-framework` — runtime types (`ISubagentRunner`, `TSubagentRunnerFactory`)

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
