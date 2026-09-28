---
'@robota-sdk/agent-roundtable': minor
'@robota-sdk/agent-roundtable-robota': minor
---

`@robota-sdk/agent-roundtable` and `@robota-sdk/agent-roundtable-robota` are published, alongside the
rest of the fixed group (issue #3273).

`@robota-sdk/agent-roundtable` coordinates independently constructed agents and people in one shared
conversation: it selects who speaks next, runs a turn or a parallel group of turns, and publishes
their messages to a shared transcript in a stable order, while each participant keeps its own runtime
and private state. It runs no model and imports no provider — a participant can wrap a Robota
session, another agent runtime, or plain code — and ships as a platform-neutral build with zero
runtime dependencies, so it also runs in a browser.

`@robota-sdk/agent-roundtable-robota` is the Robota adapter: `sessionParticipant` runs a permission-
gated `Session` (tools, hooks, approval waits) as a participant, `robotaParticipant` runs a plain
`Robota` agent, and `robotaSelector` asks a Robota agent to pick the next speaker through one control
tool call. Every provider call either wrapper makes is metered and reported through the conversation's
own usage ledger.

Both packages were previously developed as private workspace packages under the same version; this
changeset makes no API change on its own.
