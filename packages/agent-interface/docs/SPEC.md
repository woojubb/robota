# SPEC.md — @robota-sdk/agent-interface

## Purpose

This package owns the **type contracts** shared across the layers of the Robota SDK: what a
session, a command, a background task, a usage measurement, a transport adapter and a terminal
interaction are, described without any of the code that implements them. It is one package with one
subpath per contract family — `session` (with `session/testing`), `session-mobility`, `command`,
`execution`, `analytics`, `transport` (with `transport/testing`) and `tui` — so an importer names
the family it uses and its bundle carries nothing of the others.

A contract family holds type declarations and, at most, small pure accessors and discriminators
over its own types. `session-mobility` is the one family that carries behavior (the handoff state
machine and the per-connection authority check), and it does no I/O: the host supplies the
carrier, the sealing, the record decoding and the persistence.

## Invariants

- **Layering between subpaths.** A subpath imports only itself, the entry of a lower subpath and,
  except `analytics` and `tui`, `@robota-sdk/agent-core`. `src/layering.test.ts` holds the edges, and a
  new subpath declares its layer there. Nothing in a contract family names an implementation
  package.
- **No root export.** Every import names a family. A barrel over the families would let one import
  reach all of them.
- **Platform-neutral.** Every subpath runs in a browser, a worker and Node: no Node built-in, no
  Node global, no DOM-only global (`pnpm lint:platform` bundles each subpath to prove it).
- **`@robota-sdk/agent-core` is an optional peer dependency, and the only `@robota-sdk` package a
  declaration names.** `analytics` and `tui` need nothing; the other families name `agent-core`
  types. As a regular dependency it would install `agent-core` for an importer of `analytics` or
  `tui`, which need nothing, so the packages that import the other families declare it themselves.
- **A contract stays with its owner.** `agent-core` owns the provider contracts and every type the
  families name from it; this package adds no re-export of them. The one exception, `TActionResponse`
  from `transport`, stays as it was: `agent-ui-web` reaches it only through here.
- **Cross-subpath imports are relative paths to the other subpath's entry file** (never the package
  name and never an internal file), so the layering test sees every edge and a build keeps each
  family in its own entry.

## Design decisions

- **One package, not seven.** The families release together and the same few hosts import them
  together, so a manifest, a build and a release receipt per family buys nothing the subpath
  boundary does not. The layering is held by the test above over subpath imports, not by package
  dependency edges or a dependency-cruiser rule.
- **A contract family is extended by amending a declaration**, not by a plugin mechanism of its
  own. A consumer that needs a narrower shape declares it in its own package and states how it
  relates to the type here.

The sections below keep the contract of each family unchanged by the merge; a heading names the
subpath, and "this subpath" means that family.

## `analytics` — usage and run traces

### Scope

This subpath owns the **usage and run-trace contracts**: how many tokens a turn consumed, what it
cost, which execution unit, model, provider, and product surface it is attributed to, the per-turn
timeline a trace view renders, and the provider-neutral cross-session personal-usage report shape.

It contains type declarations only. No class, no runtime logic, no mechanism, no runtime value
export — there is no vocabulary or discriminators at runtime.

### Boundaries

| Concern                                       | Owner                               |
| --------------------------------------------- | ----------------------------------- |
| Assembling a report from recorded usage       | `agent-session-analytics`           |
| Recording usage as a turn completes           | `agent-framework`                   |
| Model pricing, and computing a turn's cost    | `agent-core`                        |
| Carrying a report across the sidecar boundary | `agent-transport`                   |
| Rendering a trace or cost view                | `agent-ui-terminal`, `agent-ui-web` |
| Session, turn and interaction contracts       | `agent-interface/session`           |

**This subpath declares the SHAPE of a measurement. It measures nothing and decides no policy** — not
what counts as a turn, not how cost is derived, not what a report should contain.

A canonical usage observation may also carry an optional prompt-execution root identity, describing
only the prompt call through its first terminal callback, not final turn settlement — that
first-callback outcome may later differ from the observation's turn outcome. Related child-span
entries (provider-call, tool-body) carry the same root linkage and timing. A provider-call child may
also carry only attested usage evidence for a table-derived cost estimate. No entry ever carries prompt,
response, tool, user, or session content.

