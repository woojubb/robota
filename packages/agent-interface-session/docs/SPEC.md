# SPEC.md — @robota-sdk/agent-interface-session

## Purpose

This package owns the **runtime session contracts**: what an interactive session is and exposes,
the channel a surface talks to it through, the events it emits, the handle for one turn, the
record that persists it, and the compaction trigger. It contains type declarations only, plus the
narrow accessors and discriminators the Interface Package Rule permits at the entry.

## Boundaries

| Concern                                             | Owner                               |
| --------------------------------------------------- | ----------------------------------- |
| Constructing and running a session                  | `agent-framework`, `agent-session`  |
| Persisting a session record                         | `agent-session`                     |
| Rendering a session to a surface                    | `agent-ui-terminal`, `agent-ui-web` |
| Carrying a session across a wire                    | `agent-transport-*`                 |
| Background tasks, job groups, subagents, workspaces | `agent-interface-execution`         |
| Commands and capability descriptors                 | `agent-interface-command`           |
| Usage and run-trace measurements                    | `agent-interface-analytics`         |
| Transport adapters, channels, admission             | `agent-interface-transport`         |
| Peer messaging and handoff                          | `agent-interface-session-mobility`  |

This package composes downward — it names execution, command and analytics contracts, and nothing
at the layer-0 packages names a type from here.

## Contract

### Interaction channel

The interaction channel is an in-process port, not the universal transport contract — the TUI owns
a session and subscribes to its full event map directly, while headless and remote transports use
the session capability/configurable-transport families instead. A surface must not nominally
implement the channel port while making its central `write()` operation a no-op.

Prompt settlement belongs to the interactive-session event/capability family, not the interaction
channel: surfaces receive `permission_request` / `ask_request`, answer through `resolvePermission`
/ `resolveAsk`, and dismiss on a single canonical `prompt_resolved` event — there is no separate
"resolved" event variant per prompt kind.

Checkpoint surfaces consume a `branch_event` only after the transition is persisted, covering
checkpoint creation, restoration, rollback, explicit branch fork, and branch switch. Resume-pointer
hydration is not itself an event.

### Session persistence

The session record is the complete resumable-record source of truth, and its store port owns CRUD
only — it never exposes a reusable absolute record path (transcript references belong to the
logger/source owner). A writer that updates only part of a loaded record must preserve every field
it does not own before overwriting its authoritative fields.

A load reports which of four things happened — valid, missing, corrupt, or unsupported — rather
than a bare `record | undefined`, because that collapsed "no such session" and "the snapshot is
unreadable" into one answer a caller could not act on differently. The store decodes the record
envelope and validates its shape (which is inspection), but never reads a field for its meaning —
no branch on any field's value — so it holds no domain policy of its own.

Self-paced repeats keep their stable identity and lifecycle in the session record, not in a
disposable scheduled-task id. A waiting loop records its next allowed instant and the reason for
that choice; a pending or running iteration records enough identity to reject stale wakes after
resume. Stopped and expired loops remain terminal records rather than silently disappearing.

### Session capability presence

A session either provides a capability or does not claim it — capabilities such as initialization
state, pending-turn count, and active-driver attribution are required, not optional, so a `null`
result means exactly one thing rather than being confused with "the capability isn't implemented."
Reading an absent capability is distinguished at the type level from a present capability that
legitimately returns `null`, `undefined`, or an empty result. Capability objects are local
function-valued ports and are never serialized over a transport protocol.

### Turn identity

`submit()` returns a turn handle (an id plus a completion promise) rather than nothing, because a
session runs one turn at a time and queues the rest — without a per-submission handle, two
concurrent callers could not tell which of them a session-global completion event was about.

The id is minted when a submission is accepted and kept if it waits in the queue — one submission
is one identity end to end. The completion promise **always settles**, even for a queued
submission that never runs: the co-drive queue can coalesce a same-driver input into the one
behind it, drop it at capacity, or discard it when cleared. Each such outcome rejects with a typed,
named reason (coalesced / dropped / cancelled) rather than leaving the caller waiting forever.
There is deliberately no separate "shutdown" reason — a shutdown clears the queue through the same
path as a cancel, so it reports as cancelled; a reason no code path can produce is a reason a
consumer would write a dead branch for.

A consumer narrows a rejection with the exported predicate rather than `instanceof`, because the
error is declared here as a shape but constructed in a package this one does not depend on. The
distinction that predicate draws matters at a transport boundary: a "turn did not run" rejection is
an outcome to report to the caller, while anything else escaping the completion promise is a
failure inside the turn and must keep surfacing as one — collapsing the two hides real failures
behind what looks like a routine queue decision.

### Runtime-tool capability

A session exposes a canonical runtime-tool capability (list + invoke, with schemas and abortable
execution) as its own surface. The session owns permission, hooks, execution/audit events, result
admission, cancellation and shutdown for it. Transports may neither synthesize a parallel command
catalog nor execute commands directly.

## Non-goals

- No extension points by design — a consumer needing a narrower session surface names one of the
  capability slices rather than depending on the whole session contract.
- Declares no error class; a turn-not-run rejection is declared as a shape here and constructed
  elsewhere, narrowed only through the exported predicate.
