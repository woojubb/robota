# @robota-sdk/agent-interface-tui

TUI interaction contracts for the Robota SDK. Contains only type contracts and narrow type
guards — no implementation, no React, no Ink. Defines the interaction protocol between
command handlers and TUI renderers.

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

- [SPEC.md](./SPEC.md) — package contract, interface catalog, and ownership boundaries.
