# Roundtable Robota Adapter

## Purpose

Let a Robota `Session` or a plain `Robota` agent take a turn, or pick the next speaker, inside an
`@robota-sdk/agent-roundtable` conversation — without `agent-roundtable` ever depending on either
runtime, and without a host reimplementing rendering, per-call metering, wait mapping or checkpoint
restoration for every product that wants a Robota-backed participant or selector.

## Contract

Only a turn's shared increment — the messages a participant has not already consumed — becomes that
runtime's next input; a participant's own private history, and everything a tool produced along the
way, never leaves the runtime except as the turn's final text. A message's own content cannot be read
back as a new header or a new turn boundary: whatever a peer wrote stays data, quoted, never authority.
A conversation's purpose is announced to a runtime once, on the turn that opens it, never repeated.

Every provider call a wrapped runtime makes is admitted and reported through that turn's own bound
services before it reaches the provider; a call an admission rejects is never dispatched, so a spent
limit stops a runtime before it produces a result nothing asked for. A cache hit is admitted under its
own identity when the record carries one, rather than resting on the ledger's admission-free path for a
report that arrives with none.

A `Session` participant understands exactly one shape of suspended request — the one its own
permission gate produces for a tool awaiting approval — and maps it to a roundtable wait under the
runtime's exact identity: the same execution, action and tool-call identifiers a host would need to
reason about what is being asked. Answering it neither grants standing consent nor runs the tool twice;
denying it completes the turn without ever entering the tool's effect. Any other suspended request, and
a plain `Robota` agent's suspension (which supports no continuation at all), fail the turn outright
rather than being reported as an answerable wait.

A settled turn's checkpoint restores a fresh runtime instance to the same private history, given the
same construction inputs; identity or environment that no longer matches what produced the checkpoint
is refused rather than silently accepted. A parked wait's checkpoint is a receipt naming the execution
still held by a live session, not a substitute for one — restoring it depends on that session, or a
durable record of the execution it names, still being reachable. A lease's session, provider and tools
belong to it exclusively until it is released; a second lease over any of them while the first still
holds it is refused, and releasing an already-released lease changes nothing.

A selector backed by a Robota agent trusts a decision only when the agent reaches it through the one
channel offered for reaching it, unambiguously, and only when it names conversation participants that
are actually present; every other outcome fails the selection outright, with no retry of its own — a
host that wants one decides how, at the roundtable level.

## Invariants

Tool traces and a runtime's private message history never enter the shared transcript; only a turn's
own final text does, and only once that text is non-empty after trimming. A checkpoint never carries a
live credential, a callable value, or anything that is not the runtime's own conversation content. A
delta a runtime streamed is always delivered, in the order it streamed, before the turn's outcome is
returned to the caller. A resource this package leases is never handed to a second lease while the
first is still open.

## Non-goals

This package supplies no concrete provider, transport, or command surface, and does not choose a
runtime's model, tools or permission policy — those remain the host's `createSessionOptions` /
`createAgent` closures. It does not recover a runtime that a process crash interrupted mid-turn, or
reconcile an external effect a cancelled attempt may have already started; those stay the deferred
concerns `agent-roundtable` itself declines to solve. It enforces no monetary or token budget beyond
admitting and reporting what a runtime already reports, and it does not implement Session's own
`input` or `reconciliation` waits, or a durable, cross-process resumable selector.

## Design decisions

- The default journal a `sessionParticipant` uses when a host supplies none is keyed by the runtime's
  own session id at module scope, so a parked wait reloaded through `loadRoundtable` within the same
  process resumes without a host having to plumb its own durability for that common case; it is not a
  substitute for a host's own durable journal across a process restart.
- A parked wait's checkpoint omits private history rather than duplicating it: the live session that
  produced the wait is the runtime of record for that turn, and a settled checkpoint already carries
  history once there is a boundary safe to restore from.
- A selector's agent must carry no tool of its own before the decision tool is added, and the check
  runs before any provider call: a decision an agent could reach two ways can never be trusted to have
  been reached through the one this package can verify. Its own decision tool never counts against
  that check, and is always removed again once the decision is made or the attempt fails, so a
  cancelled or failed decision never disables every later one on the same reused agent.
- A selector's agent has its history cleared before every decision and is shown the shared
  conversation itself, rendered the same way a participant's turn is: reused with no checkpoint of
  its own, it would otherwise accumulate private history a freshly reloaded selector never sees, so a
  live selector's judgment — and its cost — would drift from a reloaded one deciding from the same
  `SelectionContext`.
