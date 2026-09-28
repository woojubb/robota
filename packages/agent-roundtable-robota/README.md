# @robota-sdk/agent-roundtable-robota

Runs a Robota `Session` or a plain `Robota` agent as an `@robota-sdk/agent-roundtable` participant,
and a Robota agent as its selector. `agent-roundtable` stays free of both runtimes; this is the only
package that imports `@robota-sdk/agent-core` and `@robota-sdk/agent-session` to bridge them in.

The package root (`robotaParticipant`, `robotaSelector`, `meterJournal`, ...) only ever needs
`@robota-sdk/agent-core`. `sessionParticipant`, which needs `@robota-sdk/agent-session` as well, is
exported from the `/session` subpath instead — see below.

## Installation

```bash
npm install @robota-sdk/agent-roundtable-robota @robota-sdk/agent-core @robota-sdk/agent-roundtable
# only if you use sessionParticipant from the /session subpath:
npm install @robota-sdk/agent-session
```

`@robota-sdk/agent-roundtable` comes along automatically as a regular dependency of this package, but
the Quick Start below also imports `createRoundtable` and `MemoryConversationStore` from it directly,
so your own project needs it as a direct dependency too — install it explicitly as shown above (under
pnpm's default strict `node_modules` or under Yarn PnP, importing a package your project never
declared fails even though this package's install brought a copy of it in transitively).
`@robota-sdk/agent-core` is a peer dependency, and `@robota-sdk/agent-session` an optional one needed
only by the `/session` subpath. This package runs the `Robota`/`Session` instances the host
constructs with them, so the host's copies and this package's must be the same install. See "Version
and compatibility" below for what version range that peer dependency actually pins to.

## Supported environments

Node.js only (the peer `@robota-sdk/agent-session` reads and writes the filesystem for permissions,
hooks and persistence); there is no browser build. Requires Node.js 22.12 or later, matching
`@robota-sdk/agent-core` and `@robota-sdk/agent-session`. `@robota-sdk/agent-roundtable` itself stays
platform-neutral — only this adapter, and the runtimes it wraps, are Node-only.

## Capabilities by participant kind

| Kind                                                                              | Wait continuation                                               | Checkpoint             | Model calls                                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `sessionParticipant`                                                              | Yes — a tool call awaiting approval (`robota-session/approval`) | `robota-session/1`     | Metered (`'metered'`)                                  |
| `robotaParticipant`                                                               | No — a suspended execution fails the turn outright              | `robota-agent/1`       | Metered (`'metered'`)                                  |
| Custom (write your own `AgentParticipant` against `@robota-sdk/agent-roundtable`) | Whatever you implement                                          | Whatever you implement | Declare `factory.modelCalls` yourself (see note below) |

A custom participant needs neither this package nor Robota at all — `@robota-sdk/agent-roundtable`'s
own README shows one wrapping plain code. Use `sessionParticipant` when the turn needs tools,
permissions or approval; use `robotaParticipant` for a model-only agent with no continuation to
manage; write a custom participant for any other runtime.

Leaving a custom factory's `modelCalls` undeclared behaves like `'none'` only while the roundtable has
no model-call limit and no pricing policy. As soon as either is configured, `createRoundtable`
requires every agent factory and the selector to declare `modelCalls` explicitly — `'none'` included —
and throws `RoundtableError('invalid-config', ...)` for any factory that leaves it undeclared, so a
participant nobody metered can never end up silently governed by a limit it never agreed to observe.

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
That default also only ever frees a session's records once its execution settles with no wait parked;
a parked wait whose conversation fails or is simply never resumed keeps its records in memory for the
life of the process. A host that expects abandoned waits supplies its own `journal` to clean those up.

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

The `robotaSelector` a call to this function returns is one conversation's selector: its reused agent's
history and tools are private, mutable state a second, overlapping `select()` call on the same instance
would corrupt, so a second such call is rejected outright (`resource-reused`) rather than left to race
the first. Give each conversation its own instance instead of sharing one across conversations.

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
`unknown-participant`) is thrown by `robotaSelector`'s `select`, which also throws
`RobotaParticipantError('resource-reused')` if one selector instance is asked to decide for two
conversations at the same time.

## Provider SDK retries

A provider SDK's own automatic retry of a failed request is invisible to this package's metering: a
retried call still admits and reports as one call, because the adapter only ever sees the provider
call boundary agent-core journals, not the transport underneath it. A host relying on per-call model
limits should disable that provider SDK's automatic retries.

## Version and compatibility

This package's own API follows the release's semantic version, same as `@robota-sdk/agent-roundtable`,
`@robota-sdk/agent-core` and `@robota-sdk/agent-session` in the same release (they are versioned in
lockstep). Its `peerDependencies` on the latter two are `workspace:*` in source; publishing pins them
to the **exact** version they release with, not a range — so the host must have `@robota-sdk/agent-core`
installed at that exact version (npm 7+ refuses to install a different version; pnpm and Yarn
warn by default, but a mismatch is still unsupported); `@robota-sdk/agent-session` is required at that same exact version only when the host uses
the `/session` subpath, since that peer is optional.

That API version is separate from **checkpoint format compatibility**, which this package owns
independently of any of those three:

- `sessionParticipant`'s checkpoint is versioned `robota-session/1`; `robotaParticipant`'s is
  `robota-agent/1`. Both decoders reject any other `version` string outright — there is no silent
  best-effort decode of an unrecognized or future format.
- A checkpoint format changes only by minting a new version string (e.g. a hypothetical
  `robota-session/2`), never by changing what `/1` means in place. An API-compatible minor or patch
  release of this package never changes what an existing checkpoint version decodes to.
- Restoring also re-validates identity: `sessionParticipant`'s `openSession` rejects a checkpoint
  built under a different `cwd`, and a parked wait's checkpoint is a receipt, not a substitute for the
  live session (or durable journal) that actually produced it — see "sessionParticipant" above.

A host that persists checkpoints across releases should track the checkpoint `version` string
alongside its own data, the same way `@robota-sdk/agent-roundtable`'s stored conversation state
carries its own `schemaVersion` (see that package's README).
