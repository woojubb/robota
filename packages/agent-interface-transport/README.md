# @robota-sdk/agent-interface-transport

The transport contracts of the Robota SDK: the lifecycle every transport adapter follows (HTTP,
WebSocket, MCP, WebRTC, headless), how transports are configured and registered, the payload
channels a transport can carry beside its own protocol, and the shape of the admission decisions
that say who may reach a session.

The package is type declarations plus two pure helpers, `createTransportFailedOutcome` and
`isTransportRunOutcome`. It has no classes and no I/O, and it depends only on
`@robota-sdk/agent-core`, for types. Transport implementations depend on this package for their
contracts, not on `@robota-sdk/agent-framework`.

## Installation

```bash
npm install @robota-sdk/agent-interface-transport
```

## Usage

A transport is an adapter with a unique name, a frozen lifecycle kind, and `attach` / `start` /
`stop`. A **service** (a server that keeps running) resolves `start()` once it is ready. A
**runner** (work that ends, such as a headless prompt) launches from `start()` and reports its
exit outcome through `waitForCompletion()`.

```ts
import type {
  ITransportLifecycleError,
  ITransportServiceAdapter,
} from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

export interface ILogTransport extends ITransportServiceAdapter<IInteractiveSession> {
  isServing(): boolean;
}

export function createLogTransport(): ILogTransport {
  let session: IInteractiveSession | null = null;
  let serving = false;
  const lifecycleError = (code: ITransportLifecycleError['code']): ITransportLifecycleError =>
    Object.assign(new Error(`log transport: ${code}`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: 'log',
    });

  return {
    name: 'log',
    lifecycle: Object.freeze({ kind: 'service' }),
    attach(s) {
      session = s;
    },
    async start() {
      if (!session) throw lifecycleError('not-attached');
      if (serving) throw lifecycleError('already-started');
      serving = true; // bind a port, subscribe to session events, ...
    },
    async stop() {
      serving = false; // safe to call repeatedly
    },
    isServing: () => serving,
  };
}
```

Starting before `attach()` or starting twice rejects with a `TransportLifecycleError`; `stop()` is
safe to repeat, and a stopped adapter can be attached and started again.

## What it defines

| Area              | Main types                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter lifecycle | `ITransportAdapter`, `ITransportServiceAdapter`, `ITransportRunnerAdapter`, `TTransportAdapter`, `TTransportRunOutcome`, `ITransportLifecycleError`, `ITransportStartupError` |
| Bound adapters    | `IBoundTransportAdapter`, `TBoundTransportAdapter` — an adapter already bound to its session by the composition root; a registry only holds these                             |
| Configuration     | `ITransportConfig`, `ITransportSettingsCapability`, `IConfigurableTransport`, `TConfigurableTransport`, `ITransportSettingsRepository`, `ITransportConfigurationError`        |
| Registry views    | `ITransportLifecycleRegistryView` (register, start all, wait, stop all), `ITransportSettingsRegistryView` (list, enable, set options), `ITransportRegistryView`               |
| Payload channels  | `IPayloadChannelHost`, `IPayloadChannel`, `IChannelDescriptor`, `TChannelFrame`, `IBinaryFrame`, `IChannelEventFrame`                                                         |
| Admission         | `ITransportAdmission`, `ITransportAdmissionConfig`                                                                                                                            |
| Access tokens     | `IAccessTokenVerifier`, `IAccessTokenVerifierConfig`, `TAccessTokenAdmission`, `TAccessTokenRefusal`                                                                          |
| External events   | `IExternalEventGrant`, `IExternalMessageEvent`, `TExternalEventAdmission`, `TExternalEventAuditRecord`                                                                        |
| Prompt answers    | `TActionResponse` (re-exported from `@robota-sdk/agent-core`)                                                                                                                 |

A configurable transport adds settings to the lifecycle:

```ts
interface ITransportSettingsCapability {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
  configure?(options: Record<string, unknown>): void; // receives saved options before attach/start
}
```

A transport that declares an `optionsSchema` but no `configure` is refused when non-empty options
are saved for it, so a saved option is never silently ignored.

Admission is secure by default: an explicit token wins, otherwise one is minted, and a transport
runs open only when told so with a written reason. This package declares the decision's shape; the
functions that make it (`resolveAdmission`, `createAccessTokenVerifier`) live in
`@robota-sdk/agent-transport/node`.

## Conformance suite: `@robota-sdk/agent-interface-transport/testing`

The `./testing` subpath exports `runTransportLifecycleConformance` and its
`ITransportLifecycleConformanceFixture`. It drives an adapter through the lifecycle contract
(start before attach, double start, repeated stop, restart, stop during start) and throws on the
first violation. It imports no test framework, so it runs inside any test runner:

```ts
import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

await runTransportLifecycleConformance({
  subjectId: 'my-package#createLogTransport',
  kind: 'service',
  createAdapter: () => createLogTransport(),
  createSession: () => createTestInteractiveSession(),
  assertReady: (transport) => {
    if (!transport.isServing()) throw new Error('not serving');
  },
  assertStopped: (transport) => {
    if (transport.isServing()) throw new Error('still serving');
  },
});
```

A runner fixture also supplies `completeRunner`, which releases the runner's pending work.

## Where it sits

- Depends on `@robota-sdk/agent-core` (types only) and on no other `agent-interface-*` package.
- Adapters: `@robota-sdk/agent-transport-http`, `@robota-sdk/agent-transport-ws`,
  `@robota-sdk/agent-transport-mcp`, `@robota-sdk/agent-transport-webrtc`, and the headless runner
  in `@robota-sdk/agent-framework` (`createHeadlessTransport`). Each runs the conformance suite.
- `@robota-sdk/agent-framework`'s `TransportRegistry` implements the registry views;
  `@robota-sdk/agent-transport` implements admission and the payload-channel wire codec.
- `@robota-sdk/agent-ui-terminal` shows and edits transport settings through the registry views,
  and `@robota-sdk/agent-product` takes an `ITransportRegistryView` in a product profile. The
  reference CLI, `@robota-sdk/agent-cli`, creates and registers the transports.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract: adapter lifecycle, configuration, registry views,
  payload channels, and transport admission.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
