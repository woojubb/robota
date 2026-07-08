# agent-interface-tui Specification

## Scope

Owns TUI interaction contracts for the Robota SDK. This package contains only type contracts —
no implementation, no classes, no runtime functions, no React, no Ink.

It defines the interaction protocol between command handlers (which may run at any layer) and TUI
renderers (which live in `agent-transport-tui`).

## Boundaries

- **Contains only type contracts — no runtime functions, no implementation, no UI, no React.**
- Depends on nothing (`@robota-sdk/agent-core` is not required; TUI contracts are UI-layer only).
- Implementation rendering lives in the `agent-transport-tui` package.
- `agent-transport-tui` uses these contracts to describe TUI interaction requirements for command modules.

## Architecture Overview

```
agent-interface-tui            ← this package (contracts only)
  ├── ITuiCommandInteraction   ← base: optional onMissingArgs action
  ├── ITuiPickerInteraction    ← requires picker UI (getItems → ITuiPickerItem[])
  ├── ITuiConfirmInteraction   ← requires confirm UI (boolean prompt)
  └── TAnyTuiCommandInteraction ← union of all concrete interaction shapes

agent-transport-tui
  └── useSideEffects           ← renders TAnyTuiCommandInteraction via ITuiCliAdapter

agent-command/*
  └── command descriptors      ← annotate onMissingArgs to trigger interaction
```

## Public API

| Export                      | Kind      | Description                                              |
| --------------------------- | --------- | -------------------------------------------------------- |
| `TOnMissingArgsAction`      | type      | `'picker' \| 'wizard' \| 'confirm'`                      |
| `ITuiPickerItem`            | interface | Item in a picker list (`label`, `value`, `description?`) |
| `ITuiCommandInteraction`    | interface | Base interaction: optional `onMissingArgs`               |
| `ITuiPickerInteraction`     | interface | Picker variant: `getItems()` + `onMissingArgs: 'picker'` |
| `ITuiConfirmInteraction`    | interface | Confirm variant: `message` + `onMissingArgs: 'confirm'`  |
| `TAnyTuiCommandInteraction` | type      | Union of all interaction variants                        |

This package exports no runtime functions. `TAnyTuiCommandInteraction` is a discriminated union —
narrow it directly on the `onMissingArgs` literal (`if (x.onMissingArgs === 'picker')`); no
dedicated type-guard functions are provided.

## Invariants

- This package must never gain runtime dependencies.
- No framework or provider knowledge may enter this package.
- `wizard` is defined in the `TOnMissingArgsAction` union but not yet implemented by a transport.
