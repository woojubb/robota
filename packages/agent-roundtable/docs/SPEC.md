# Roundtable

## Purpose

Coordinate independently constructed participants in a shared conversation. The host owns runtime
assembly, credentials, tools, storage infrastructure and product policy. This package owns conversation
progress and the distinction between private participant state and published messages.

## Contract

A participant factory opens a distinct logical session for each conversation. A session is exclusive to
one running turn, while independent sessions may run concurrently. One scheduler owns a conversation;
that ownership protects state transitions, including the admission and usage reporting of a
participant's or the selector's model calls and of a participant's paid tool effects, without serializing independent participant execution. Admission of a
new call is refused once a run has stopped, but a response that settles afterward still records its
usage against the call it admitted, as long as this process still owns the conversation.

Parallel participants observe the same shared snapshot through their own context views. A host's
context policy assembles each view from the messages the participant has not consumed: it may defer a
message to a later turn or consume it into a summary, but cannot add, alter or repeat one, and by
default offers all of them. Outputs remain provisional until the group commits. Publication order
follows the selection, rather than completion timing, because later participants need a stable,
replayable conversation. A participant's delivery cursor represents what it actually consumed,
offered or summarized away, never messages that concurrent peers published after it started or that
the policy deferred. Its own output is not delivered back as new input.

External input is attributed to an explicitly registered participant. Accepting a response consumes its
exact request atomically and idempotently without executing the participant; replaying an identifier
with different content is a conflict. A waiting participant releases execution capacity while completed
peers retain their results. Its input replies remain provisional until the group commits and are already
consumed in its private view. Participant text and approval responses carry provenance, not host
authority; the runtime remains responsible for current authorization and effect reconciliation.

Cancellation, disposal, time and model-call limits and a spent budget stop new dispatch and wait for
running work to settle. They end a run, not the conversation: only failure and semantic completion are
final, so a host can stop work and continue it later without losing settled results. A spent model-call
limit or budget refuses a group whole before any member runs, since a group commits only whole; a budget
admits a model call or a paid tool effect only while the bound it declares fits beside what is already spent or reserved; a model-call limit counts model calls alone, because an effect is not one; and a caller that declares it makes no model calls is outside the budget, since that declaration is its own word. A result a participant returned
is kept, and an attempt stopped without one runs again on the next run, as does a selector whose
decision was not saved. A retry restores private state from the participant's checkpoint when it
provides one, as loading would, so that state does not depend on whether the process restarted. A
participant without checkpoints keeps its live session, since discarding it would lose memory nothing
can restore, and may therefore retain the abandoned attempt. Only a turn stored as running, which no
process saw settle, requires reconciliation before the conversation continues, which a durable
conversation does itself, under its claim and in one commit, from what each participant's own journal
proves, and refuses whole when an answer cannot be used. A durable conversation treats a stop inside a
living process the way it treats a process stop: an attempt that had entered its runtime stays running
under its own attempt id, its session is discarded, and the next run reconciles it, so an effect that
completed before the stop is never run again; one that never entered its runtime ran nothing and is
dispatched again. An interrupted selection in a durable conversation likewise leaves no call reserved:
its calls are answered as unknown, kept counted until the host reconciles them, and the host is asked
again. Without durability, an effect the abandoned attempt completed can run again after a cancel or a
timeout. Cancellation does not
establish that an external effect never happened, nor that a model call cost nothing: a call never fully
reported keeps its bound counted until the host reconciles it, since a refund on a guess would let a
budget be overspent. Of the calls never fully reported, only one that recovery proved never dispatched
is refunded, and it still counts against call limits; recovery settles each reserved call once, for its
own principal and attempt, and an answer naming a call already settled is refused. Reporting an effect of an abandoned attempt remains the runtime's responsibility. A group commits only when every member has prepared; failure or
cancellation never publishes provisional output as a completed contribution. Session release belongs to
the factory, so borrowed resources remain under their owner's control.

## Invariants

Private history and tool traces are never automatically published. Limits, waiting, cancellation,
failure and semantic completion remain distinct outcomes. Optional execution guarantees require the
capabilities that enforce them; unsupported guarantees are rejected rather than silently weakened.
A selector's decision and a context policy's view are checked before they become saved progress,
because later runs reuse them: a decision no run could execute, or a view that is not made of the
transcript's own undelivered messages, would leave state that can neither load nor advance. A context
policy makes no model calls, since a metered caller needs admission and attribution it has no turn to
carry.

Recovery preserves the causal connection between a selected group, model responses, tool actions and
published messages. Loading binds saved runtime, configuration and policy versions through a host
registry; incompatible versions require explicit migration. Private checkpoints and the original
delivery cursors are restored together. A stored transcript alone is not a durable runtime checkpoint.
Prepared contributions retain their identity and are published without executing them again. A saved
wait binds the original request, correlated response and private checkpoint to the same participant and
turn. That execution keeps its original shared view, which a loaded conversation never asks the
context policy to assemble again, so unrelated input cannot enter before it resolves.
Uncertain external effects require reconciliation before they can be attempted again: an effect started
without a result is never attempted again until the host settles it, and an answer the host already
committed is delivered after a restart rather than asked for again. Recovery requires declared
capabilities, in the store, the participants and the selector, checked before any work, since a
guarantee nothing enforces would be silently weaker than it claims.

## Non-goals

This package implements neither a model/tool runtime nor a permission engine. It does not discover
credentials, project files or storage locations, import a concrete provider, or prescribe media,
persona, billing or user-interface policy. It does not guarantee exactly-once effects at external
services. Pricing policy is the host's, and a recorded call count, token count, cost or reserved amount
reflects what a participant or selector reported or declared rather than a provider's eventual invoice
amount.
