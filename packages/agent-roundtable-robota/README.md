# @robota-sdk/agent-roundtable-robota

Runs a Robota `Session` or a plain `Robota` agent as an `@robota-sdk/agent-roundtable` participant,
and a Robota agent as its selector. `agent-roundtable` stays free of both runtimes; this is the only
package that imports `@robota-sdk/agent-core` and `@robota-sdk/agent-session` to bridge them in.

The package root (`robotaParticipant`, `robotaSelector`, `meterJournal`, ...) only ever needs
`@robota-sdk/agent-core`. `sessionParticipant`, which needs `@robota-sdk/agent-session` as well, is
exported from the `/session` subpath instead — see below.

## Installation

Not published to npm yet. Inside this monorepo, depend on it as a workspace package:

```json
{ "dependencies": { "@robota-sdk/agent-roundtable-robota": "workspace:*" } }
```

## Quick start

A minimal, runnable example — no API key or real provider needed. It plugs a `Robota` agent in as a
participant, runs one turn, and reads the message it published:

```typescript
import { Robota, type IAIProvider } from '@robota-sdk/agent-core';
import { createRoundtable, MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import { robotaParticipant } from '@robota-sdk/agent-roundtable-robota';

// A minimal provider so this example runs with no external service or API key.
const provider: IAIProvider = {
  name: 'demo-provider',
  version: '1',
  async chat(messages) {
    const latest = messages.at(-1)?.content ?? '';
    return {
      id: 'demo-1',
      role: 'assistant',
      content: `echo: ${latest}`,
      state: 'complete',
      timestamp: new Date(),
    };
  },
  async generateResponse() {
    return { content: '' };
  },
  supportsTools: () => false,
  validateConfig: () => true,
};

const assistant = robotaParticipant({
  id: 'assistant',
  runtime: { id: 'demo/robota', version: '1' },
  createAgent: async () =>
    new Robota({
      name: 'assistant',
      aiProviders: [provider],
      defaultModel: { provider: provider.name, model: 'demo-model' },
    }),
});

export async function runQuickstart() {
  const room = createRoundtable({
    conversationId: 'quickstart',
    store: new MemoryConversationStore(),
    participants: [assistant],
    limits: { maxTurnsPerRun: 1 },
  });
  const result = await room.run();
  const messages = room.snapshot().messages;
  await room.dispose();
  return { result, messages };
}
```

This exact example is executed by `src/readme-example.test.ts`, so it stays runnable as the package
changes.

## `sessionParticipant`: a real, permission-gated agent turn

`sessionParticipant` wraps a Robota `Session` — the same runtime `agent-cli`/`agent-framework` build
on, with tools, permissions and hooks — as a participant. The host supplies everything Session-specific
through `createSessionOptions`; this package owns turning a shared increment into that Session's input,
metering every provider call it makes, and mapping its one supported wait shape (a tool call awaiting
approval, `robota-session/approval`) onto the roundtable's own wait/resume protocol.

It is imported from the `/session` subpath, not the package root: `sessionParticipant` pulls in
`@robota-sdk/agent-session` — and, through it, `@robota-sdk/agent-file-authority`'s native binary — a
cost a consumer of `robotaParticipant`/`robotaSelector` alone should never pay:

```typescript
import { sessionParticipant } from '@robota-sdk/agent-roundtable-robota/session';

const reviewer = sessionParticipant({
  id: 'reviewer',
  runtime: { id: 'product/reviewer', version: '1' },
  createSessionOptions: async () => ({
    cwd: process.cwd(),
    provider /* an IAIProvider the host constructs */,
    tools /* the host's own tools */,
    systemMessage: 'Review the proposal and either approve or ask a question.',
    permissions: { allow: [], deny: [], ask: ['run_command'] },
  }),
});
```

An approval wait comes back from `runTurn`/`resumeTurn` as `{ kind: 'wait', requests }`, one request
per pending tool call, each carrying the exact execution, action and tool-call identifiers Session
itself uses — enough for a host to render what is being asked without exposing anything about the
Session's internals. Answering it and calling `resumeTurn` again continues the same execution; it
never re-sends the turn's original input, and a denied approval completes the turn without the tool's
effect ever running.

