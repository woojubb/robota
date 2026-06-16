# @robota-sdk/agent-interface-tui

TUI interaction contracts for the Robota SDK. This package contains only type contracts and type guards — no implementation, no React, no Ink.

## Installation

```bash
pnpm add @robota-sdk/agent-interface-tui
```

## Overview

Defines the interaction protocol between command handlers (which may run at any layer) and TUI renderers (which live in `@robota-sdk/agent-transport`).

```
agent-interface-tui            ← this package (contracts only)
  ├── ITuiCommandInteraction   ← base: optional onMissingArgs action
  ├── ITuiPickerInteraction    ← requires picker UI
  ├── ITuiConfirmInteraction   ← requires confirm UI
  └── TAnyTuiCommandInteraction ← union of all interaction shapes

agent-transport-tui
  └── useSideEffects           ← renders interactions via ITuiCliAdapter

agent-command/*
  └── command descriptors      ← annotate onMissingArgs to trigger interaction
```

## API

### Interfaces

| Export                   | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| `ITuiCommandInteraction` | Base interaction: optional `onMissingArgs`                |
| `ITuiPickerInteraction`  | Picker variant: `getItems()` returning `ITuiPickerItem[]` |
| `ITuiPickerItem`         | Item in a picker list: `label`, `value`, `description?`   |
| `ITuiConfirmInteraction` | Confirm variant: `message` string prompt                  |

### Types

| Export                      | Description                         |
| --------------------------- | ----------------------------------- |
| `TAnyTuiCommandInteraction` | Union of all interaction variants   |
| `TOnMissingArgsAction`      | `'picker' \| 'wizard' \| 'confirm'` |

### Narrowing

This package exports no runtime functions. `TAnyTuiCommandInteraction` is a discriminated union —
narrow it directly on the `onMissingArgs` literal (`if (x.onMissingArgs === 'picker')`).

## Boundaries

- **No runtime dependencies** — this package must never gain runtime dependencies.
- No framework or provider knowledge may enter this package.
- Rendering implementation lives in `@robota-sdk/agent-transport`.

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../LICENSE-COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
