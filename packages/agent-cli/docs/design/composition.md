# agent-cli — composition and transport registry

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer. Placement follows the
> consumer-impact test in
> [`design-doc-authoring`](../../../../.agents/skills/design-doc-authoring/SKILL.md).

## Context & Goal

The CLI assembles a product from injected definitions and registers transports at startup. Which
registry holds a transport, and when it is constructed, is invisible to the user and to importers —
only the resulting behaviour is contract.

## Constraints

- Composition must not branch on concrete provider or transport names (`NEUT-009`).
- The shell resolves the preset registry once and the kernel adopts it (`ARCH-008`); a second registry
  is a defect, not an optimisation.

## Internal Structure

### Transport Registry

The CLI assembles a `TransportRegistry` (the generic registry class is owned by
`@robota-sdk/agent-transport`, `packages/agent-transport/src/transport-registry.ts`) via a local
composition-root helper `createDefaultTransportRegistry()` in `cli.ts` that registers `WsTransport`
from `@robota-sdk/agent-transport-ws`, and passes it to `renderApp()` (from
`@robota-sdk/agent-transport-tui`). `renderApp()` creates a `TuiInteractionChannel` which starts all
enabled transports against the active `InteractiveSession` it owns.

Registered transports:

| Transport     | Package                          | Default enabled | Purpose                                           |
| ------------- | -------------------------------- | --------------- | ------------------------------------------------- |
| `WsTransport` | `@robota-sdk/agent-transport-ws` | false           | Expose session over WebSocket for browser monitor |

Transport enabled/disabled state and options are persisted in `settings.json` under the `transports`
key. The CLI does not own WebSocket protocol framing or browser monitor UI.

## Key Flows

Startup resolves settings → builds base command modules → `assembleProduct(createRobotaProfile(…))`
→ applies the preset delta → constructs `InteractiveSession` → registers transports. The observable
end of that chain is specified in [`../SPEC.md`](../SPEC.md) under `Configuration`.

## Test Approach

Covered by the CLI startup composition tests and the composition-neutrality scan
(`scripts/harness/check-composition-neutrality.mjs`).
