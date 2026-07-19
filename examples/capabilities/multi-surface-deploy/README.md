# Capability: one agent definition → many channels

No gateway. You build **one** session from one definition and bind it to as many transports as you want through
the `TransportRegistry` — every transport `attach()`es the **same** session instance. This is the transport DIP:
the deploy target is an abstraction, the agent definition is authored once.

- An **`IConfigurableTransport`** (has `defaultEnabled`, e.g. `WsTransport`) is registered and started by
  `registry.startAll(session)`.
- A plain **`ITransportAdapter`** factory (e.g. `createHttpTransport()`) is mounted **out-of-band** on the same
  session: `t.attach(session); await t.start()`.

See [`.agents/specs/deployment-matrix.md`](../../../.agents/specs/deployment-matrix.md) for the surface × runtime
× transport registry and the drift floor that keeps it current.

## Run

```bash
pnpm install
ANTHROPIC_API_KEY=... pnpm dev
```

The demo serves the channels and makes no model call; it prints the channels the one session is served over,
then cleans up.
