# @robota-sdk/agent-subagent-runner

Child-process subagent runner for the Robota SDK. It runs each subagent in its own Node.js child
process, talks to it over a typed IPC protocol, and can wrap each job in worktree isolation and stream
its logs to disk.

## Installation

```bash
npm install @robota-sdk/agent-subagent-runner
```

## Overview

This package is an optional add-on for `@robota-sdk/agent-framework`. Without it, subagents run
in-process; with it, each subagent gets process isolation while reporting back to the parent session
over structured IPC.

```
composition root (e.g. agent-cli)
  └── createChildProcessSubagentRunnerFactory()
        └── ChildProcessSubagentRunner  ← this package
              ├── spawn()               ← a copy of the running artifact in worker mode
              ├── IPC messages          ← TSubagentWorkerParentMessage / TSubagentWorkerChildMessage
              └── worktree isolation    ← via agent-executor, with an injected worktree adapter
```

The runner composes nothing itself. The composition root supplies how to start a copy of itself
(`workerEntry`), the tool factory and provider registry the child uses, and the worktree adapter.

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

// Your product's tool surface, built at the CHILD's execution root. This package composes nothing:
// there is no default tool set or provider registry to fall back to.
declare const createMyTools: (context: { readonly cwd: string }) => IToolWithEventService[];
declare const myProviderDefinitions: readonly IProviderDefinition[];

// Your entry is the worker. Dispatch before starting your app, so a subagent child re-enters here
// instead of booting the whole product.
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
  providerDefinitions: myProviderDefinitions, // required: a job whose provider is not here is refused
  logsDir: '.robota/logs',
  worktreeAdapter, // required: no concrete git default — inject the port at the composition root
});
```

Pass `factory` as the `subagentRunnerFactory` option of `agent-framework`'s `createAgentRuntime`.

## API

### Functions

| Export                                             | Description                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `createChildProcessSubagentRunnerFactory(options)` | Returns a `TSubagentRunnerFactory` that spawns subagents in child processes |
| `isSubagentWorkerModeArgv(argv)`                   | True when this process was started as a subagent worker                     |
| `runSubagentWorkerMain(composition)`               | Enters worker mode; refuses loudly (exit 2) without an IPC channel          |

### Classes

| Export                       | Description                                              |
| ---------------------------- | -------------------------------------------------------- |
| `ChildProcessSubagentRunner` | Implements `ISubagentRunner` using `child_process.spawn` |

### Types

| Export                               | Description                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `IChildProcessSubagentRunnerOptions` | Options for `createChildProcessSubagentRunnerFactory`                            |
| `ISubagentWorkerEntry`               | How to spawn a copy of the running artifact in worker mode                       |
| `ISubagentWorkerComposition`         | What the product composes in the child: tools, provider registry, optional ports |
| `ISubagentWorkerStartPayload`        | IPC payload sent from parent to worker on start                                  |
| `TSubagentWorkerParentMessage`       | Union of all messages the parent sends to the worker                             |
| `TSubagentWorkerChildMessage`        | Union of all messages the worker sends to the parent                             |
| `TSubagentWorkerWireValue`           | Serializable value type used in IPC messages                                     |

### Type guards and wire helpers

| Export                                                                          | Description                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `isSubagentWorkerParentMessage`                                                 | Narrows to `TSubagentWorkerParentMessage`              |
| `isSubagentWorkerChildMessage`                                                  | Narrows to `TSubagentWorkerChildMessage`               |
| `SUBAGENT_WORKER_MODE_FLAG`                                                     | The argv flag that puts an entry into worker mode      |
| `encodeAgentDefinition` / `decodeAgentDefinitionDto` / `restoreAgentDefinition` | JSON-safe wire form of the subagent's agent definition |
| `encodeParentContext` / `decodeParentContextDto` / `restoreParentContext`       | JSON-safe wire form of the parent's loaded context     |

## Forked session records

If a job includes `resumeSessionId`, the composition root must provide
`ISubagentWorkerComposition.openSessionStore`. The worker opens that store for the parent request's
`cwd`, restores the copied record, and uses the same ID and store for the child `Session`, so each
completed turn is persisted back into the fork record. Only the ID crosses IPC; the conversation does
not. Jobs without `resumeSessionId` remain transient.

## Dependencies

- `@robota-sdk/agent-executor` — `ISubagentRunner`, worktree isolation, and background task primitives
- `@robota-sdk/agent-framework` — `TSubagentRunnerFactory` and session assembly for the worker
- `@robota-sdk/agent-core` — provider and tool types
- `@robota-sdk/agent-interface-execution` — subagent job contracts
- `@robota-sdk/agent-process` — process-tree termination

See [docs/SPEC.md](./docs/SPEC.md) for the package contract: required composition, IPC validation, and
how the provider connection is checked across the process boundary.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
