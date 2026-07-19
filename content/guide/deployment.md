# Deployment — one agent definition, many channels

Robota needs no separate "gateway" to serve one agent over many surfaces. You author **one** agent definition,
build **one** session from it, and bind that session to as many channels as you like through the transport
registry. Every channel is a transport that `attach()`es the **same** session instance — the deploy target is an
abstraction, not a fork of your agent.

The registry (`TransportRegistry`) is that abstraction. There is intentionally **no gateway package** and **no
per-surface runtime fork** — a gateway would re-introduce the coupling the transport DIP exists to prevent.

## The pattern

<!-- doc-example-skip: illustrative fragment — `provider`, `settingsPath`, and `port` are placeholders the reader supplies; the runnable form is examples/capabilities/multi-surface-deploy -->

```ts
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';

// 1. ONE definition → ONE session, built once.
const runtime = createAgentRuntime({ cwd: process.cwd(), provider });
const session = runtime.createSession({ permissionMode: 'bypassPermissions' });

// 2. Bind that ONE session to MANY channels.
const registry = new TransportRegistry(settingsPath);
registry.register(new WsTransport({ port })); // an IConfigurableTransport → started by startAll
await registry.startAll(session); // attaches + starts every enabled transport on THIS session

const http = createHttpTransport(); // a plain ITransportAdapter factory → mounted out-of-band
http.attach(session); // the SAME session instance
await http.start();
```

Both channels now serve the one session. See the runnable
[`examples/capabilities/multi-surface-deploy`](../../examples/capabilities/multi-surface-deploy/).

## Two mounting styles

| Transport shape                                 | How it mounts                                             | Examples              |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------- |
| `IConfigurableTransport` (has `defaultEnabled`) | registered; `registry.startAll(session)` starts it        | `tui`, `ws`, `webrtc` |
| plain `ITransportAdapter` factory               | mounted out-of-band: `t.attach(session); await t.start()` | `http`, `mcp`         |

A `defaultEnabled:false` transport (e.g. the pairing-gated `WebRtcTransport` in REMOTE-001) is **not** started
by `startAll` — it is attached out-of-band to the same session when its trigger fires. That is the live proof
that two transports share one session simultaneously.

## Surface → runtime → transport

Which surface maps to which runtime and transport is catalogued in the
[deployment matrix](../../.agents/specs/deployment-matrix.md) (a drift-guarded registry). In short: CLI/TUI runs
in-process (`tui`); Desktop and HTTP/WS servers run a headless `robota --serve` (`ws`/`http`); the web playground
and remote P2P ride `ws`/`webrtc`; MCP hosts ride `mcp`. Each surface keeps its own composition root and auth
posture (the CLI resolves settings/preset/provider; `--serve` adds the loopback WS nonce; REMOTE-001 adds the
pairing-gated WebRTC channel) — but they all attach to **one** session over the **same** registry seam.
