/**
 * Capability: one agent definition → many channels (SELFHOST-013).
 *
 * Robota needs no "gateway" to serve one agent over many surfaces. You build ONE session from one definition
 * (`createAgentRuntime(...).createSession(...)` / `buildRuntimeSession`), then bind it to as many transports as
 * you like through the `TransportRegistry` — every transport `attach()`es the SAME session instance. This is the
 * "deploy target is an abstraction" pattern (Hermes/ADK) realized as the transport DIP.
 *
 * Two mounting styles, both over the one session:
 *   - an `IConfigurableTransport` (has `defaultEnabled`) is registered and started by `registry.startAll(session)`;
 *   - a plain `ITransportAdapter` factory (e.g. HTTP) is mounted out-of-band: `t.attach(session); await t.start()`.
 *
 * Run: ANTHROPIC_API_KEY=... pnpm dev   (the demo serves channels; it makes no model call)
 */
import os from 'node:os';
import path from 'node:path';

import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { createAnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { WsTransport } from '@robota-sdk/agent-transport-ws';

// The provider is part of the definition; this demo serves channels and never calls the model, so any key works.
const apiKey = process.env.ANTHROPIC_API_KEY ?? 'demo-no-model-call';

// 1. ONE agent definition → ONE live session, built once.
const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: createAnthropicProvider({ apiKey }),
});
const session = runtime.createSession({ permissionMode: 'bypassPermissions' });

// 2. Bind that ONE session to MANY channels — no gateway, just the registry.
const settingsPath = path.join(os.tmpdir(), `robota-multi-surface-${process.pid}.json`);
const registry = new TransportRegistry(settingsPath);
registry.register(new WsTransport({ port: 45678 })); // network channel (IConfigurableTransport → startAll)
const http = createHttpTransport(); // plain ITransportAdapter → mounted out-of-band on the same session

try {
  await registry.startAll(session); // attaches + starts every enabled transport on THIS session (WS binds a port)
  http.attach(session); // the same session instance
  await http.start(); // builds the HTTP route app (Hono) — a route builder, not a bound listener here

  const channels = [...registry.getEnabled().map((t) => t.name), http.name];
  console.log(`One session served over ${channels.length} channels: ${channels.join(', ')}`);
  console.log(
    'Each channel attach()ed the SAME session instance — no per-channel rebuild, no gateway.',
  );
} finally {
  // 3. Always clean up (close the WS server + tear down the HTTP app), even on a mid-sequence throw.
  await registry.stopAll();
  await http.stop().catch(() => undefined);
}
process.exit(0);
