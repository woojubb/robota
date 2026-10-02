# @robota-sdk/agent-interface-tui

Terminal UI interaction contracts for the Robota SDK. A command can declare what the terminal UI
should do when the user runs it without arguments: show a picker, run a wizard, or ask for
confirmation. This package declares the shape of that declaration, so command code can describe
the interaction without depending on the UI that renders it.

The package contains type declarations only: no runtime functions, no React, no Ink, and no
dependencies.

## Installation

```bash
npm install @robota-sdk/agent-interface-tui
```

## Usage

```ts
import type {
  ITuiPickerInteraction,
  TAnyTuiCommandInteraction,
} from '@robota-sdk/agent-interface-tui';

const languagePicker: ITuiPickerInteraction = {
  onMissingArgs: 'picker',
  getItems: () => [
    { label: 'English', value: 'en' },
    { label: 'Korean', value: 'ko', description: '한국어' },
  ],
};

function prompt(interaction: TAnyTuiCommandInteraction): string {
  // A discriminated union: narrow on the `onMissingArgs` literal.
  return interaction.onMissingArgs === 'picker'
    ? `Choose one of ${interaction.getItems().length} options`
    : interaction.message;
}
```

## API

| Export                      | Description                                              |
| --------------------------- | -------------------------------------------------------- |
| `TOnMissingArgsAction`      | `'picker' \| 'wizard' \| 'confirm'`                      |
| `ITuiCommandInteraction`    | Base shape: an optional `onMissingArgs` action           |
| `ITuiPickerInteraction`     | Picker variant: `getItems()` returns `ITuiPickerItem[]`  |
| `ITuiPickerItem`            | One picker row: `label`, `value`, optional `description` |
| `ITuiConfirmInteraction`    | Confirm variant: a `message` to confirm                  |
| `TAnyTuiCommandInteraction` | Union of the picker and confirm variants                 |

`'wizard'` is part of the action vocabulary but has no dedicated variant; a renderer may leave it
unimplemented.

## Where it sits

- Depends on nothing, and must never gain runtime dependencies.
- Rendering belongs to the terminal UI, `@robota-sdk/agent-ui-terminal`, which re-exports these
  types from its own entry point.

## Documentation

- [`docs/SPEC.md`](docs/SPEC.md) — the contract, boundaries and invariants.

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
