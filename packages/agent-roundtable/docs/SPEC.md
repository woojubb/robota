# Roundtable

## Purpose

Coordinate independently constructed participants in a shared conversation. The host owns runtime
assembly, credentials, tools, storage infrastructure and product policy. This package owns conversation
progress and the distinction between private participant state and published messages.

## Contract

A participant factory opens a distinct logical session for each conversation. A session is exclusive to
one running turn, while independent sessions may run concurrently. One scheduler owns a conversation;
that ownership protects state transitions without serializing independent participant execution.

Parallel participants observe the same shared snapshot through their own context views. Their outputs
remain provisional until the group commits. Publication order follows the selection, rather than
completion timing, because later participants need a stable, replayable conversation. A participant's
delivery cursor represents what it actually consumed, never messages that concurrent peers published
after it started. Its own output is not delivered back as new input.

External input is attributed to an explicitly registered participant. Accepting a response consumes its
exact request atomically and idempotently without executing the participant; replaying an identifier
with different content is a conflict. A waiting participant releases execution capacity while completed
peers retain their results. Its input replies remain provisional until the group commits and are already
consumed in its private view. Participant text and approval responses carry provenance, not host
authority; the runtime remains responsible for current authorization and effect reconciliation.

Cancellation stops new dispatch and waits for running work to settle. It does not establish that an
external effect never happened. A failed or cancelled group must not publish provisional output as a
completed contribution. Session release belongs to the factory, so borrowed resources remain under
their owner's control.

## Invariants

Private history and tool traces are never automatically published. Limits, waiting, cancellation,
failure and semantic completion remain distinct outcomes. Optional execution guarantees require the
capabilities that enforce them; unsupported guarantees are rejected rather than silently weakened.

Recovery preserves the causal connection between a selected group, model responses, tool actions and
published messages. Loading binds saved runtime, configuration and policy versions through a host
registry; incompatible versions require explicit migration. Private checkpoints and the original
delivery cursors are restored together. A stored transcript alone is not a durable runtime checkpoint.
Prepared contributions retain their identity and are published without executing them again. A saved
wait binds the original request, correlated response and private checkpoint to the same participant and
turn. That execution keeps its original shared view, so unrelated input cannot enter before it resolves.
Uncertain external effects require reconciliation before they can be attempted again.

## Non-goals

This package implements neither a model/tool runtime nor a permission engine. It does not discover
credentials, project files or storage locations, import a concrete provider, or prescribe media,
persona, billing or user-interface policy. It does not guarantee exactly-once effects at external
services or a provider's eventual invoice amount.
