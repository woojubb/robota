# @robota-sdk/agent-transport-acp

[Agent Client Protocol](https://agentclientprotocol.com/) (ACP) agent transport for the Robota SDK.
`createAcpTransport` runs an agent session as an ACP v1 agent over a pair of byte streams, so an editor
that launches the process (Zed, JetBrains, and other ACP clients) can create a session, send prompts,
see streamed replies and tool calls, approve or reject permission requests, and cancel a turn. It is
one more adapter over the same session the terminal, WebSocket and MCP surfaces drive: the editor
answers prompts, and widens nothing.

## Installation

```bash
npm install @robota-sdk/agent-transport-acp
```

Requires Node.js 22.12 or later. `@agentclientprotocol/sdk` (pinned) is a regular dependency.

## Usage

```typescript
import { createAcpTransport } from '@robota-sdk/agent-transport-acp';
import type { IAcpTransportSession } from '@robota-sdk/agent-transport-acp';

declare const session: IAcpTransportSession; // e.g. an InteractiveSession from @robota-sdk/agent-framework

const transport = createAcpTransport({
  input: process.stdin,
  output: protocolOnlyStdout, // a stream nothing but this transport writes to
  agentInfo: { name: 'my-agent', version: '1.0.0' },
  cwd: process.cwd(),
  admitWorkspace: () => ({ admitted: true }), // the host's trust decision
});
transport.attach(session);
await transport.start();
await transport.waitForClose(); // settles when the editor closes the input
await transport.stop();
```

The output carries newline-delimited JSON-RPC and nothing else: reserve stdout for the protocol before
anything else in the process can print to it, and send logs to stderr.

## Options

| Option             | Type                                                       | Description                                                                                                       |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `input` / `output` | `Readable` / `Writable`                                    | The editor writes `input` and reads `output`. Stopping never destroys either.                                     |
| `agentInfo`        | `{ name, version }`                                        | Reported to the editor on `initialize`.                                                                           |
| `cwd`              | `string`                                                   | The directory the session is rooted at. `session/new` and `session/load` must name it.                            |
| `admitWorkspace`   | `() => { admitted: true } \| { admitted: false, message }` | The host's trust check, asked on `session/new` and `session/load`. A refusal's `message` is returned to the editor as the error. |
| `executeCommand`   | `(text, signal) => Promise<string>`                        | Runs a `/command` prompt and returns the text to show; `signal` aborts on `session/cancel` or when the editor goes away, so pass it on to the command. Without it, a `/command` prompt is answered with a notice. |
| `loadSession`      | `(sessionId) => Promise<{ loaded: true } \| { loaded: false, message }>`        | Makes a stored session of the served directory current in the object the transport was attached to (attach a forwarder such as a session slot). Without it the agent does not offer `session/load`. |
| `driverId`         | `TDriverId`                                                | Attribution on turns and prompt answers. Default `'owner'`.                                                       |
| `surface`          | `TUsageSurface`                                            | Usage surface recorded on turns. Default `'unknown'`.                                                             |
| `onDeliveryError`  | `(error, context) => void`                                 | Receives errors the editor does not: a failed notification write, or the cause of a failed turn.                  |

## What the editor sees

| Editor action                       | Behavior                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`                        | Always answers protocol version 1; text and embedded-context prompts, no image or audio; `session/load` only when the host supplies `loadSession`. |
| `session/new`                       | Returns the attached session's id. Refused if `cwd` is not the served directory, if `mcpServers` or `additionalDirectories` are not empty, or if the workspace is not admitted (error `-32001`, `data.reason` `workspace-not-trusted`); one session per connection. |
| `session/prompt`                    | Streams `agent_message_chunk` and `tool_call` / `tool_call_update` updates, then answers `end_turn`, or `cancelled` after a cancel. A prompt starting with `/` runs as a command.                                                                                   |
| `session/load`                      | With `loadSession`: makes the stored session current, replays its conversation (messages and finished tool calls) as updates, then answers. Checked like `session/new`; refused while a prompt runs. |
| available commands                  | After `session/new` or `session/load`, and after a prompt that changed them: `available_commands_update` with the runtime's commands and the user-invocable skills, each with its argument hint. |
| `session/cancel`                    | Aborts the running turn; the pending prompt answers `cancelled`.                                                                                                                                                                                                    |
| permission request from the session | `session/request_permission` with allow once, allow for this session, allow for this project (only if the session can persist it) and reject. Cancelled, failed or unrecognised answers deny.                                                                       |
| question from the session           | Not forwarded; the session answers it as cancelled.                                                                                                                                                                                                                 |

An editor's own `mcpServers` and extra workspace roots are refused, so configure MCP servers in the agent's
own settings and do not attach context servers to this agent in an editor that offers it (Zed does).

## Related

- [`@robota-sdk/agent-transport`](../agent-transport/README.md) — shared session bridge and the stdio carrier helper.
- [`@robota-sdk/agent-transport-mcp`](../agent-transport-mcp/README.md) — serve the session as an MCP server instead.
- [docs/SPEC.md](./docs/SPEC.md) — package contract and invariants.
