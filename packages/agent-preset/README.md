# Agent Preset

Preset contract and resolver for the Robota SDK. A preset is a named, pre-tuned bundle of
`agent-framework` option overrides (persona, model/effort, permission posture, command-module
selection, execution capabilities, autonomy). This package owns the `IPreset` contract, the
built-in `default` preset, and the instance-scoped registry that resolves them.

## Installation

```bash
npm install @robota-sdk/agent-preset
```

## Public API

```typescript
import {
  createPresetRegistry,
  partitionExternalPresets,
  defaultPreset,
  DEFAULT_AGENT_NAME,
} from '@robota-sdk/agent-preset';
import type {
  IPreset,
  IResolvedPresetOptions,
  IPresetSummary,
  IResolvePresetContext,
} from '@robota-sdk/agent-preset';

// A registry is per-call and holds its own list: `[built-ins, ...externalPresets]`. With no
// argument it is the built-ins. Two registries in one process never see each other's presets.
const registry = createPresetRegistry();

// Resolve a preset into framework option overrides.
// Precedence (low → high): preset < cliOverrides < explicit.
const options = registry.resolvePreset('default', {
  cliOverrides: { model: 'some-model' },
  explicit: { temperature: 0.2 },
});

// Discover presets for UX.
const summaries = registry.listPresets(); // [{ id: 'default', title, description }, ...]
```

The `default` preset carries no overrides, so resolving it is a pure no-op that reproduces the
standard agent behaviour (no regression).

## Dependency Position

```
agent-framework        ← neutral assembly + option-type SSOT
    ↑
agent-preset           ← this package (preset contract + resolver)
    ↑
agent-cli              ← consumes createPresetRegistry (per-call resolution, ARCH-008)
agent-command          ← consumes the registry the HOST supplies, through the command-host adapters (ARCH-009)
```

This package depends only on `@robota-sdk/agent-framework` and must not re-export it.

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-preset)
- [GitHub](https://github.com/woojubb/robota)
