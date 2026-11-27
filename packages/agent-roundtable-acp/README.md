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

The session core starts no process. The host supplies a launcher that yields the agent's byte
streams, one connection per session the roundtable opens. `spawnAcpAgent` is that launcher for an
agent that runs as a child process:

```ts
import { createRoundtable, MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import { acpParticipant, spawnAcpAgent } from '@robota-sdk/agent-roundtable-acp';

const reviewer = acpParticipant({
  id: 'reviewer',
  runtime: { id: 'acp/reviewer', version: '1' },
  cwd: '/path/to/workspace', // the directory the agent is told to work in
  launcher: spawnAcpAgent({
    command: '/usr/local/bin/my-acp-agent', // absolute, or a name found on the PATH in `env`
    args: ['--stdio'],
    cwd: '/path/to/workspace',
    env: { PATH: '/usr/local/bin:/usr/bin:/bin', MY_AGENT_TOKEN: token },
  }),
});

const room = createRoundtable({
  conversationId: 'review',
  purpose: 'Review the plan',
  participants: [reviewer],
  store: new MemoryConversationStore(),
  limits: { maxTurnsPerRun: 2 },
});
```

### `spawnAcpAgent` options

| Option        | Default | Meaning                                                                                  |
| ------------- | ------- | ---------------------------------------------------------------------------------------- |
| `command`     | none    | The program to run                                                                       |
| `args`        | `[]`    | Its arguments                                                                            |
| `cwd`         | none    | Absolute working directory of the process                                                |
| `env`         | none    | The process's whole environment: required, string values only, nothing is inherited      |
| `killGraceMs` | 2000    | How long `close()` waits after asking the tree to exit before it kills the tree          |
| `onStderr`    | discard | Receives the agent's standard error one line at a time; the stream is drained either way |

Every `launch()` starts one process whose standard input and output are the connection. The agent
sees exactly `env`: pass what it needs to start and authenticate, such as `PATH`, because the
host's own variables are never passed on. On macOS and Linux the process leads its own process
group, and `close()` ends standard input, asks the group to exit, waits up to `killGraceMs` and then
kills the group, so helpers the agent started do not outlive the session, even when the agent
exited first or a helper ignored the request. The same step runs as soon as the agent exits, so a
helper that still holds the agent's output cannot keep the connection open. A process that cannot be
started (a missing program or working directory) rejects the open with an `AcpParticipantError`
whose `code` is `launch-failed`. If the agent exits mid-turn, that turn and every later one fails
with `connection-closed`.

Not covered: if the host process itself dies, nothing ends the agent, which keeps running unless it
exits when its standard input ends. On Windows the tree is ended with `taskkill` only while the agent is
running: a helper that outlives it, or holds its output, is not ended when it exits. An agent that is a
`.cmd` shim needs a shell the launcher does not provide, and none of this is verified there yet.

### A custom launcher

Any other way of reaching an agent, such as a container or a remote host, is a launcher of its own:

```ts
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import type { AcpLauncher } from '@robota-sdk/agent-roundtable-acp';

// A sketch of the port; `spawnAcpAgent` is the complete version for child processes.
const launcher: AcpLauncher = {
  async launch() {
    const child = spawn('my-acp-agent', ['--stdio'], {
      env: { PATH: '/usr/bin' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    return {
      toAgent: Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      fromAgent: Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      async close() {
        child.kill();
      },
    };
  },
};
```

## What a participant does and does not do

| Aspect              | Behavior                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Prompt              | One text block with the new public messages; the purpose only on the first turn                |
| Reply               | The concatenated text the agent says; blank text yields the turn                               |
| Streaming           | Each text chunk goes to `onDelta` in order, before the turn's outcome is returned              |
| Other endings       | Reaching a token or request limit, a refusal or a cancellation not asked for fails the turn    |
| Host abort          | Throws the abort reason at once, never partial text; cancels the agent, ends the session       |
| Long reply          | A reply past `maxReplyChars` fails the turn and ends the session, like an abort                |
| Permission requests | Refused unless the `approver` allows that one call; no client capability is advertised         |
| Model calls         | Declared `none`: a roundtable's model-call limits do not bound this participant                |
| Launcher            | `spawnAcpAgent`: explicit `env`, own process group on POSIX, tree ended on close or agent exit |
| Recovery            | No checkpoint: a conversation holding it cannot be loaded back after a turn                    |
| Platforms           | macOS and Linux supported; Windows unverified                                                  |
| Host crash          | Nothing ends the agent unless it exits when its standard input ends                            |

**The agent's spend is not bounded by model-call limits or budgets.** The participant declares
`modelCalls: 'none'` because the protocol shows no per-call usage to meter, so a roundtable's
`maxModelCalls*` limits and budgets never count what the agent spends. What bounds it is the turn
and time limits (`maxTurnsPerRun`, `timeoutMs`) and the agent's own configuration.

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
