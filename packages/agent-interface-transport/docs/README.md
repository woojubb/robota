# @robota-sdk/agent-interface-transport — documents

Transport contracts for the Robota SDK: the service/runner lifecycle every transport adapter
follows, persisted transport configuration and the registry views over it, payload channels a
transport can carry beside its own protocol, and the shape of admission decisions (tokens, access
tokens, external events). Type declarations plus two pure helpers (`createTransportFailedOutcome`,
`isTransportRunOutcome`); no classes, no I/O. It depends only on `@robota-sdk/agent-core` and on no
other `agent-interface-*` package.

## Usage

```typescript
import type {
  ITransportServiceAdapter,
  ITransportRunnerAdapter,
  IConfigurableTransport,
  ITransportRegistryView,
  ITransportAdmission,
} from '@robota-sdk/agent-interface-transport';
// Adapters live in agent-transport-{http,ws,mcp,webrtc} and agent-framework (headless runner,
// TransportRegistry). Admission machinery lives in @robota-sdk/agent-transport/node.
```

The `@robota-sdk/agent-interface-transport/testing` subpath exports
`runTransportLifecycleConformance`, a framework-free suite each adapter package runs to prove it
follows the lifecycle contract.

## Documents

- [SPEC.md](./SPEC.md) — package contract: adapter lifecycle, persisted configuration, registry
  views, payload channels, and transport admission.
