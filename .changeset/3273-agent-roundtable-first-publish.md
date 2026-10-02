---
'@robota-sdk/agent-roundtable': minor
'@robota-sdk/agent-roundtable-robota': minor
---

`@robota-sdk/agent-roundtable` and `@robota-sdk/agent-roundtable-robota` are published, alongside the
rest of the fixed group (issue #3273).

`@robota-sdk/agent-roundtable` coordinates independently constructed agents and people in one shared
conversation: it selects who speaks next, runs a turn or a parallel group of turns, and publishes
their messages to a shared transcript in a stable order, while each participant keeps its own runtime
and private state. It runs no model and imports no provider — a participant can wrap a ConversationAgent
session, another agent runtime, or plain code — and ships as a platform-neutral build with zero
runtime dependencies, so it also runs in a browser.

`@robota-sdk/agent-roundtable-robota` is the ConversationAgent adapter: `sessionParticipant` runs a permission-
gated `Session` (tools, hooks, approval waits) as a participant, `runtimeParticipant` runs a plain
`the agent runtime` agent, and `runtimeSelector` asks a ConversationAgent to pick the next speaker through one control
tool call. Every provider call either wrapper makes is metered and reported through the conversation's
own usage ledger.

Both packages were previously developed as private workspace packages under the same version; this
changeset makes no API change on its own.
