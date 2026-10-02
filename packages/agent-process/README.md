# @robota-sdk/agent-process

Domain-free child-process termination for the Robota SDK: `killProcessTree` terminates a spawned
process **and its descendants** with a SIGTERM → grace → SIGKILL escalation, and resolves only once
the process has actually exited.

## Installation

```bash
npm install @robota-sdk/agent-process
```

Requires Node.js 22.12 or later.

## Why this exists

Every package that spawns a child process needs the same thing when a run is cancelled or times
out: kill the process _and everything it spawned_, escalate if it ignores SIGTERM, and know when
it is truly gone. Rolled by hand, that logic drifts — one site forgets the SIGKILL escalation,
another kills only the direct child (leaving grandchildren orphaned), a third rejects synchronously
before the process has exited. This package is the single source of truth so those bugs are fixed
once.

It has no `@robota-sdk` dependencies, so `agent-executor`, `agent-tools`, `agent-subagent-runner`
and any external consumer can depend on it without a cycle.

## Usage

```ts
import { spawn } from 'node:child_process';
import { killProcessTree } from '@robota-sdk/agent-process';

// Spawn detached on POSIX so the child becomes a process-group leader (grandchildren die with it).
const child = spawn('sh', ['-c', 'long-running-thing'], { detached: process.platform !== 'win32' });

// Later — on cancel/timeout:
await killProcessTree(child, { processGroup: true });
// resolves once the whole tree has exited; safe to clean up temp dirs after this.
```

For a forked worker that speaks IPC, send a graceful cancel first via `preKill`:

<!-- doc-example-skip: illustrative snippet — sendWorkerMessage is the consumer's own IPC helper, not exported here -->

```ts
await killProcessTree(child, {
  preKill: () => sendWorkerMessage(child, { type: 'cancel' }),
});
```

## API

| Export                  | Description                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `killProcessTree`       | Terminate a `ChildProcess` and its group: SIGTERM → grace → SIGKILL, settling on `exit` |
| `DEFAULT_KILL_GRACE_MS` | Shared grace window in ms (2000) between the initial signal and the forced SIGKILL      |
| `IKillProcessOptions`   | `{ graceMs?, signal?, processGroup?, preKill? }`                                        |

On Windows the forced step after the grace window uses `taskkill /T /F`, which ends the whole tree.

See [`docs/SPEC.md`](./docs/SPEC.md) for the full termination contract.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