A bounded live prompt-trace projection exposes only this execution evidence, plus correlation IDs
that are validated or opaque — a tool-call ID that joins tool children to live-only
permission-decision children, and a provider-returned request ID on an invoked provider-call child —
and a tool-body child's tool name, a label rather than tool content that is never persisted;
valid duration aggregates survive omitted detail without claiming wall-time additivity or making
invalid observations into measured work, and queue evidence describes selection for admission rather
than effects.
The provider-call child's request-ID field is live-projection-only: it is never written to the persisted
provider-call trace and never becomes a metric (the same value reaches assistant-message metadata
and live traces and logs by separate routes). None of
these entries represents final turn settlement, a cost total, detached-work completion, or collector
receipt. Older observations without the root identity remain valid. Opt-in prompt, response and tool
text never joins that projection: it has its own content batch, linked only by the prompt's trace
and root span IDs (and a tool item by its call's tool span when the trace kept one), so a consumer
that never asks for content never holds any.

**Zero dependencies by design.** Every field of every declaration here is a primitive or another
declaration in this subpath, so it depends on nothing at all — not even `agent-core`. With `tui` it is
one of the two subpaths that need nothing, and that is a property worth keeping: the moment one of
these types needs a foreign type, the boundary has moved.

Composition runs downward into it: consumers name this subpath's types, this subpath names no
session, turn, or transport type.

### Extension Points

None by design. A consumer needing a different projection declares it in its own package and states
how it relates to the types here.

### Error Taxonomy

This subpath declares no error type and throws nothing. `IUsageSnapshot.costStatus` distinguishes
`unknown` / `estimated` / `exact`, which is a statement about **confidence in a measurement**, not a
failure — local price-table calculations are estimates even for an exact model ID, while an unpriced
model yields `unknown` and no `costUsd`.

## `command` — commands

### Purpose

This subpath owns the **command contract family**: what a command is, what it returns, how it is
listed and invoked, who runs it (the runtime that owns the session, or the client the user types
into), the plugin surfaces a command host exposes, the capability descriptors a command
declares about itself, and the host's authority over lazily admitted skill instructions. A lazy
instruction activation and its supporting bytes remain subject to the host's current consent and
source; reading a supporting file grants neither another activation nor permission to execute local code. It contains type declarations only — no class, no runtime logic,
no mechanism, and no runtime value except a small set of discriminators.

**This subpath declares what a command IS; it decides nothing about what any command DOES.**

### Boundaries

| Concern                                                | Owner                                  |
| ------------------------------------------------------ | -------------------------------------- |
| Command implementations and their modules              | `agent-product/command`, command-module owners |
| Command infrastructure and reusable host APIs          | `agent-framework`                      |
| Rendering a command's result                           | `agent-ui-terminal`, `agent-ui-web`    |
| Session, interaction, event, turn and driver contracts | `agent-interface/session`              |
| Background task, workspace and subagent contracts      | `agent-interface/execution`            |

### Design decisions

- **Layer 0.** It imports no other subpath of this package; composition runs downward into
  it (e.g. `agent-interface/session` names these types, never the reverse). That direction is a
  boundary this subpath commits to, held by `src/layering.test.ts`.
- `capability-contracts` is public because the descriptors a command declares are read outside this
  package: agent-framework's capability layer re-exports them as its own types.
- The command/session boundary test (asserting a command action and a session event remain
  distinct) lives in `agent-interface/session`, not here, because it necessarily names types from
  both sides — putting it here would create an upward dependency from this Layer 0 subpath.

### Non-goals

- No extension points by design — a contract family is extended by amending a declaration, not by
  a plugin mechanism of its own.
- Declares no error type and throws nothing; a failed command is reported through
  `ICommandResult.success` as a result shape, and what follows a failure is the host's decision.

## `execution` — background tasks, subagents and execution workspaces

### Purpose

Owns the execution-bounded contract families — background tasks, background job groups, subagent
jobs, and execution workspaces — shared between the runtime that schedules execution and the surfaces
that display it. Type declarations only: no class, no runtime logic, no mechanism. A consumer that
wants behavior depends on an owner package; this one gives it the vocabulary to describe the
behavior.

### Boundaries

Not owned here:

| Concern                                                    | Owner                                     |
| ---------------------------------------------------------- | ----------------------------------------- |
| Session, interaction, event, turn and driver contracts     | `agent-interface/session`                 |
| Command contracts                                          | `agent-interface/command`                 |
| Transport adapter, config, channel and admission contracts | `agent-interface/transport`               |
| The runtime that executes a background task                | `agent-executor`, `agent-subagent-runner` |
| Persisting or projecting execution state                   | `agent-session`, `agent-transport-*`      |

### Invariants

- **Layer 0**: imports no other subpath of this package. Composition runs downward into it
  (e.g. `agent-interface/session` names these types); this subpath never names a session type.
- A `kind: 'scheduled'` background-task request carries no `permissionPolicy`, by decision: a
  schedule with `agentInstruction` wakes the host session rather than spawning an agent, and
  the woken turn runs under that session's own permission configuration. Only `kind: 'agent'` — a
  separate agent — declares a policy. A dedicated test enforces this.
- `IBackgroundTaskError` describes the shape of a failure that crossed a boundary; this subpath
  throws nothing and decides no recovery policy itself.
- No runtime value is exported, only types. The Interface Package Rule would allow publishing a
  contract's vocabulary/discriminator as a runtime value; this subpath currently needs neither.

### Design decisions

#### Forking a conversation into a background task

`IAgentBackgroundTaskRequest.resumeSessionId?` names a persisted session record the child restores
before its first turn — how a fork (a copy of a live conversation, written under a fresh id by
`/fork`) reaches a background job. Only the id travels; the conversation itself never crosses the
child-process wire. `IBackgroundTaskState.resumeSessionId?` carries it onto the task's state so a
surface can tell a fork's task from an ordinary one; absent, the child starts with an empty
conversation.

A fork is a copy, not a branch of one live thing: from the moment the record is written the two
conversations are separate records that never rejoin. Attaching follows a running fork or continues
its ended record, so observing or continuing it never merges its work into the parent.

#### Loop stop routing (`IExecutionWorkspaceEntry.loopId`)

`loopId` names the stable `/loop stop <id>` handle for a `/loop`-managed entry (fixed cadence or
self-paced) — never inferred from `taskKind` or a title string, because `/schedule` also produces
`kind: 'scheduled'` tasks that are not loops, and because a self-paced loop's own background-task
representation, when it has one, is only its disposable wake timer: `cancel-background-task` on that
timer stops the timer, not the loop. `IExecutionSelfPacedLoopSummary` is a deliberately structural
(not the full `ISessionLoopState`) subset carried by `ICreateExecutionWorkspaceSnapshotInput` —
`agent-interface/session` depends on this subpath, not the reverse, so the richer contract cannot be
imported here.

### Non-goals

None by design: a contract family is extended by amending a declaration, not by subclassing or
registering. A consumer needing a narrower shape declares it in its own package and states how it
relates to the type here.

## `session` — interactive sessions and their records

### Purpose

This subpath owns the **runtime session contracts**: what an interactive session is and exposes,
the channel a surface talks to it through, the events it emits, the handle for one turn, the
record that persists it, and the compaction trigger. It contains type declarations only, plus the
narrow accessors and discriminators the Interface Package Rule permits at the entry.

### Boundaries

| Concern                                             | Owner                               |
| --------------------------------------------------- | ----------------------------------- |
| Constructing and running a session                  | `agent-framework`, `agent-session`  |
| Persisting a session record                         | `agent-session`                     |
| Rendering a session to a surface                    | `agent-ui-terminal`, `agent-ui-web` |
| Carrying a session across a wire                    | `agent-transport-*`                 |
| Background tasks, job groups, subagents, workspaces | `agent-interface/execution`         |
| Commands and capability descriptors                 | `agent-interface/command`           |
| Usage and run-trace measurements                    | `agent-interface/analytics`         |
| Transport adapters, channels, admission             | `agent-interface/transport`         |
| Peer messaging and handoff                          | `agent-interface/session-mobility`  |

This subpath composes downward — it names execution, command and analytics contracts, and nothing
at the layer-0 packages names a type from here.

### Contract

#### Interaction channel

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

#### Session persistence

The session record is the complete resumable-record source of truth, and its store port owns CRUD
only — it never exposes a reusable absolute record path (transcript references belong to the
logger/source owner). A writer that updates only part of a loaded record must preserve every field
it does not own before overwriting its authoritative fields; a schedule restore requires a
claim-fenced complete commit because a failed write may leave either the prior record or the new one.

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

#### Session capability presence

A session either provides a capability or does not claim it — capabilities such as initialization
state, pending-turn count, and active-driver attribution are required, not optional, so a `null`
result means exactly one thing rather than being confused with "the capability isn't implemented."
Reading an absent capability is distinguished at the type level from a present capability that
legitimately returns `null`, `undefined`, or an empty result. Capability objects are local
function-valued ports and are never serialized over a transport protocol.

#### Turn identity

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

#### Runtime-tool capability

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

### Non-goals

- No extension points by design — a consumer needing a narrower session surface names one of the
  capability slices rather than depending on the whole session contract.
- Declares no error class; a turn-not-run rejection is declared as a shape here and constructed
  elsewhere, narrowed only through the exported predicate.

## `session-mobility` — peer messaging and handoff

### Purpose

This subpath owns **session mobility**: moving messages and files between live sessions (peer
messaging), and moving authority over a session to another machine (handoff). They are one axis — a peer
message and a handoff differ in what travels, data versus control — and both answer the same
question: what happens when a session is not confined to one process.

This subpath orchestrates source and destination handoff around host-supplied delivery, record
decoding, and durable persistence. It declares how authority moves, whether a settled session may
be offered, and how its resources are classified in the handoff inventory. The source retains
authority until it holds a matching acknowledgement of durable destination persistence. Illegal
phase transitions are refused without changing state; repeated acknowledgements for a committed
handoff are idempotent. A move is only ever pushed by the side that holds the session, never pulled
by another, and its authorization is the receiving operator's, asked by the host.

### Boundaries

| Concern                                  | Owner                                                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| What a session IS                        | `agent-interface/session`                                                                                                                    |
| Carrying a peer message over a wire      | `agent-transport/webrtc`, `agent-transport`                                                                                                  |
| Sealing and verifying handoff payloads   | `agent-transport`                                                                                                                            |
| Deciding whether a handoff is authorized | the receiving operator, asked by the host application; this subpath fixes that every request is asked and declares the shape of the question |
| Transport adapters, channels, admission  | `agent-interface/transport`                                                                                                                  |

### Design decisions

- **Layer 2 — the highest in this family.** It composes `agent-interface/session`, which composes
  the layer-0 owners; nothing names a type from here. Mobility is a capability added over a
  session, never a thing a session is defined in terms of.
- **One authority transaction.** Phase transitions and the source-authority predicate live here,
  independent of transport delivery. Losing a connection before a durable commit acknowledgement
  leaves the source authoritative.
- **Settled, explicit offer.** Active model and tool work prevents a handoff offer. The inventory
  reports resources that stay local or require destination resolution as well as transferred state;
  provider credentials never cross the boundary.

#### Peer messaging — two axes that must not collapse

A peer message is **not** the same as a remote-driver message: a driving message is asymmetric —
one party operates, the other is operated — while a peer message is symmetric, two sessions each
with its own agent, neither driving the other. Conflating the two would make them indistinguishable
at the point a session decides how much authority the sender has.

Admission answers two independent questions, carried separately rather than collapsed into one
boolean:

- **What did the peer present?** A token, or an explicit open decision — possession, and
  possession is copyable.
- **Where did the peer come from?** An environment proof the OS enforces — evidence with nothing
  to copy.

The resulting trust classification distinguishes "same user, same host" (produced by a
kernel-enforced rendezvous) from "token only" (a credential was presented and nothing about origin
was proven); the two are not interchangeable however convenient a single flag would be. Between two of
one user's devices, trust, locality and workspace stay separate fields of the admission: the certificate
proves the user, the carrier the locality, and the workspace is only the peer's claim. Authority comes
from trust and the capabilities local policy leaves of the certificate's, never from the other two.
Some capabilities also need the receiving operator's yes: observing and driving for every connection,
because an earlier connection's yes says nothing about who holds this one; admission is fixed for
that connection and its authority ends when the carrier closes, replaces or revokes it. Delegating, hand-off
and sending a file require the receiving operator's yes for every request. Without an operator to ask they are refused. The operator must be someone
no connected surface can speak for, or one device could approve the next. A delegated task or a file, like a
message, carries no authority: the turn a task starts is decided by the receiver's ordinary
permissions, nothing the sender attaches to the request travels with it, and a file is kept aside
as data — never run, and never placed in the model's context by arriving.

The driver-id attribution on a peer message is **display and attribution only** and must never
become an authentication or authorization input. It is also what tells the model a message is a
peer's: the request marks it from the stored attribution, never from message text, because a model
that cannot tell a peer from its operator hands the peer the operator's authority.

### Non-goals

- No handoff policy extension points; hosts supply effects, not authority decisions.
- Declares no transport failure taxonomy; protocol refusals are explicit outcomes, while failures
  of host-supplied effects propagate without transferring source authority absent a durable ack.

## `transport` — transport adapters, admission and channels

### Scope

Owns the transport contract interfaces for the Robota SDK: the standard protocol for transport
adapters (carriers such as WebSocket, HTTP or MCP) and their configurable lifecycle. This subpath is
contracts plus a small set of pure, dependency-free derivation accessors over its own owned union
types — no classes, no I/O, no side effects.

### Boundaries

- Contains type contracts and interfaces plus a small set of pure, dependency-free derivation
  accessors over its own owned union types — no classes, no I/O, no side effects.
- Depends only on `@robota-sdk/agent-core`, and only for types (`import type`) — the package emits
  zero runtime `@robota-sdk/*` dependencies.
- Imports no other subpath of this package, across every published surface.
- Does not depend on `@robota-sdk/agent-framework` or any transport implementation package.
- Implementation packages (the transport-specific packages and the headless runner) depend on this
  package for interface types, directly from their contract owner, not through `agent-framework`.

Other contract families that once lived here (command, session, background-task, subagent,
background job-group, execution-workspace, peer messaging) have moved to their own subpaths; this
subpath no longer re-exports them. This subpath's own export surface is exactly what its
entry point declares — nothing broader is implied by its history as a former omnibus.

### Transport Admission

Admission (which peers may reach a session) was not a member of any contract, so each transport
package re-decided it independently and disagreed: two transports chose opposite defaults for
whether to require a credential, and a third had no gate at all. This subpath owns the decision so
there is one place to read and one place to change it — including the access-token admission a
remote resource server makes, whose verdict is a closed set of refusal reasons that never carries
token text or claim values, so logging a verdict cannot leak a credential or an identity.

The resolved decision is SECURE BY DEFAULT: an explicit token wins, otherwise one is minted. A
transport may still run open, but only by saying so explicitly, with a required written reason —
"no credential" and "nobody thought about it" must not be indistinguishable. Failing to mint a
token throws rather than silently returning an open admission, so a transport that cannot get
entropy fails to construct instead of binding without a gate.

Access-token admission is single-tenant by design: issuer, audience and scope alone admit anyone
the issuer serves, while the host hands one shared session to every admitted peer, so the
configuration must also name the subjects or clients allowed in. An external-event grant narrows
this to exactly one principal, because the grant is what the event is attributed to: a carrier only
moves the token and the event, and no sender name it or the payload carries is identity.

The functions that produce the decision (minting, comparison, token verification) live in a
separate Node-dependent package, not here: this subpath is inert by rule (no runtime dependency
edges), and those functions need Node builtins for entropy and the network. A transport with no
remote peer declares that admission does not apply to it in its own SPEC, rather than this subpath
asserting a universal default.

### Interface Contracts

#### Adapter lifecycle

An adapter exposes a unique name, a required frozen lifecycle discriminant (`service` or
`runner`), `attach(session)`, `start()`, and `stop()`. The discriminant is required, not optional —
silence about which kind an adapter is was itself the defect: a runner used to run its entire
prompt inside `start()`, so a caller awaiting `start()` to move on to the next step could never
reach the point where a co-registered service actually started. Splitting the contract so a
runner's `start()` launches and returns, with completion awaited separately, removes that
ambiguity.

`start()` resolves at the concrete package's own documented readiness boundary. Calling `start()`
before `attach()`, or starting an already-active adapter, rejects rather than silently no-opping.
`stop()` is safe and bounded when called repeatedly, and a stopped adapter may be attached and
started again.

The bound form used by a registry (after a composition root binds a raw adapter to its exact
session type) carries no `attach` operation — the binding owner invokes the raw adapter's `attach`
once, before each start, after settings are configured. The registry never accepts a session or
stores a raw adapter directly.

A runner's completion outcome is exactly succeeded-with-zero-exit or failed-with-nonzero-exit, with
no raw underlying cause exposed through this contract. A registry aggregate may additionally record
abandonment (stopped, or rolled back during startup) for a runner that never reached that outcome;
a separate "first failure" wait reports only a genuine failure and does not treat normal stop-time
abandonment as a process failure.

#### Persisted configuration

A transport's persisted configuration is an enabled flag plus a free-form options bag, stored under
a per-transport-name key in the host's settings. A configurable transport additionally declares a
default-enabled value (used when no persisted value exists), an optional schema describing its
options (for a settings UI), and an optional validation function to run before applying
user-supplied options.

#### Registry views

The registry is split into two orthogonal views: a lifecycle view (register, start all, wait for
completion, wait for first failure, stop all) that operates on any bound adapter, and a settings
view (list, enable/disable, set options) that operates only on configurable adapters. `stopAll()` is
best-effort — it never rejects; each transport is stopped independently and any per-transport
failure is reported in the returned result rather than thrown, so one transport's failure to stop
cannot block or hide another's.

#### Payload channels

A transport may optionally host consumer-declared channels alongside its own built-in protocol, so
a domain protocol (e.g. a text-agent event stream) is one profile carried on the transport rather
than being the transport itself. A channel is declared with a unique name and its own event
vocabulary, with an opt-in flag for carrying opaque binary frames.

Binary frames carry bytes the transport never inspects; a sender-assigned, monotonically increasing
per-channel sequence number lets a receiver reassemble a chunked payload correctly regardless of
delivery order, and structured event frames share that same sequence space so interleaved binary
and event traffic has one total order. Routing an unroutable frame (unknown channel, undeclared
event, binary sent on a text-only channel, malformed envelope) is a stated error outcome, never a
silent drop.

Content-neutrality is a hard boundary here: nothing in this contract knows about audio, files, or
images. Domain-specific adapters are assembled by consumers on top of these contracts, never built
into this subpath.

### Error Taxonomy

This subpath owns the inert error shapes for lifecycle and configuration failures. Implementing
packages construct them; consumers discriminate by a stable name and code. No error class or
stateful runtime owner lives in this subpath.

### Constraints

- This subpath MUST NOT contain classes, I/O, or stateful/side-effecting runtime logic. The only
  runtime allowed beyond `interface`/`type` declarations is a small set of pure, dependency-free
  derivation accessors over this subpath's own owned union types.
- Zero runtime (emitted-JS) dependencies — all `@robota-sdk/*` imports are type-only, so no
  `@robota-sdk/*` package appears in the compiled output.
- Any new cross-cutting transport contract belongs here, not in an assembly package or an
  individual transport implementation.

## `tui` — terminal UI interactions

### Scope

Owns TUI interaction contracts for the Robota SDK. This subpath contains only type contracts —
no implementation, no classes, no runtime functions, no React, no Ink.

It defines the interaction protocol between command handlers (which may run at any layer) and TUI
renderers (which live in `agent-ui-terminal`).

### Boundaries

- **Contains only type contracts — no runtime functions, no implementation, no UI, no React.**
- Depends on nothing (`@robota-sdk/agent-core` is not required; TUI contracts are UI-layer only).
- Implementation rendering lives in the `agent-ui-terminal` package.
- `agent-ui-terminal` uses these contracts to describe TUI interaction requirements for command modules.

This subpath exports no runtime functions. The interaction union is a discriminated union — narrow
it directly on its action-kind literal; no dedicated type-guard functions are provided.

### Invariants

- This subpath must never gain runtime dependencies.
- No framework or provider knowledge may enter this subpath.
- The interaction vocabulary includes a `wizard` action kind that a transport may leave unimplemented.
