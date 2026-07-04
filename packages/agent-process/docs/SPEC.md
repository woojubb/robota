# @robota-sdk/agent-process — Package Specification

## Scope

Domain-free child-process lifecycle primitives for the Robota SDK (CORE-023). It owns the one
thing every process-spawning package needs and none should re-implement: **reliably terminating a
spawned process and its descendants**. Cohesion comes from that single responsibility, not the
broad word "process" — this package is deliberately NOT a catch-all for process utilities.

Current surface:

- **`killProcessTree`** — terminate a `ChildProcess` and its whole process group with a
  SIGTERM → grace → SIGKILL escalation, settling on the real `exit` event (never synchronously,
  never on the misleading `child.killed` flag). Optional pre-kill hook for graceful protocols
  (e.g. an IPC `cancel` message before signalling).
- **`DEFAULT_KILL_GRACE_MS`** — the shared grace window (2000 ms), previously duplicated across
  runner packages.

This package is published (`@robota-sdk/*` scope) with **zero `@robota-sdk` dependencies**, so any
package — `agent-executor`, `agent-tools`, `agent-subagent-runner`, or an external consumer — can
depend down onto it without a cycle. `agent-testing`'s PTY runner uses a different process
abstraction (`node-pty`'s `IPty`), so it applies the same escalation _pattern_ rather than this
`ChildProcess` helper.

## Boundaries

| Rule                    | Detail                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Zero `@robota-sdk` deps | Pure Node `child_process`/`process`; no `@robota-sdk` dependency, so it can be consumed from anywhere without cycle risk                   |
| Domain-free             | No agent/AI/tool/session concepts — only OS process termination. A leaf primitive, not an assembly layer                                   |
| Single responsibility   | Process-tree termination only. Spawning, stdio wiring, and timeout policy stay with each caller; this package does not own a spawn wrapper |
| Cross-platform          | POSIX uses process-group signals (`process.kill(-pid, …)`); Windows escalates via `taskkill /T /F`. Callers spawn `detached` on POSIX      |

## Architecture Overview

```
agent-process/src
  index.ts               ← barrel: killProcessTree, DEFAULT_KILL_GRACE_MS, types
  kill-process.ts        ← the escalation state machine
  __tests__/
    kill-process.test.ts ← escalation tests against SIGTERM-ignoring fixtures
```

### Termination contract

`killProcessTree(child, options)` returns a promise that resolves once the process has actually
exited:

1. **Already exited → resolve immediately.** If `child.exitCode !== null` or `child.signalCode !==
null`, the process is gone; resolve without signalling.
2. **Pre-kill hook (optional).** `options.preKill` runs first — used by the IPC subagent path to
   send a graceful `{ type: 'cancel' }` message before any signal. A throwing/rejecting pre-kill
   is swallowed (best-effort; the signal escalation still runs).
3. **Initial signal.** Send `options.signal` (default `SIGTERM`) to the process group on POSIX
   (`process.kill(-pid, sig)` — requires the caller to have spawned `detached: true` so the child
   is a group leader) with a fallback to `child.kill(sig)`; on Windows, `child.kill(sig)`.
4. **Grace window.** After `options.graceMs` (default `DEFAULT_KILL_GRACE_MS`), if the process has
   not exited, force-kill: POSIX `process.kill(-pid, 'SIGKILL')`, Windows `taskkill /pid <pid> /T
/F`.
5. **Settle on exit.** The promise resolves from the `exit` event, not synchronously — a caller
   that awaits it knows the tree is truly gone (fixes "immediate reject" and the `child.killed`
   dead-guard, and lets resource cleanup — e.g. temp-dir removal — safely follow).

`killProcessTree` never rejects for a process that will not die; SIGKILL to a process group is the
terminal action. It resolves when `exit` fires.

## Type Ownership

| Type                  | File              | Description                                                        |
| --------------------- | ----------------- | ------------------------------------------------------------------ |
| `IKillProcessOptions` | `kill-process.ts` | Escalation options: `graceMs`, `signal`, `processGroup`, `preKill` |

## Public API Surface

| Export                  | Kind     | Description                                                                             |
| ----------------------- | -------- | --------------------------------------------------------------------------------------- |
| `killProcessTree`       | function | Terminate a `ChildProcess` and its group: SIGTERM → grace → SIGKILL, settling on `exit` |
| `DEFAULT_KILL_GRACE_MS` | const    | Shared grace window in ms (2000) between the initial signal and the forced SIGKILL      |
| `IKillProcessOptions`   | type     | Options for `killProcessTree`                                                           |

## Error Taxonomy

`killProcessTree` does not throw for cleanup: signalling a process that is already dead (`ESRCH`)
is caught and ignored, and a throwing `preKill` is swallowed. It rejects only if given a child with
no `pid` and no exit state (a programming error — the child was never spawned).

## Class Contract Registry

No classes. The package is a single factory-style async function plus one constant.

## Test Strategy

`kill-process.test.ts` spawns real SIGTERM-ignoring fixtures (`trap '' TERM`) and asserts: (1) a
cooperative child exits on SIGTERM before the grace window; (2) a SIGTERM-ignoring child is
SIGKILLed after the grace window and the returned promise resolves only after exit; (3) an
already-exited child resolves immediately without signalling; (4) `preKill` runs before signalling
and a throwing `preKill` does not abort escalation; (5) a detached child's grandchild is reaped by
the process-group kill (the CORE-018 grandchild-survival regression).
