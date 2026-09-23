# @robota-sdk/agent-process — Package Specification

## Purpose

Domain-free child-process lifecycle primitives. It owns the one thing every process-spawning
package needs and none should re-implement: reliably terminating a spawned process and its
descendants. Cohesion comes from that single responsibility — this package is deliberately not a
catch-all for process utilities.

Published with **zero `@robota-sdk` dependencies**, so any package can depend on it without a
cycle. The TUI-owned PTY runner uses a different process abstraction (`node-pty`'s `IPty`) and
therefore cannot depend on this package's `ChildProcess`-shaped helper directly — it applies the
same escalation pattern independently rather than sharing the implementation.

## Contract

`killProcessTree(child, options)` returns a promise that resolves once the process has actually
exited, following this escalation:

1. Already-exited processes resolve immediately without signalling.
2. An optional pre-kill hook runs first (e.g. a graceful IPC `cancel` message before any signal);
   if it throws or rejects, that is swallowed and escalation still proceeds.
3. The initial signal (default `SIGTERM`) is sent to the whole process group on POSIX, requiring
   the caller to have spawned the child `detached: true` so it is a group leader; Windows signals
   the child directly.
4. If the process has not exited after the grace window, it is force-killed (`SIGKILL` on POSIX,
   `taskkill /T /F` on Windows).
5. The promise settles on the real `exit` event — never synchronously, and never on the
   `child.killed` flag, which is misleading. This lets dependent cleanup (e.g. temp-dir removal)
   safely follow.

It never rejects for a process that will not die — SIGKILL to a process group is the terminal
action. Signalling an already-dead process (`ESRCH`) is caught and ignored. It rejects only when
given a child with no `pid` and no exit state, which is a programming error (the child was never
spawned).

## Non-goals / Boundaries

- No `@robota-sdk` dependency — pure Node `child_process`/`process`, consumable from anywhere.
- No agent/AI/tool/session concepts — only OS process termination.
- Does not own spawning, stdio wiring, or timeout policy — those stay with each caller.
