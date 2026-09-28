# Deployment — one agent definition, many channels

Robota needs no separate gateway to serve one agent over many surfaces. You build **one** session from
one agent definition and bind that session to as many channels as you need. Every channel is a
transport that `attach()`es the **same** session instance, so a WebSocket client, an HTTP caller and
a paired browser all talk to one conversation.

`TransportRegistry` (in `@robota-sdk/agent-framework`) runs those transports. There is no gateway
package and no per-surface copy of the runtime; a gateway would bring back the coupling the transport
interfaces exist to prevent.

## The pattern

```ts
import os from 'node:os';
import path from 'node:path';

import {
  TransportRegistry,
  bindTransportAdapter,
  createAgentRuntime,
} from '@robota-sdk/agent-framework';
import { createAnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { WsTransport } from '@robota-sdk/agent-transport-ws';

// 1. One definition → one session, built once.
const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: createAnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' }),
});
const session = runtime.createSession({});

// 2. Bind that session to a transport, then register the bound transport.
const registry = new TransportRegistry(path.join(os.tmpdir(), 'robota-transports.json'));
registry.register(bindTransportAdapter(new WsTransport({ port: 45678 }), session));

// 3. A plain adapter can also be mounted directly on the same session.
const http = createHttpTransport();

try {
  await registry.startAll(); // starts every registered, enabled transport
  http.attach(session);
  await http.start();
} finally {
  await registry.stopAll();
  await http.stop();
}
```

- `bindTransportAdapter(transport, session)` fixes which session a transport serves. The registry
  accepts only bound transports and refuses a duplicate name.
- `startAll()` takes no arguments. It starts the enabled transports in order, rejects a second start
  while one is active, and rolls back the ones it already started if one fails. `stopAll()` stops
  them all.
- The argument to `new TransportRegistry(...)` is where transport settings (enabled flags and
  options) are stored: a file path, or an `ITransportSettingsRepository`.

The runnable version, which also prints the channels it serves, is
[`examples/capabilities/multi-surface-deploy`](../../examples/capabilities/multi-surface-deploy/).

## Configurable and plain transports

| Transport shape                                         | Started by `startAll()`                                 | Listed in settings (`getAll()`, `setEnabled`, `setOptions`) |
| ------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| Configurable (has `defaultEnabled`), e.g. `WsTransport` | When enabled (the saved setting, else `defaultEnabled`) | Yes                                                         |
| Plain `ITransportAdapter`                               | Always, once bound and registered                       | No                                                          |

A transport with `defaultEnabled: false`, such as the pairing-gated `WebRtcTransport` in
`@robota-sdk/agent-transport-webrtc`, is not started by `startAll()` until it is enabled. It is
attached to the same session when its own trigger fires (a paired device connecting), so two
transports share one session at the same time.

## Surfaces built on this pattern

- **`robota` terminal UI** runs the session in the same process as the terminal UI.
- **`robota --serve`** runs a headless runtime that serves the session over a loopback WebSocket
  with a per-launch token; `--serve --open` also serves the web GUI on localhost.
- **`robota daemon start`** keeps one such runtime per workspace; the desktop app, `robota --attach`
  and the served GUI connect to it. See
  [Sessions, Background Sessions and the Daemon](./sessions-and-daemon.md).
- **`robota mcp serve`** serves one session to MCP clients (`@robota-sdk/agent-transport-mcp`). See
  [Model Context Protocol (MCP)](./mcp.md).
- **Remote control** attaches a pairing-gated WebRTC transport to the running session. See
  [Devices, Peers and Remote Control](./devices-and-remote.md).

Each surface keeps its own composition root and its own access rules (the CLI resolves settings,
preset and provider; `--serve` adds the loopback token; remote control adds device pairing), but they
all attach to one session through the same transport contract. For servers, bots and serverless
functions built on `agent-framework`, see [Embedding agent-framework](./embedding.md).
