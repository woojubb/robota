# ARCH-002-p18: Move TransportRegistry to agent-transport

## Status: todo

## Problem

`packages/agent-cli/src/transports/transport-registry.ts` (98 lines) contains:

- `TransportRegistry` class — manages `IConfigurableTransport` instances with settings-backed
  enable/disable/options persistence (`readSettings`/`writeSettings`)
- `createDefaultTransportRegistry()` — factory that creates a registry and registers `WsTransport`

The class has **zero CLI-specific type dependencies**. It uses only:

- `TUniversalValue`, no agent-cli types
- `IInteractiveSession`, `readSettings`, `writeSettings`, `getUserSettingsPath` from agent-framework
- `IConfigurableTransport`, `ITransportConfig`, `ITransportEntry` from agent-interface-transport

Per CLI-AUDIT-009: CLI must not own persistence contracts. `TransportRegistry` persists transport
config to settings.json — this is a durable framework concern, not a CLI concern.

`createDefaultTransportRegistry` registers `WsTransport` from `@robota-sdk/agent-transport/ws`,
so it can co-locate with the class in agent-transport without creating any circular dependency.

## Fix

1. Move `TransportRegistry` class to
   `packages/agent-transport/src/transport-registry.ts`
2. Move `createDefaultTransportRegistry` to the same file
3. Export both from `packages/agent-transport/src/index.ts` (root export)
4. Update `packages/agent-cli/src/transports/transport-registry.ts` to re-export
   from `@robota-sdk/agent-transport` — then delete the file and update the import
   in `cli.ts` directly:
   ```typescript
   import { createDefaultTransportRegistry } from '@robota-sdk/agent-transport';
   ```
5. Delete `packages/agent-cli/src/transports/transport-registry.ts` and the
   `transports/` directory if empty
6. Build and typecheck both packages; run tests

## Architecture map update

- Add `CLI-AUDIT-019` to layering-audit.md (new finding, immediately resolved)
- Update composition-tree.md: `createDefaultTransportRegistry` now imported from
  `@robota-sdk/agent-transport`
