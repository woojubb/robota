# @robota-sdk/agent-roundtable-acp

Seats an agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com) as an
`@robota-sdk/agent-roundtable` participant. The agent keeps its own memory, tools and model. It is
sent only the public messages it has not yet seen, once per turn, and the text it says in reply
becomes the turn's message. Its thoughts, tool calls and plans stay with it.

This is the client side of the protocol. `agent-roundtable`, the core, stays free of it and never
imports `@agentclientprotocol/sdk`; this package bridges the two.

## Installation

```bash
npm install @robota-sdk/agent-roundtable-acp @robota-sdk/agent-roundtable @agentclientprotocol/sdk zod
```

`@agentclientprotocol/sdk` and `zod` are peer dependencies. The SDK is pinned to one exact version,
and the host's copy and this package's must be the same install.

## Supported environments

Node.js 22.12 or later. The entry is Node-only (its manifest maps `browser` to `null`) because an
agent is reached over the standard input and output of another program.

## Usage

The package starts no process. The host supplies a launcher that yields the agent's byte streams,
one connection per session the roundtable opens:

```ts
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { createRoundtable, MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import { acpParticipant, type AcpLauncher } from '@robota-sdk/agent-roundtable-acp';

// A sketch: a production launcher also ends the whole process tree and drains the agent's stderr.
// It also passes an explicit `env` to `spawn` rather than letting the agent inherit this process's.
const launcher: AcpLauncher = {
  async launch() {
    const child = spawn('my-acp-agent', ['--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
    return {
      toAgent: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      fromAgent: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      async close() {
        child.kill();
      },
    };
  },
};

const reviewer = acpParticipant({
  id: 'reviewer',
  runtime: { id: 'acp/reviewer', version: '1' },
  cwd: '/path/to/workspace', // the directory the agent is told to work in
  launcher,
});

const room = createRoundtable({
  conversationId: 'review',
  purpose: 'Review the plan',
  participants: [reviewer],
  store: new MemoryConversationStore(),
  limits: { maxTurnsPerRun: 2 },
});
```

## What a participant does and does not do

| Aspect              | Behavior                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Prompt              | One text block with the new public messages; the purpose only on the first turn             |
| Reply               | The concatenated text the agent says; blank text yields the turn                            |
| Other endings       | Reaching a token or request limit, a refusal or a cancellation not asked for fails the turn |
| Host abort          | Throws the abort reason at once, never partial text; cancels the agent, ends the session    |
| Long reply          | A reply past `maxReplyChars` fails the turn and ends the session, like an abort             |
| Permission requests | Refused unless the `approver` allows that one call; no client capability is advertised      |
| Model calls         | Declared `none`: a roundtable's model-call limits do not bound this participant             |
| Recovery            | No checkpoint: a conversation holding it cannot be loaded back after a turn                 |

A failed turn rejects with an `AcpParticipantError` whose `code` names the cause.

`renderSharedIncrement` is the default way a turn becomes prompt text; pass `render` to replace it.
Each message is quoted line by line under a `### From <participant>` header, so a message cannot
forge another author's header.

## Options

| Option             | Default | Meaning                                                                                        |
| ------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `approver`         | none    | Decides each permission request: `decide(request, { signal })` answers `'allow'` or `'reject'` |
| `startupTimeoutMs` | 30000   | Bound on launching the agent and completing the handshake                                      |
| `cancelGraceMs`    | 5000    | How long an aborted turn waits for the agent to acknowledge the cancel before disconnecting    |
| `maxReplyChars`    | 100000  | The longest reply one turn may have; past it the turn fails with `reply-too-long`              |

`allow` selects the agent's one-time allow option and `reject` its one-time reject option; an
option that remembers a decision is never chosen, so an `allow` with only those on offer is refused.
Anything but the two strings, a throw, a rejection, a request outside a running turn or for another
session is a refusal too. The `signal` aborts when the turn is aborted, the session ends or the
connection dies, and a request still waiting then is answered as cancelled. The request's tool call
fields are whatever the agent sent: treat them as untrusted text.

```ts
const reviewer = acpParticipant({
  // ...
  approver: {
    decide: ({ toolCall }) => (toolCall.kind === 'read' ? 'allow' : 'reject'),
  },
});
```

## Documents

- [SPEC.md](./docs/SPEC.md) — purpose, contract, invariants, non-goals and design decisions.
