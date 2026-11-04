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
implement the channel port while making its central `write()` operation a no-op. Tool observations
remain typed and attached to their call identity when projected for live or historical display;
an opaque resource reference conveys provenance, never permission to retrieve its contents.

Prompt settlement belongs to the interactive-session event/capability family, not the interaction
channel: surfaces receive `permission_request` / `ask_request`, answer through `resolvePermission`
/ `resolveAsk`, and dismiss on a single canonical `prompt_resolved` event — there is no separate
"resolved" event variant per prompt kind.
Permission requests indicate whether project-scoped consent can be persisted, so presenting
surfaces can disable an unavailable choice before an answer is submitted.

Checkpoint surfaces consume a `branch_event` only after the transition is persisted, covering
checkpoint creation, restoration, rollback, explicit branch fork, and branch switch. Resume-pointer
hydration is not itself an event.

### Session persistence

The session record is the complete resumable-record source of truth, and its store port owns CRUD
only — it never exposes a reusable absolute record path (transcript references belong to the
logger/source owner). A writer that updates only part of a loaded record must preserve every field
it does not own before overwriting its authoritative fields.

A load reports which of five things happened — valid, missing, corrupt, unsupported, or locked —
rather than a bare `record | undefined`, because that collapsed "no such session" and "the snapshot
is unreadable" into one answer a caller could not act on differently. A locked record is sealed and
intact, and this process holds no key that opens it right now: it is neither missing (a recovery
path would run over a session that is still there) nor corrupt (a later unlock reads it), so it
carries nothing but why (locked keys, no keys in this process at all, or a held session whose file
changed), a writer treats it like corrupt (except for a session its own store still holds,
which that store hands back), and a listing leaves it out while the same scan says how many were
left, the locked apart from those no unlock in this process would open. A load says whether it is a
resume or a writer's read, which holds the session, or a probe, which leaves nothing behind in the
store; a save says whether its record is one this process runs or one it hands to another (a fork
job), and where its content came from. A store that seals says on every valid outcome whose the
record is, because a sealed record that opens says nothing about who sealed it and a resumed one is
fed back to the model as its own history; absent, it means a store that never seals, never a
trusted record. Every store lets a session claim its id through the read it restores from, so no
session runs from a read made before its claim, and in a store that seals that read and every later
one answer only from content the owner wrote. Raising a record to the owner's, by the digest of its
exact bytes, is what only a store that seals can do, so it lives on one member only such a store
has; a session gates on the outcome its claim read, never on that member, so a view of a store that
leaves it out loses the raise and never the gate. A sealed record crosses to another store only as a token that
carries its plaintext and names the sealed bytes it came from — the one way a process that holds no
keys (only a write grant) can continue a session — so it goes only where the record may go; it says
whether the store that issued it held the record as the owner's, the only word a process without
keys has for that, and the receiving process can say which bytes it wrote since, the only bytes the
owner's process may then vouch for. Whether an id has a writer is the store's to say — from its own
claims and lends, and from the writer markers every process over the same files keeps beside the
records — so a surface never opens a second writer of a record, in this process or another; a
record another process runs is lent to it, never handed over without a writer. The store decodes the record envelope and validates its
shape (which is inspection); no field's value but the record's own id, which must be the id it is
stored under, ever changes which of the five outcomes is reported, so the store holds no domain
policy of its own. A corrupt or unsupported outcome may still carry the record's `cwd`, read on a
best-effort basis from bytes that otherwise failed to decode, so a caller can tell which workspace
an unreadable record belongs to without being handed content it could not validate.

Self-paced repeats keep their stable identity and lifecycle in the session record, not in a
disposable scheduled-task id. A waiting loop records its next allowed instant and the reason for
that choice; a pending or running iteration records enough identity to reject stale wakes after
resume. Stopped and expired loops remain terminal records rather than silently disappearing.
An omitted-prompt marker survives alongside the loop so the host can re-read its default before
future iterations, without changing loops created with explicit instructions.

### Session capability presence

A session either provides a capability or does not claim it — capabilities such as initialization
state, pending-turn count, and active-driver attribution are required, not optional, so a `null`
result means exactly one thing rather than being confused with "the capability isn't implemented."
Reading an absent capability is distinguished at the type level from a present capability that
legitimately returns `null`, `undefined`, or an empty result. Capability objects are local
function-valued ports and are never serialized over a transport protocol.

### Turn identity

Turn source distinguishes operator, autonomous wake, peer, and admitted external-event turns.
It is attribution, not proof of admission; the owning runtime must perform source-specific
authentication before an external turn is submitted.

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

An aborted turn may resolve with a partial result marked interrupted. That partial response is
for local history, not a completed answer to an external sender.

A skill command takes its caller's cancellation, and it reaches the work the command does before it
submits its turn or runs its fork as well as that turn or fork. Until the turn exists a session-wide
abort has nothing to stop, so without the caller's signal a cancel landing while the skill is
prepared would let its turn start anyway. A command cancelled this way rejects with the signal's
reason whichever step the cancel reached, so its caller never waits for a turn that will not come.

A consumer narrows a rejection with the exported predicate rather than `instanceof`, because the
error is declared here as a shape but constructed in a package this one does not depend on. The
distinction that predicate draws matters at a transport boundary: a "turn did not run" rejection is
an outcome to report to the caller, while anything else escaping the completion promise is a
failure inside the turn and must keep surfacing as one — collapsing the two hides real failures
behind what looks like a routine queue decision.

### Runtime-tool capability

A session exposes a canonical runtime-tool capability (list + invoke, with schemas and abortable
execution) as its own surface. The session owns permission, hooks, execution/audit events, result
admission, cancellation and shutdown for it. A caller chooses whether a permission decision the call
needs may be put to a person — by default it fails closed, which is right for a caller nobody is
watching — and may name the driver a prompt is attributed to; cancelling the call withdraws a prompt
it opened. Transports may neither synthesize a
parallel command catalog nor execute commands directly.

A finished model call's tool event names the view its source declared by reference, and a driving
surface reads the document on demand, so a view's document never fans out to every surface or
into a replay; a direct call carries no view.

## Non-goals

- No extension points by design — a consumer needing a narrower session surface names one of the
  capability slices rather than depending on the whole session contract.
- Declares no error class; a turn-not-run rejection is declared as a shape here and constructed
  elsewhere, narrowed only through the exported predicate.
