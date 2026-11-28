# Roundtable agent runtime Adapter

## Purpose

Let an agent runtime `Session` or a plain `ConversationAgent` agent take a turn, or pick the next speaker, inside an
`@robota-sdk/agent-roundtable` conversation — without `agent-roundtable` ever depending on either
runtime, and without a host reimplementing rendering, per-call metering, wait mapping or checkpoint
restoration for every product that wants an agent runtime-backed participant or selector.

## Contract

Only a turn's shared increment — the messages a participant has not already consumed, as the
roundtable's context policy offered them, with the summary that stands in for any it consumed instead
— becomes that runtime's next input; a participant's own private history, and everything a tool
produced along the way, never leaves the runtime except as the turn's final text. A message's own
content cannot be read back as a new header or a new turn boundary: whatever a peer wrote stays data,
quoted, never authority, and a summary a host built from it stays data too.
A conversation's purpose is announced to a runtime once, on the turn that opens it, never repeated.

Every provider call a wrapped runtime makes is admitted and reported through that turn's own bound
services before it reaches the provider; a call an admission rejects is never dispatched, so a spent
limit stops a runtime before it produces a result nothing asked for. A runtime configured, through
what the adapter can see (its provider options, a routing or managed provider, a model-backed hook),
to reach a provider by another path or to carry one admitted call on to other models is refused
before its first call, because no limit can count calls it never sees. An enforced runtime gives each call a bound taken from the request it is about to send, large enough for every attempt the provider may bill; a call whose bound cannot be established is refused rather than sent, and a call that may have been billed more than once keeps its bound counted until the host reconciles it. A paid tool effect is admitted against the budget before it starts, under a call id of its own for each admission, and is refused, never started, when the budget or its price cannot admit it; it is settled when its result arrives and, because what a tool spent is the host's to say, a model-backed one keeps its bound counted until the host reconciles it. A cache hit costs nothing to
serve, so it is reported through the ledger's admission-free cache-hit path instead, carrying its own
identity — never spending a call-limit allowance a free hit did not need.

A `Session` participant understands exactly one shape of suspended request — the one its own
permission gate produces for a tool awaiting approval — and maps it to a roundtable wait under the
runtime's exact identity: the same execution, action and tool-call identifiers a host would need to
reason about what is being asked. Answering it neither grants standing consent nor runs the tool twice;
denying it completes the turn without ever entering the tool's effect. Any other suspended request, and
a plain `ConversationAgent` agent's suspension (which supports no continuation at all), fail the turn outright
rather than being reported as an answerable wait.

A settled turn's checkpoint restores a fresh runtime instance to the same private history, given the
same construction inputs; identity or environment that no longer matches what produced the checkpoint
is refused rather than silently accepted. A parked wait's checkpoint is a receipt naming the execution
still held by a live session, not a substitute for one — restoring it depends on that session, or a
durable record of the execution it names, still being reachable. A lease holds exclusive use of its session, provider and tools until its runtime teardown finishes;
a second lease over any of them while the first still holds it is refused even when a provider is
borrowed, and repeated release awaits the same teardown. Borrowing leaves provider close responsibility
with the external owner; it does not make concurrent use safe. Resources are fixed when the lease opens;
the host must not replace them externally during a live lease.

A participant that declares itself reconcilable recovers a turn a process stopped midway from its own
durable journal, never by rerunning what the journal shows already happened: a call proven never
dispatched is refunded, a call whose report the journal holds is settled with it, and a call it cannot
prove either way stays counted. A turn whose end was journaled is answered from it, and an effect that
started without a result is never started again until the host settles it. A `Session` it wraps may use nothing that writes or waits outside that journal — automatic compaction, hooks, or an in-process prompt handler, whose wait a restart loses — and is refused before it opens; approvals reach it only as conversation waits. A run stopped inside a
living process leaves the journal as a process death at that instant would, except that a response the
provider still returns is journaled so its tokens are reported; what the Session does while unwinding
is never taken for what happened outside,
and once an attempt's turn settles or its session is released the attempt refuses every write while
staying readable for reconciliation. A turn the Session finished before a stop was observed is journaled
and returned, never discarded.

