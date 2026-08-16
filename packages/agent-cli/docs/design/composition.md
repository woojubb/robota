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

The `transports` settings key is contract — see [`../SPEC.md`](../SPEC.md) under `Configuration`.
The CLI does not own WebSocket protocol framing or browser monitor UI.

### Command Module Composition

Built-in commands are represented as `ICommandModule` instances injected into `InteractiveSession`. Command modules own command metadata and structured command results; the CLI hook layer owns rendering generic interactions and applying typed SDK command effects.

**Composition order (ARCH-005 S2).** The base set (`createDefaultCommandModules`, minus the pack-supplied
names) is merged with the profile's capability packs by `assembleProduct` — additively, with a rejection
channel, never a silent override. The preset's `enabledCommandModules`/`disabledCommandModules` delta is
applied to that merged SUPERSET afterwards: the capability merge widens, the preset delta narrows. The
`/shell` and `/editor` modules are supplied by `@robota-sdk/pack-coding`, not by the base set — dropping
the pack from the profile drops those commands from the product.

**The tool axis, on the same terms (ARCH-006).** `robota`'s packs also own its TOOL surface: the shell
passes `ROBOTA_PACKS_OWN_TOOL_SURFACE` (an empty `defaultTools`) into the kernel's runtime seam, which
REPLACES `agent-framework`'s `createDefaultTools()` tier — so every tool the session runs arrives from a
pack through `additionalTools`, and dropping a pack drops its tools. Because the pack's file tools are
scoped to the `cwd` they are built with, the shell builds the packs (`createRobotaPacks({ cwd })`) before
command setup and passes the instances into the profile; a context-free pack would carry a disarmed
working-directory path guard.

The CLI slash router must not own command-specific switch cases for built-ins when an injected command module can own the command. It may still own slash-prefix parsing, skill/plugin fallback lookup, result projection, and unknown-command rendering.

`/plugin` and `/reload-plugins` are provided by `@robota-sdk/agent-command`. The CLI owns only the local `ICommandPluginAdapter` implementation. It opens `PluginTUI` from the requester-routed `show-plugin-manager` `ui_intent` event and reloads the registry's plugin command source from the `data.pluginRegistryReloaded` result hint.

`/exit` is provided by `@robota-sdk/agent-command`. The command package owns command metadata and emits `session-exit-requested`; the CLI applies that typed effect by gracefully shutting down the session and terminal UI.

## Key Flows

Startup resolves settings → builds base command modules → `assembleProduct(createRobotaProfile(…))`
→ applies the preset delta → constructs `InteractiveSession` → registers transports. The observable
end of that chain is specified in [`../SPEC.md`](../SPEC.md) under `Configuration`.

## Test Approach

Covered by the CLI startup composition tests and the composition-neutrality scan
(`scripts/harness/scan-composition-neutrality.mjs`).
