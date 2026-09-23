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
import { TransportRegistry } from '@robota-sdk/agent-framework';
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';

// 1. ONE definition → ONE session, built once.
const runtime = createAgentRuntime({ cwd: process.cwd(), provider });
const session = runtime.createSession({ permissionMode: 'bypassPermissions' });

// 2. Bind that ONE session to MANY channels.
const registry = new TransportRegistry(settingsPath);
registry.register(new WsTransport({ port })); // an IConfigurableTransport → started by startAll
registry.register(createHttpTransport()); // a plain adapter → lifecycle-managed, no settings row
await registry.startAll(session); // attaches + starts every enabled transport on THIS session
```

The registry serializes startup and shutdown. A second active `startAll()` is rejected before
mutation; partial startup is rolled back in reverse order. Runner adapters report only their own
success/failure, while `waitForCompletion()` may record a pending runner as registry-owned
`abandoned` on normal stop or startup rollback. That abandonment does not make normal shutdown fail.

Both channels now serve the one session. See the runnable
[`examples/capabilities/multi-surface-deploy`](../../examples/capabilities/multi-surface-deploy/).

## Two registry projections

| Transport shape                                 | Lifecycle projection                                   | Settings projection |
| ----------------------------------------------- | ------------------------------------------------------ | ------------------- |
| `IConfigurableTransport` (has `defaultEnabled`) | registered; `startAll(session)` starts it when enabled | listed and mutable  |
| plain `ITransportAdapter` factory               | registered; always lifecycle-enabled                   | absent              |

A `defaultEnabled:false` transport (e.g. the pairing-gated `WebRtcTransport` in REMOTE-001) is **not** started
by `startAll` — it is attached out-of-band to the same session when its trigger fires. That is the live proof
that two transports share one session simultaneously.

## Surface → runtime → transport

Which surface maps to which runtime and transport is catalogued in the
[deployment matrix](../../.agents/specs/deployment-matrix.md) (a drift-guarded registry). In short: CLI/TUI runs
in-process through the presentation channel; Desktop and HTTP/WS servers run a headless `robota --serve` (`ws`/`http`); the web playground
and remote P2P ride `ws`/`webrtc`; MCP hosts ride `mcp`. Each surface keeps its own composition root and auth
posture (the CLI resolves settings/preset/provider; `--serve` adds the loopback WS nonce; REMOTE-001 adds the
pairing-gated WebRTC channel) — but they all attach to **one** session over the **same** registry seam.
