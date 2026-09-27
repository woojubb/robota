# @robota-sdk/agent-roundtable

Coordinates independent agents and people in one shared conversation. Each participant keeps its own
runtime and private state; the roundtable decides who speaks next, runs a turn or a parallel group of
turns, and publishes their messages to a shared transcript in a stable order. The host supplies the
participants, the selector that picks the next turn, and the store that holds conversation progress.
The package runs no model and imports no provider: a participant can wrap a Robota session, another
agent runtime, or plain code.

## Installation

Not published to npm yet. Inside this monorepo, depend on it as a workspace package:

```json
{ "dependencies": { "@robota-sdk/agent-roundtable": "workspace:*" } }
```

## Quick start

```typescript
import {
  createRoundtable,
  externalParticipant,
  MemoryConversationStore,
  type AgentParticipant,
} from '@robota-sdk/agent-roundtable';

// A participant opens one session per conversation. This one repeats the newest message it sees.
const echo: AgentParticipant = {
  kind: 'agent',
  id: 'echo',
  runtime: { id: 'example/echo', version: '1' },
  factory: {
    openSession: async () => ({
      session: {
        runTurn: async (turn) => {
          const latest = turn.context.messages.at(-1)?.content ?? 'nothing yet';
          return { kind: 'speak', content: `echo: ${latest}` };
        },
      },
      release: async () => {},
    }),
  },
};

const room = createRoundtable({
  conversationId: 'demo',
  participants: [externalParticipant({ id: 'user' }), echo],
  store: new MemoryConversationStore(),
  limits: { maxTurnsPerRun: 1 },
  onEvent: (event) => {
    if (event.type === 'published')
      for (const message of event.messages)
        console.log(`${message.participantId}: ${message.content}`);
  },
});

// The default round-robin selector asks the person first, so the run waits for input.
const waiting = await room.run();
if (waiting.status === 'waiting') {
  await room.submitInput({
    participantId: 'user',
    inputId: 'input-1', // Retrying with the same id and content returns the same receipt.
    expectedRevision: waiting.revision,
    replyToRequestId: waiting.requests[0].id,
    content: 'Hello',
  });
}

console.log(await room.run()); // echo speaks: { status: 'limited', reason: 'turns', ... }
console.log(room.snapshot().messages.map((message) => message.content)); // ['Hello', 'echo: Hello']
await room.dispose();
```

Omitting `store` uses the same in-memory store. A durable `ConversationStore` together with a
`RoundtableRegistry` that maps saved runtime and selector versions back to live factories lets
`loadRoundtable` reopen a conversation later.

## Run results

`run()` advances until one of these results:

| Status      | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `waiting`   | Requests need answers: `submitInput` answers input, `resume` answers any request.             |
| `limited`   | This run used its `maxTurnsPerRun` or `timeoutMs`; the next run continues.                    |
| `cancelled` | The `signal` fired or `dispose()` was called; the next run or a loaded handle continues.      |
| `completed` | The selector finished the conversation. Every later `run()` returns the same result.          |
| `failed`    | A participant, the selector or the store failed. Every later `run()` returns the same result. |

## Events

`onEvent` observes progress and is awaited, but it never decides it:

- `group-started` — the selected participants and the transcript revision they all see.
- `delta` — text a participant streams through `onDelta` while its turn runs.
- `prepared` — a participant's result is saved but not public yet.
- `published` — the whole group committed; its messages are in the transcript, in selection order.

An exception from `onEvent` goes to `onEventError` and cannot undo a committed group.

## Errors

Calls reject with a `RoundtableError` whose `code` is one of `invalid-config`, `busy` (a `run`,
`submitInput` or `resume` is already active, or another owner holds the stored conversation),
`conflict` (a stale `expectedRevision`, a reused id with different content, or a request that is no
longer pending), `disposed`, `stale-claim` (this handle's claim on the store expired or changed
owner) or `recovery-required`. A selector decision that names an unknown participant, cannot run as
a group or needs more turns than one run allows is not saved; the run ends `failed`.

## Cancellation

Passing a `signal` to `run()`, a `timeoutMs` limit and `dispose()` stop new turns and wait for running
participants to settle; they end the run, not the conversation. A result a participant returned is
kept, even one that arrives after the abort, and is published when its group completes on a later
run. An attempt stopped without one, for example a `runTurn` that rejects with the signal's reason,
runs again on the next run for the same turn with a new `attemptId`; if it already acted outside the
conversation, the participant's runtime must report that. `run()` and `loadRoundtable` reject with
`recovery-required` only when stored state holds a turn that was never seen to settle, such as after
the process stopped mid-turn. A group with a failed member is never published or run again
automatically.

## Supported environments

The build is platform-neutral ESM and CommonJS with type declarations and has no runtime
dependencies. It needs only standard globals: `AbortController`, `AbortSignal.any`,
`structuredClone`, `crypto.randomUUID` and `setTimeout`. That covers Node.js 22.12 or later and
current browsers.

## Documentation

- [docs/SPEC.md](docs/SPEC.md) — purpose, contract, invariants and non-goals.
