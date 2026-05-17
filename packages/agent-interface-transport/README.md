# Agent Interface Transport

Transport contract interfaces for the Robota SDK. This package contains only TypeScript type contracts — no runtime code, no classes, no implementation.

## Installation

```bash
npm install @robota-sdk/agent-interface-transport
```

## Overview

This package defines the standard protocol for transport adapters (TUI, headless, HTTP, WebSocket, MCP). Transport implementations depend on this package, not on `agent-framework`, for interface types.

## Public API

```typescript
import type {
  ITransportAdapter,
  IConfigurableTransport,
  ITransportConfig,
  ITransportRegistryView,
} from '@robota-sdk/agent-interface-transport';
```

### `ITransportAdapter`

Core transport lifecycle:

```typescript
interface ITransportAdapter<TSession> {
  readonly name: string;
  attach(session: TSession): void;
  start(): void;
  stop?(): void;
}
```

### `IConfigurableTransport`

Extends `ITransportAdapter` with enable/disable and options schema:

```typescript
interface IConfigurableTransport<TSession> extends ITransportAdapter<TSession> {
  readonly defaultEnabled: boolean;
  readonly optionsSchema: Record<string, unknown>;
  validateOptions?(options: unknown): boolean;
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
