# SPEC.md — @robota-sdk/agent-subagent-runner

## Purpose

Optional package providing child-process subagent execution for the Robota agent runtime. It
implements `ISubagentRunner` (from `agent-executor`) by forking Node.js child processes, routing
jobs over an IPC protocol, and returning lifecycle handles to the caller. Opt-in: install only
when child-process subagent support is needed, so applications that don't use subagents carry no
extra dependency.

## Non-goals / Boundaries

- Must not import from `agent-command`, `agent-cli`, or (directly) `agent-session` — session
  lifecycle is accessed through `agent-framework` facades.
- A neutral runner must not compose the product's surface: the tool factory and provider registry
  are supplied by the composition root through a required port, never imported as defaults.
- Does not own where a worker file lives on disk — that is a packaging-step concern the
  composition root states (it supplies how to start a copy of itself, not a path).
- Does not own subagent lifecycle state machines (those live in `agent-executor`) or provider
  creation contracts (owned by `agent-interface-execution`); provider config crosses the process
  boundary as a serialized profile and is reconstructed in the worker.
- No hard-defaulted concrete git/filesystem adapter: worktree isolation is optional wrapping, and
  when enabled the adapter is a required injected port, not a built-in default.

## Invariants and guarantees

- **Required, not optional, composition.** The worker-mode entry point, the worktree adapter (when
  worktree isolation is enabled), and the worker composition all refuse loudly rather than falling
  back to a default — an optional port silently defaulting to something concrete is exactly the
  defect this package was built to avoid reintroducing.
- **Result flush before exit.** The worker must not exit until its terminal IPC message has
  actually flushed, because `process.send` is asynchronous — exiting first would let the parent's
  process-exit handler race the result and misreport a successful run as a crash, losing its usage
  payload.
- **`usage` is validated at the IPC boundary**, not merely `output` — a malformed usage object is
  rejected as a malformed message rather than spread verbatim into the parent's accounting.
- **A crash surfaces its cause.** When the child exits before producing a result, the rejection
  message includes the captured stderr tail rather than only the bare exit code, so the cause is
  visible in the error rather than only in a stream nothing read.
- **Fork jobs never cross session content over the wire.** A job carrying only a
  `resumeSessionId` has the child open the session store for the _parent's_ cwd, restore the
  record there, and persist new turns back under the same id — the forked conversation's content
  never travels through the IPC channel. A composition with no registered session store fails such
  a job outright rather than starting it with an empty history.
- **Malformed IPC messages are never silently dropped** on either side of the channel; each
  direction has an explicit rejection/error path.

## Test coverage note

The built-artifact worker contract (that a packaged copy of the running process actually enters
worker mode) is covered by the composition root's own build-gated test, not by this package: only
an artifact can be asked whether its worker starts, and a shape-only unit test here cannot catch
that class of failure.
