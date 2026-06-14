# Agent Preset

Preset contract and resolver for the Robota SDK. A preset is a named, pre-tuned bundle of
`agent-framework` option overrides (persona, model/effort, permission posture, command-module
selection, execution capabilities, autonomy). This package owns the `IPreset` contract, the
built-in `default` preset, and the `resolvePreset` precedence merger.

## Installation

```bash
npm install @robota-sdk/agent-preset
```

## Public API

```typescript
import {
  resolvePreset,
  listPresets,
  getPreset,
  defaultPreset,
  DEFAULT_AGENT_NAME,
} from '@robota-sdk/agent-preset';
import type {
  IPreset,
  TResolvedPresetOptions,
  IPresetSummary,
  IResolvePresetContext,
} from '@robota-sdk/agent-preset';

// Resolve a preset into framework option overrides.
// Precedence (low → high): preset < cliOverrides < explicit.
const options = resolvePreset('default', {
  cliOverrides: { model: 'some-model' },
  explicit: { temperature: 0.2 },
});

// Discover presets for UX.
const summaries = listPresets(); // [{ id: 'default', title, description }, ...]
```

The `default` preset carries no overrides, so resolving it is a pure no-op that reproduces the
standard agent behaviour (no regression).

## Dependency Position

```
agent-framework        ← neutral assembly + option-type SSOT
    ↑
agent-preset           ← this package (preset contract + resolver)
    ↑
agent-cli              ← consumes resolvePreset / listPresets
```

This package depends only on `@robota-sdk/agent-framework` and must not re-export it.

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-preset)
- [GitHub](https://github.com/woojubb/robota)
