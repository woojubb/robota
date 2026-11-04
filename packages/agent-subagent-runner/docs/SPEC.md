# SPEC.md — @robota-sdk/agent-subagent-runner

## Purpose

Optional package providing child-process subagent execution for the agent runtime. It
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
- **A fork job's conversation crosses the wire only from a sealing parent, and only as the
  record it holds.** From a plain parent a job carries only a `resumeSessionId`: the child opens the
  session store for the _parent's_ cwd, restores the record there, and persists new turns back under
  the same id, and the conversation never travels through the IPC channel. A sealing parent's child
  holds only a write grant and can never open a sealed record, so the parent hands over only the
  copy its fork write left in its store — never a record opened from the file, which anyone with the
  public key could have sealed — as the top-level `resumeHeld` token, never on the request, task
  state or results, and within a fixed bound, and refuses the job before anything is made for it (a
  worktree, a child) when it holds none, telling to unlock only when locked keys are why. The child
  restores that record through the gate every resume passes, so it runs it only when the parent held
  it as the owner's. The child holds no keys, so its saves of that record are never the owner's by
  themselves: it reports each by the digest of its bytes, and the parent vouches for the last of
  them only once the child has exited and disconnected, when no report can still be on its way, and
  only when the copy it handed over was the owner's and no save of it was refused. That check
  takes nothing; the record is handed over only once every other check before the spawn has passed,
  so a job refused before then can simply be run again. Queued
  fork jobs live only in the parent's memory (tasks are not persisted), so a parent that crashes
  loses them and a fresh fork is the way back. A composition with no registered session store fails
  such a job outright rather than starting it with an empty history.
- **A child seals as its parent decided.** A sealing parent's start payload carries the write grant
  its sealer issues when the payload is sent, which seals and opens nothing; the composition binds it
  before anything is built, so every store and the subagent log seal to the parent's key and the
  child never reads a keyring of its own. Binding must return a sealer whose own write grant is
  exactly the grant it was given, so that the child is known to seal to its parent's key and nothing
  else: a composition that cannot bind, or whose binding returns plain or a sealer with another
  grant, fails the job rather than writing plain. When the parent's verified key changes, each child
  already sent its payload is sent the newer grant, and one that cannot seal to it stops — before its
  run starts when it is still being built.
- **The parent reads the transcript the child writes, by one rule.** The child names its log, and
  binds a sealed one, by the session it runs — the resumed record, else the task — and the parent
  reads by the same rule, also through the worktree runner. A log with no sealed record pages by its
  display lines; in a sealed one a page's offset counts stored records, so it names the same record
  whether or not the keys are locked, and only the records on a page are opened. Whether a
  transcript is sealed travels with its path into the persisted task state, so a task restored in a
  later session still says that its path reaches no content.
- **One provider connection across the boundary.** The child builds its provider from the
  parent's effective connection exactly, and never fills a gap from its own registry. Before a
  child is spawned, every environment variable that decides where that provider connects or which
  credential it sends is compared between the parent and the environment the child will get; a
  difference refuses the job, so the parent's credential never reaches a process that would send
  it elsewhere. The child repeats the check before it builds the provider. This defends against
  misconfiguration and drift, not against a hostile child, which is why the primary check runs in
  the parent.
- **Malformed IPC messages are never silently dropped** on either side of the channel; each
  direction has an explicit rejection/error path.
- **A child's own permission ask reaches the parent's approver.** A tool call inside the child that
  needs a human decision is forwarded over the same channel and answered by whatever approver the
  parent session has — the child carries no approver of its own. A parent with none attached denies
  it immediately, unchanged from having no approver anywhere. A request still unanswered when the
  task is cancelled or the child exits is settled denied rather than left open.

## Test coverage note

The built-artifact worker contract (that a packaged copy of the running process actually enters
worker mode) is covered by the composition root's own build-gated test, not by this package: only
an artifact can be asked whether its worker starts, and a shape-only unit test here cannot catch
that class of failure.
