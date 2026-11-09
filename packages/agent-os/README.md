# @robota-sdk/agent-os

Node host primitives for the Robota SDK, one subpath per primitive: rooted file reads and writes that a
path swap cannot redirect, nonblocking operation locks for cooperating processes, and termination of a
spawned process together with its descendants. The package has no `@robota-sdk` dependencies and runs
on Node.js 22.12 or later only.

## Install

```bash
npm install @robota-sdk/agent-os
```

There is no root export. Import the subpath of the primitive you use:

| Import path                                   | Primitive                                            | Install alongside |
| --------------------------------------------- | ---------------------------------------------------- | ----------------- |
| `@robota-sdk/agent-os/file-authority`         | Bounded root-relative reads and atomic UTF-8 writes  | `koffi`           |
| `@robota-sdk/agent-os/file-authority/testing` | Test hooks for the file authority's own tests        | `koffi`           |
| `@robota-sdk/agent-os/node-lock`              | Nonblocking operation locks between local processes  | `koffi`           |
| `@robota-sdk/agent-os/process`                | `killProcessTree` for a spawned process and its tree | nothing           |

`koffi` is an optional peer dependency, pinned to the exact version the package is qualified with. Only the
`file-authority` and `node-lock` subpaths load it; a project that imports only `process` installs and loads no
native binding.

## file-authority

Opaque, stable, root-relative bounded reads and atomic UTF-8 writes for supported Node.js hosts. The
package retains a native directory authority and resolves each requested path segment relative to
that authority, so a symlink, junction, or pathname replacement cannot redirect an in-progress
operation.

```typescript
import {
  createStableRootedFileReader,
  createStableRootedFileWriter,
} from '@robota-sdk/agent-os/file-authority';

using reader = createStableRootedFileReader('/approved/root');
const bytes = reader.readBytes(['payloads', 'record.json'], 1_048_576);

using writer = createStableRootedFileWriter('/approved/root');
writer.writeUtf8(['output', 'result.json'], '{"complete":true}\n');
```

`readBytes()` accepts validated single path segments and a mandatory byte limit. It returns
`undefined` only for a missing entry; unsafe entries, unsupported hosts, changed files, and exceeded
budgets throw a `StableFileAuthorityError` whose `code` names the refusal. Raw descriptors, Windows
handles, canonical paths, and pathname fallbacks are never exposed. `writeUtf8()` creates missing
parents and atomically commits through the retained root authority. Close either authority with
`close()`, or let `using` dispose it.

The qualified native targets are Linux x64/arm64, macOS x64/arm64, and Windows x64 on Node.js
22.12 or newer. Other targets fail closed with `UNSUPPORTED_BACKEND`.

Within the agent runtime, `agent-framework` uses it for trusted workspace reads, `agent-session` for
session-log payload reads, and `agent-tools` for contained host writes.

## node-lock

Nonblocking operation locks for cooperating local processes. A guard is held until release or process exit.
Every participant must use the same lock directory and name, and the guard path must remain in place while the
namespace is in use.

The lock does not fence older implementations or a program that replaces the guard path. Network filesystem
behavior is not qualified.

## process

`killProcessTree` terminates a spawned process **and its descendants** with a SIGTERM → grace → SIGKILL
escalation, and resolves only once the process has actually exited.

Every package that spawns a child process needs the same thing when a run is cancelled or times out: kill the
process _and everything it spawned_, escalate if it ignores SIGTERM, and know when it is truly gone. Rolled by
hand, that logic drifts — one site forgets the SIGKILL escalation, another kills only the direct child
(leaving grandchildren orphaned), a third rejects synchronously before the process has exited. This subpath is
the single source of truth so those bugs are fixed once.

```ts
import { spawn } from 'node:child_process';
import { killProcessTree } from '@robota-sdk/agent-os/process';

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

| Export                  | Description                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `killProcessTree`       | Terminate a `ChildProcess` and its group: SIGTERM → grace → SIGKILL, settling on `exit` |
| `DEFAULT_KILL_GRACE_MS` | Shared grace window in ms (2000) between the initial signal and the forced SIGKILL      |
| `IKillProcessOptions`   | `{ graceMs?, signal?, processGroup?, preKill? }`                                        |

On Windows the forced step after the grace window uses `taskkill /T /F`, which ends the whole tree.

See [`docs/SPEC.md`](./docs/SPEC.md) for the contracts and security boundaries.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
