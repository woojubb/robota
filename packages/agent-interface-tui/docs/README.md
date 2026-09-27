# @robota-sdk/agent-interface-tui — documents

Terminal UI interaction contracts for the Robota SDK: how a command declares what the terminal UI
should do when it is run without arguments (a picker, a wizard, or a confirmation). Type contracts
only — no runtime functions, no React, no Ink, no dependencies. Rendering belongs to
`agent-ui-terminal`, which re-exports these types.

## Usage

```typescript
import type {
  ITuiCommandInteraction,
  ITuiPickerInteraction,
  ITuiConfirmInteraction,
  TAnyTuiCommandInteraction,
} from '@robota-sdk/agent-interface-tui';
// Type contracts only — narrow TAnyTuiCommandInteraction on the `onMissingArgs` discriminant.
```

## Documents

- [SPEC.md](./SPEC.md) — package contract, boundaries, and invariants.