A settled turn's `checkpoint()` restores a fresh Session, with the same history, on a later process —
`openSession` rejects a checkpoint built under a different `cwd`. A parked wait's checkpoint has no
history to restore: the session that produced it is still the runtime of record until the wait
resolves, so restoring one still depends on that session — or a durable journal that recorded its
execution — being reachable. The default journal a `sessionParticipant` uses when none is supplied is
shared by session id for the lifetime of the process, which is enough for a `loadRoundtable` reload in
the same process; a host that needs a wait to survive a restart supplies its own durable `journal`.

## `robotaParticipant`: a plain agent turn, no continuation

`robotaParticipant` wraps a plain `Robota` agent the host already constructed. It metering-wraps every
provider call the same way `sessionParticipant` does, but supports no wait continuation at all: an
agent whose tool suspends execution fails that turn outright rather than parking it. Its checkpoint
(`robota-agent/1`) restores a fresh agent's history at a settled boundary; there is no parked-wait
checkpoint to restore, because there is no wait to restore into.

## `robotaSelector`: picking the next speaker with a Robota agent

`robotaSelector` asks a Robota agent to decide who speaks next by calling one decision tool, exactly
once; `agent-roundtable` never has to know that a model made the choice. The agent `createAgent()`
returns must carry no tool of its own — the decision tool is the only one this package ever adds, and
only for the call that needs it — so a decision can only ever have been reached the one way this
package can verify. A decision that never calls the tool, calls it more than once, names an id outside
the conversation's current participants, or names the same participant twice, fails the selection; the
roundtable's own run then fails too, with no retry from inside the selector.

Every decision is shown the conversation's whole shared transcript, not a bounded window — no context
policy trims a selector's own view the way one trims what a participant receives — so the cost of each
decision grows with the conversation rather than staying flat.

## Rendering a turn's shared increment

Both participants render a turn's `context.messages` — never the participant's own prior output or
anything already delivered to it, which the roundtable core already excludes — into that turn's input
text. The default renderer, `renderSharedIncrement`, quotes every message's content line by line so it
can never be read back as a new message header; a host that wants a different shape for its runtime's
input passes its own `render` function to either participant.

## `meterJournal`: metering a host's own selector or participant

Both `robotaParticipant` and `robotaSelector` wrap the `IExecutionJournal` they hand to a `Robota`
run with `meterJournal`, which is exported so a host writing its own Robota-backed selector or
participant gets the same guarantee without reimplementing it:

```typescript
import { meterJournal } from '@robota-sdk/agent-roundtable-robota';

const metered = meterJournal(myInnerJournal, execOptions.services);
await agent.run(prompt, { signal: execOptions.signal, executionJournal: metered });
```

Every `model-request` record is admitted through `services.admitModelCall` before it reaches the
inner journal — a rejected admission stops the call before it is dispatched — and every
`model-response`/`model-failure`/`model-cache-hit` is reported through `services.recordUsage` once
it settles. A `Session`-backed, checkpoint-resumable journal uses `meterRecoverableJournal` from
`@robota-sdk/agent-roundtable-robota/session` instead, which adds a passed-through `read`.

## Errors

`RobotaParticipantError` (`unsupported-wait`, `identity-mismatch`, `checkpoint-invalid`,
`journal-missing`, `resource-reused`) is thrown by a participant's `runTurn`/`resumeTurn`/`openSession`.
`SelectorDecisionError` (`no-candidates`, `no-decision`, `multiple-decisions`, `invalid-decision`,
`unknown-participant`) is thrown by `robotaSelector`'s `select`.

## Provider SDK retries

A provider SDK's own automatic retry of a failed request is invisible to this package's metering: a
retried call still admits and reports as one call, because the adapter only ever sees the provider
call boundary agent-core journals, not the transport underneath it. A host relying on per-call model
limits should disable that provider SDK's automatic retries.
