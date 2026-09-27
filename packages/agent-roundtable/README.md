# @robota-sdk/agent-roundtable

Coordinates independent agents and people in one shared conversation. Each participant keeps its own
runtime and private state; the roundtable decides who speaks next, runs a turn or a parallel group of
turns, and publishes their messages to a shared transcript in a stable order. The host supplies the
participants, the selector that picks the next turn, and the store that holds conversation progress.
The package runs no model and imports no provider: a participant can wrap a Robota session, another
agent runtime, or plain code.

## Installation

```bash
npm install @robota-sdk/agent-roundtable
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

export async function runQuickstart() {
  const published: string[] = [];
  const room = createRoundtable({
    conversationId: 'demo',
    participants: [externalParticipant({ id: 'user' }), echo],
    store: new MemoryConversationStore(),
    limits: { maxTurnsPerRun: 1 },
    onEvent: (event) => {
      if (event.type === 'published')
        for (const message of event.messages)
          published.push(`${message.participantId}: ${message.content}`);
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

  const result = await room.run(); // echo speaks: { status: 'limited', reason: 'turns', ... }
  const messages = room.snapshot().messages.map((message) => message.content); // ['Hello', 'echo: Hello']
  await room.dispose();
  return { result, messages, published };
}
```

This exact example is executed by `src/readme-example.test.ts`, so it stays runnable as the package
changes.

Omitting `store` uses the same in-memory store. A durable `ConversationStore` together with a
`RoundtableRegistry` that maps saved runtime and selector versions back to live factories lets
`loadRoundtable` reopen a conversation later.

## Exports

| Export                    | What it is for                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `createRoundtable(options)` | Validates configuration and returns a `Roundtable` handle; `run()` executes it.            |
| `loadRoundtable(options)`   | Reopens a conversation from a `ConversationStore`, resolving saved runtime/selector references through a `RoundtableRegistry`. |
| `MemoryConversationStore`   | The in-memory `ConversationStore`; no durability, no `recovery: 'durable'` support.         |
| `externalParticipant(def)`  | Declares a participant answered through `submitInput`/`resume` instead of a factory.       |
| `roundRobin()`              | The default `TurnSelector`: speaks each registered participant once, in order, no model calls. |
| `RoundtableError`           | Thrown by every rejecting call; `code` distinguishes `invalid-config`, `busy`, `conflict`, `disposed`, `stale-claim` and `recovery-required` (see README "Errors"). |
| `summarizeUsage(records)`   | Reduces `UsageRecord[]` (from a snapshot or the `usage` event) into per-principal totals.  |

Everything else this package exports is a type: the participant/session/selector contracts
(`ParticipantDefinition`, `ParticipantSession`, `TurnSelector`, …), the store contract
(`ConversationStore`, `ConversationEnvelope`, …), and the usage/pricing types consumed by
`TurnServices`. `@robota-sdk/agent-roundtable-robota` implements these contracts against Robota; a
host can implement them against any other runtime.

## Run results

`run()` advances until one of these results:

| Status      | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `waiting`   | Requests need answers: `submitInput` answers input, `resume` answers any request.             |
| `limited`   | This run reached `maxTurnsPerRun`, `timeoutMs` or a model-call limit; the next run continues. |
| `cancelled` | The `signal` fired or `dispose()` was called; the next run or a loaded handle continues.      |
| `completed` | The selector finished the conversation. Every later `run()` returns the same result.          |
| `failed`    | A participant, the selector or the store failed. Every later `run()` returns the same result. |

## Events

`onEvent` observes progress and is awaited, but it never decides it:

- `group-started` — the selected participants and the transcript revision they all see.
- `delta` — text a participant streams through `onDelta` while its turn runs.
- `prepared` — a participant's result is saved but not public yet.
- `usage` — a model-call admission or usage report was saved to the usage ledger.
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

Passing a `signal` to `run()`, a `timeoutMs` limit, a model-call limit that rejects an admission and
`dispose()` stop new turns and wait for running participants to settle; they end the run, not the
conversation. A result a participant returned is kept, even one that arrives after the abort, and is
published when its group completes on a later run. An attempt stopped without one, for example a
`runTurn` that rejects with the signal's reason, runs again on the next run for the same turn with a
new `attemptId`. When the participant provides `checkpoint()`, its session is released and the retry
opens a new one from the last saved checkpoint, as loading would, so private state never holds the
abandoned attempt. A participant without checkpoints keeps its live session (a new one only before its
first turn), so its private state may retain the abandoned attempt; retry-independent private state
requires `checkpoint()`. If the attempt already acted outside the conversation, the participant's
runtime must report that. `run()` and `loadRoundtable` reject with `recovery-required` only when stored
state holds a turn that was never seen to settle, such as after the process stopped mid-turn. A group
with a failed member is never published or run again automatically.

## Supported environments

The build is platform-neutral ESM and CommonJS with type declarations and has no runtime
dependencies. It needs only standard globals: `AbortController`, `AbortSignal.any`,
`structuredClone`, `crypto.randomUUID` and `setTimeout`. That covers Node.js 22.12 or later and
current browsers.

A participant can be a plain object like `echo` above, or come from
`@robota-sdk/agent-roundtable-robota`'s `sessionParticipant` (a permission-gated Robota `Session`) or
`robotaParticipant` (a plain Robota agent) — this package never depends on either.

## Version and compatibility

This package's own API follows the release's semantic version. That is separate from the **stored
conversation schema**: `MemoryConversationStore` and any other `ConversationStore` persist a snapshot
whose envelope carries `schemaVersion: 1`. A store rejects (rather than guesses at) a snapshot whose
`schemaVersion` it does not recognize, so a schema change ships as a new number and an explicit
migration, never a silent reinterpretation — independent of how many API-compatible minor/patch
releases happen in between. `loadRoundtable` additionally requires the saved participant/selector
runtime and configuration versions to match what a `RoundtableRegistry` resolves today; a mismatch is
refused rather than run against the wrong definition.

## Documentation

- [docs/SPEC.md](docs/SPEC.md) — purpose, contract, invariants and non-goals.
