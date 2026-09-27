# @robota-sdk/agent-roundtable-robota

Runs a Robota `Session` or a plain `Robota` agent as an `@robota-sdk/agent-roundtable` participant,
and a Robota agent as its selector. `agent-roundtable` stays free of both runtimes; this is the only
package that imports `@robota-sdk/agent-core` and `@robota-sdk/agent-session` to bridge them in.

## Installation

```bash
npm install @robota-sdk/agent-roundtable-robota @robota-sdk/agent-core @robota-sdk/agent-session
```

`@robota-sdk/agent-roundtable` comes along automatically as a regular dependency.
`@robota-sdk/agent-core` and `@robota-sdk/agent-session` are peer dependencies — this package runs the
`Robota`/`Session` instances the host constructs with them, so the host's copies and this package's
must be the same install. See "Version and compatibility" below for what version range that peer
dependency actually pins to.

## Supported environments

Node.js only (the peer `@robota-sdk/agent-session` reads and writes the filesystem for permissions,
hooks and persistence); there is no browser build. Requires Node.js 22.12 or later, matching
`@robota-sdk/agent-core` and `@robota-sdk/agent-session`. `@robota-sdk/agent-roundtable` itself stays
platform-neutral — only this adapter, and the runtimes it wraps, are Node-only.

## Capabilities by participant kind

| Kind                            | Wait continuation                                            | Checkpoint            | Model calls        |
| -------------------------------- | -------------------------------------------------------------- | ---------------------- | -------------------- |
| `sessionParticipant`             | Yes — a tool call awaiting approval (`robota-session/approval`) | `robota-session/1`    | Metered (`'metered'`) |
| `robotaParticipant`              | No — a suspended execution fails the turn outright              | `robota-agent/1`      | Metered (`'metered'`) |
| Custom (write your own `AgentParticipant` against `@robota-sdk/agent-roundtable`) | Whatever you implement                    | Whatever you implement | Declare `factory.modelCalls` yourself, or omit it (`'none'`) |

A custom participant needs neither this package nor Robota at all — `@robota-sdk/agent-roundtable`'s
own README shows one wrapping plain code. Use `sessionParticipant` when the turn needs tools,
permissions or approval; use `robotaParticipant` for a model-only agent with no continuation to
manage; write a custom participant for any other runtime.

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
approval, `robota-session/approval`) onto the roundtable's own wait/resume protocol:

```typescript
import { sessionParticipant } from '@robota-sdk/agent-roundtable-robota';

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

## Rendering a turn's shared increment

Both participants render a turn's `context.messages` — never the participant's own prior output or
anything already delivered to it, which the roundtable core already excludes — into that turn's input
text. The default renderer, `renderSharedIncrement`, quotes every message's content line by line so it
can never be read back as a new message header; a host that wants a different shape for its runtime's
input passes its own `render` function to either participant.

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

## Version and compatibility

This package's own API follows the release's semantic version, same as `@robota-sdk/agent-roundtable`,
`@robota-sdk/agent-core` and `@robota-sdk/agent-session` in the same release (they are versioned in
lockstep). Its `peerDependencies` on the latter two are `workspace:*` in source; publishing pins them
to the **exact** version they release with, not a range — so installing this package always pulls in
the exact `agent-core`/`agent-session` version it was built and tested against.

That API version is separate from **checkpoint format compatibility**, which this package owns
independently of any of those three:

- `sessionParticipant`'s checkpoint is versioned `robota-session/1`; `robotaParticipant`'s is
  `robota-agent/1`. Both `checkpoint-codec` decoders reject any other `version` string outright —
  there is no silent best-effort decode of an unrecognized or future format.
- A checkpoint format changes only by minting a new version string (e.g. a hypothetical
  `robota-session/2`), never by changing what `/1` means in place. An API-compatible minor or patch
  release of this package never changes what an existing checkpoint version decodes to.
- Restoring also re-validates identity: `sessionParticipant`'s `openSession` rejects a checkpoint
  built under a different `cwd`, and a parked wait's checkpoint is a receipt, not a substitute for the
  live session (or durable journal) that actually produced it — see "sessionParticipant" above.

A host that persists checkpoints across releases should track the checkpoint `version` string
alongside its own data, the same way `@robota-sdk/agent-roundtable`'s stored conversation state
carries its own `schemaVersion` (see that package's README).
