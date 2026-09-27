# Capability: one agent definition → many channels

No gateway. You build **one** session from one definition and serve it over as many transports as you want
through the `TransportRegistry` — every transport `attach()`es the **same** session instance. The deploy target
is an abstraction; the agent definition is authored once.

- An **`IConfigurableTransport`** (has `defaultEnabled`, e.g. `WsTransport`) is bound to the session with
  `bindTransportAdapter(transport, session)`, registered with `registry.register(...)`, and started by
  `registry.startAll()`.
- A plain **`ITransportAdapter`** factory (e.g. `createHttpTransport()`) is mounted **out-of-band** on the same
  session: `t.attach(session); await t.start()`.

See the [Deployment guide](../../../content/guide/deployment.md) for how surfaces, runtimes and transports fit
together.

## Run

```bash
pnpm install
pnpm dev
```

The demo serves the channels and makes no model call, so no API key is needed (it uses `ANTHROPIC_API_KEY`
when set). It starts a WebSocket transport on port 45678, prints the channels the one session is served over,
then stops both transports.