The journal this package ships for files (`./node`, Node built-ins and agent-core only) keeps one
append-only file per scope, under a directory of its own beneath the one a host passes (which it never
changes, since a host may share it), and acknowledges an append only after the line and, for a new file,
its directory entry are flushed. It refuses damage (a partial last line, a gap, an unreadable line, an
entry missing the fields its kind is read by) on every
read and append and never repairs it, because a dropped tail would be a guess made on the only history
there is; it has one writer per scope, which the conversation claim does not enforce.

A selector backed by an agent trusts a decision only when the agent reaches it through the one
channel offered for reaching it, unambiguously, and only when it names conversation participants that
are actually present; every other outcome fails the selection outright, with no retry of its own — a
host that wants one decides how, at the roundtable level.

## Invariants

Tool traces and a runtime's private message history never enter the shared transcript; only a turn's
own final text does, and only once that text is non-empty after trimming. A checkpoint never carries a
live credential, a callable value, or anything that is not the runtime's own conversation content. A
delta a runtime streamed is always delivered, in the order it streamed, before the turn's outcome is
returned to the caller, unless the run was stopped while it was being delivered. A resource this
package leases is never handed to a second lease while the first is still open.

## Non-goals

This package supplies no concrete provider, transport, or command surface, and does not choose a
runtime's model, tools or permission policy — those remain the host's `createSessionOptions` /
`createAgent` closures. It recovers an interrupted turn, whether the process died or the run was only stopped, only from a durable journal the host supplies and
supplies none itself; without one, an external effect that a cancelled attempt may have already started
is not reconciled, which stays the concern `agent-roundtable` itself declines to solve. Its callers are metered unless the host declares
enforcement: a metered caller admits and reports what a runtime already reports but cannot declare a
call's bound before dispatch, so a conversation with a budget refuses it rather than count it
unbounded. Enforcement is the host's declaration, proven when the lease opens; a bound rests on the
request's encoded size and the host's declared overhead, attempts, tool classification and paid-tool token bounds, so it is
only as sound as those declarations. It does not implement
Session's own `input` or `reconciliation` waits, or a durable, cross-process resumable selector.

## Design decisions

- The default journal a `sessionParticipant` uses when a host supplies none is keyed by the runtime's
  own session id at module scope, so a parked wait reloaded through `loadRoundtable` within the same
  process resumes without a host having to plumb its own durability for that common case; it is not a
  substitute for a host's own durable journal across a process restart.
- The file journal is its own subpath and does not use agent-session's per-execution store: a recovery
  journal is one ordered log per conversation and participant, and agent-session pulls a native
  dependency that a journal has no use for. Both encode execution records with agent-core's one value
  codec, so a record means the same on either disk.
- A reconcilable participant binds each attempt to its session and execution before the first record of
  it is journaled: the runtime chooses the execution id, and a participant interrupted on its first
  turn has no checkpoint to carry the session id. A paid effect takes a fresh call id for each
  admission, written to the journal before it is admitted, because recovery refunds by call id and the
  ledger never admits a refunded id again, while a resumed attempt reuses the journal's action id. A
  request that never got a response is hidden from the execution that resumes, since the runtime
  refuses to continue past it and nothing after it depended on it.
- A parked wait's checkpoint omits private history rather than duplicating it: the live session that
  produced the wait is the runtime of record for that turn, and a settled checkpoint already carries
  history once there is a boundary safe to restore from.
- A selector's agent must carry no tool of its own — other than the decision tool this package
  manages — before a decision is reached, and the check runs before any provider call: a decision
  an agent could reach two ways can never be trusted to have been reached through the one this
  package can verify.
- A selector's agent has its history cleared before every decision and is shown the shared
  conversation itself, rendered the same way a participant's turn is: reused with no checkpoint of
  its own, it would otherwise accumulate private history a freshly reloaded selector never sees, so a
  live selector's judgment — and its cost — would drift from a reloaded one deciding from the same
  `SelectionContext`.
