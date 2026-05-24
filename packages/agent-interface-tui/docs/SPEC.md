# agent-interface-tui Specification

## Scope

Owns TUI interaction contracts for the Robota SDK. This package contains only type contracts and
narrow runtime type guards — no implementation, no classes, no React, no Ink.

It defines the interaction protocol between command handlers (which may run at any layer) and TUI
renderers (which live in `agent-transport/tui`).

## Boundaries

- **Contains only type contracts and narrow type guards — no implementation, no UI, no React.**
- Depends on nothing (`@robota-sdk/agent-core` is not required; TUI contracts are UI-layer only).
- Implementation rendering lives in `agent-transport/src/tui`.
- `agent-framework` uses these contracts to describe TUI interaction requirements for command modules.

## Architecture Overview

```
agent-interface-tui            ← this package (contracts only)
  ├── ITuiCommandInteraction   ← base: optional onMissingArgs action
  ├── ITuiPickerInteraction    ← requires picker UI (getItems → ITuiPickerItem[])
  ├── ITuiConfirmInteraction   ← requires confirm UI (boolean prompt)
  └── TAnyTuiCommandInteraction ← union of all concrete interaction shapes

agent-transport/tui
  └── useSideEffects           ← renders TAnyTuiCommandInteraction via ITuiCliAdapter

agent-command/*
  └── command descriptors      ← annotate onMissingArgs to trigger interaction
```

## Type Ownership

Types owned by this package (SSOT), all defined in `src/command-interaction.ts`:

| Type                        | Kind      | File                     | Description                                                                         |
| --------------------------- | --------- | ------------------------ | ----------------------------------------------------------------------------------- |
| `TOnMissingArgsAction`      | type      | `command-interaction.ts` | Union literal: `'picker' \| 'wizard' \| 'confirm'`                                  |
| `ITuiPickerItem`            | interface | `command-interaction.ts` | Item shape for picker UI: `label`, `value`, `description?`                          |
| `ITuiCommandInteraction`    | interface | `command-interaction.ts` | Base interaction contract: optional `onMissingArgs`                                 |
| `ITuiPickerInteraction`     | interface | `command-interaction.ts` | Extends base; requires `onMissingArgs: 'picker'` and `getItems(): ITuiPickerItem[]` |
| `ITuiConfirmInteraction`    | interface | `command-interaction.ts` | Extends base; requires `onMissingArgs: 'confirm'` and `message: string`             |
| `TAnyTuiCommandInteraction` | type      | `command-interaction.ts` | Union: `ITuiPickerInteraction \| ITuiConfirmInteraction`                            |

No types are imported from other packages; all types are self-contained.

## Public API Surface

| Export                      | Kind      | Description                                                              |
| --------------------------- | --------- | ------------------------------------------------------------------------ |
| `TOnMissingArgsAction`      | type      | `'picker' \| 'wizard' \| 'confirm'`                                      |
| `ITuiPickerItem`            | interface | Item in a picker list (`label`, `value`, `description?`)                 |
| `ITuiCommandInteraction`    | interface | Base interaction: optional `onMissingArgs`                               |
| `ITuiPickerInteraction`     | interface | Picker variant: `getItems()` + `onMissingArgs: 'picker'`                 |
| `ITuiConfirmInteraction`    | interface | Confirm variant: `message` + `onMissingArgs: 'confirm'`                  |
| `TAnyTuiCommandInteraction` | type      | Union of all interaction variants                                        |
| `isPickerInteraction`       | function  | Type guard: narrows `ITuiCommandInteraction` to `ITuiPickerInteraction`  |
| `isConfirmInteraction`      | function  | Type guard: narrows `ITuiCommandInteraction` to `ITuiConfirmInteraction` |

## Extension Points

| Extension Point          | Kind      | Implementor                              | Description                                                |
| ------------------------ | --------- | ---------------------------------------- | ---------------------------------------------------------- |
| `ITuiPickerInteraction`  | interface | command descriptors in `agent-command/*` | Annotate a command's `onMissingArgs` to trigger picker UI  |
| `ITuiConfirmInteraction` | interface | command descriptors in `agent-command/*` | Annotate a command's `onMissingArgs` to trigger confirm UI |

The `useSideEffects` hook in `agent-transport/src/tui` consumes `TAnyTuiCommandInteraction` via
`ITuiCliAdapter` to render the appropriate UI for each variant. No abstract classes are exported.

## Error Taxonomy

This package defines no error types. It contains only type contracts and two narrow type-guard
functions. No exceptions are thrown by this package.

## Invariants

- This package must never gain runtime dependencies.
- No framework or provider knowledge may enter this package.
- `wizard` is defined in the `TOnMissingArgsAction` union but not yet implemented by a transport.

## Test Strategy

No tests required for interface and type declarations. The two runtime exports (`isPickerInteraction`,
`isConfirmInteraction`) are narrow one-line type-guard functions whose correctness is verified
by the TypeScript compiler at every consumer callsite. The `package.json` configures
`vitest run --passWithNoTests` so the test script succeeds with zero test files.

If `wizard` is implemented in the future, a dedicated test file should cover the guard and the
union narrowing behavior.

## Class Contract Registry

This package contains no classes. The interaction interfaces form a discriminated union on the
`onMissingArgs` literal:

| Interface                | Extends                  | Discriminant               |
| ------------------------ | ------------------------ | -------------------------- |
| `ITuiCommandInteraction` | —                        | `onMissingArgs?: string`   |
| `ITuiPickerInteraction`  | `ITuiCommandInteraction` | `onMissingArgs: 'picker'`  |
| `ITuiConfirmInteraction` | `ITuiCommandInteraction` | `onMissingArgs: 'confirm'` |

`TAnyTuiCommandInteraction` is the union consumed by renderers; `isPickerInteraction` and
`isConfirmInteraction` are the narrowing guards for that union.
