# @robota-sdk/agent-transport-ws

WebSocket transport for the Robota SDK. `WsTransport` serves a running agent session on a loopback
WebSocket server, so a local client (a browser page, a desktop app, another process) can drive the
session in real time: submit prompts, receive streamed output, answer permission prompts, and read
history and status. The wire protocol and the session bridge come from `@robota-sdk/agent-transport`;
this package adds the socket server, connection admission and lifecycle, and pulls in only `ws`.

## Installation

```bash
npm install @robota-sdk/agent-transport-ws @robota-sdk/agent-transport
```

Requires Node.js 22.12 or later. `@robota-sdk/agent-transport` provides the session and message types
used below.

## Usage

```typescript
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import type { IProtocolSession } from '@robota-sdk/agent-transport';

declare const session: IProtocolSession; // e.g. an InteractiveSession from @robota-sdk/agent-framework

const transport = new WsTransport({ port: 7070 });
transport.attach(session);
await transport.start();

// Hand both to your client; it connects to ws://127.0.0.1:<port>/?token=<token>
console.log(transport.boundPort, transport.resolvedToken);

await transport.stop();
```

The server listens on `127.0.0.1` only. If the port is taken it tries the next one, up to `maxRetries`
times; `boundPort` reports the port actually bound.

Every connection must present the token, as a `?token=` query parameter or as the
`Sec-WebSocket-Protocol` value, or it is closed before any session data is sent. Without a `token`
option, a random token is minted per launch and exposed as `resolvedToken`. The `Host` header must be a
loopback name, and a browser's `Origin` must be loopback, so another web page cannot reach the socket.
Running without a token takes `open: true` with an `openReason`, and is discouraged: any local process
could then drive the session.

Clients exchange JSON text frames typed as `TClientMessage` / `TServerMessage` from
`@robota-sdk/agent-transport`, whose `./client` entry point also provides browser-safe decoders.

## `WsTransport` options

| Option                                                                   | Type                          | Description                                                                                          |
| ------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| `port`                                                                   | `number`                      | Port to bind. Default `7070`.                                                                        |
| `maxRetries`                                                             | `number`                      | Next ports to try when the port is in use. Default `20`.                                             |
| `token`                                                                  | `string`                      | Credential every connection must present. Omitted: one is minted per launch.                         |
| `open` / `openReason`                                                    | `boolean` / `string`          | Run without a token; `openReason` must say why. Rejected together with `token`.                      |
| `allowedHosts` / `allowedOrigins`                                        | `readonly string[]`           | Extra `Host` names and browser `Origin`s to accept beyond loopback.                                  |
| `driverId` / `surface`                                                   | `TDriverId` / `TUsageSurface` | Identity recorded on turns submitted through this transport, set by the host rather than the client. |
| `sessionDirectory`                                                       | `ISessionDirectory`           | Lets clients list, start and switch the host's sessions.                                             |
| `sessionBinder`                                                          | `ISessionBinder`              | Gives each connection its own session binding, so one client's switch does not move the others.      |
| `personalUsageReporter` / `usageReporter` / `storedSessionUsageReporter` | reporters                     | Host-owned usage read models, available to admitted connections.                                     |

`start()` before `attach()` throws, as does a second `start()` while running. `stop()` closes every
client (forcing any that do not close within a few seconds), is safe to call more than once, and
requires `attach()` again before the next `start()`.

Delivery failures are the connection's problem, not the session's: if a socket is closed or a send fails,
that connection is cleaned up once and the session operation that produced the event is unaffected.

## Other exports

- `createWsTransport(options)` — the same session bridge without a server, for a WebSocket you already
  own. Pass a `send` function; after `start()`, feed each inbound text frame to `transport.onMessage`.
- `registerChannel(descriptor)` on `WsTransport` and the standalone `PayloadChannelRegistry` — carry
  application-defined events and binary frames on the same connection as the agent protocol. Binary
  frames go to channels; text frames go to the agent protocol.
- Types: `IWsTransportConfig` (the options above), `IWsTransport`, `IWsTransportOptions`,
  `TChannelSink`.

## Related

- [`@robota-sdk/agent-transport`](../agent-transport/README.md) — the wire protocol and session bridge.
- [`@robota-sdk/agent-transport-webrtc`](../agent-transport-webrtc/README.md) — the same protocol
  carried peer to peer.
- [docs/SPEC.md](./docs/SPEC.md) — package contract and invariants.
