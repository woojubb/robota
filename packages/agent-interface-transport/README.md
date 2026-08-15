# Agent Interface Transport

Transport contract interfaces for the Robota SDK. This package contains TypeScript type contracts plus a small set of pure, dependency-free derivation accessors over its own event union types (`readAssistantReplies`, `readLastAssistantText`, `readToolCalls`, `readErrors`) and the co-drive driver-id constants — no classes, no I/O, no side effects.

## Installation

```bash
npm install @robota-sdk/agent-interface-transport
```

## Overview

This package defines the standard protocol for transport adapters (headless, HTTP, WebSocket, MCP, WebRTC). TUI is a session-owning presentation channel rather than a borrowed-session adapter. Transport implementations depend on this package, not on `agent-framework`, for interface types.

`IInteractionChannel` is the narrower in-process port used by `createInteractiveRuntime`; it is not the
universal transport contract. Full session surfaces consume the shared interactive event vocabulary
directly. Prompt surfaces receive `permission_request` / `ask_request`, settle through the corresponding
`resolve*` capability, and dismiss on the single canonical `prompt_resolved` event. Checkpoint transitions
are represented by serializable `branch_event` payloads after persistence succeeds.

## Public API

```typescript
import type {
  ITransportAdapter,
  ITransportServiceAdapter,
  ITransportRunnerAdapter,
  ITransportCompletionRecord,
  ITransportFailureRecord,
  IConfigurableTransport,
  ITransportConfig,
  ITransportLifecycleRegistryView,
  ITransportSettingsRegistryView,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';
```

### `ITransportAdapter`

Core transport lifecycle:

```typescript
interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  readonly lifecycle: Readonly<{ kind: 'service' | 'runner' }>;
  attach(session: TSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

`start()` resolves at the adapter's documented readiness boundary. A runner launches from `start()`
and reports its exact `succeeded | failed` exit-code outcome separately through
`ITransportRunnerAdapter.waitForCompletion()`. Starting before attach or while already active is a
typed lifecycle error; stop during pending start prevents late readiness; repeated `stop()` is safe.

The registry's ordered `ITransportCompletionRecord` is wider than an adapter result: normal stop or
startup rollback fills a pending runner slot with `abandoned: stopped | startup-rollback`. The
separate `ITransportFailureRecord` contains only a validated failed runner result, so normal shutdown
does not become process failure.

The registry views are interface-segregated: lifecycle registration accepts any base adapter, while
the settings view lists and mutates only adapters that also implement
`ITransportSettingsCapability`. `TConfigurableTransport` composes that capability with either
lifecycle kind; the legacy `IConfigurableTransport` name remains the configurable-service shape.

### `IConfigurableTransport`

Extends the service adapter with enable/disable and options schema:

```typescript
import type { ITransportServiceAdapter } from '@robota-sdk/agent-interface-transport';

interface IConfigurableTransport<TSession = unknown> extends ITransportServiceAdapter<TSession> {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}
```

### `ITransportConfig`

Persisted transport configuration shape:

```typescript
interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}
```

## Dependency Position

```
agent-core
    ↑
agent-interface-transport   ← this package (contracts only)
    ↑
agent-transport / agent-transport-tui / ...   ← implementations
```

This package must not depend on `agent-framework` or any implementation package.

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-interface-transport)
- [GitHub](https://github.com/woojubb/robota)
