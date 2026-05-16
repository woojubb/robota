# Agent Transport TUI

TUI rendering layer for the Robota CLI — Ink/React terminal UI components and the `TuiTransport` adapter.

## Installation

```bash
npm install @robota-sdk/agent-transport-tui
```

## Overview

This package provides everything needed to render an interactive terminal UI for a Robota CLI session. It is the **only** SDK package that may use React and Ink. All other SDK packages are pure TypeScript.

## Quick Start

```typescript
import { TuiTransport } from '@robota-sdk/agent-transport-tui';
import type { IRenderOptions } from '@robota-sdk/agent-transport-tui';

const options: IRenderOptions = {
  cwd: process.cwd(),
  provider,
  cliAdapter,
  commandModules,
  // ...
};

const transport = new TuiTransport(options);
transport.start();
```

## Exports

```typescript
import { TuiTransport } from '@robota-sdk/agent-transport-tui';
import type { ITuiCliAdapter } from '@robota-sdk/agent-transport-tui';
import type { IRenderOptions } from '@robota-sdk/agent-transport-tui';
import type {
  ITuiCommandInteraction,
  ITuiPickerInteraction,
  ITuiConfirmInteraction,
  ITuiPickerItem,
  TAnyTuiCommandInteraction,
  TOnMissingArgsAction,
} from '@robota-sdk/agent-transport-tui';
```

## TUI Command Interaction System

Defines extension points for richer command UX when a user invokes a slash command without supplying arguments.

```typescript
// In agent-cli's interaction registry:
import type { TAnyTuiCommandInteraction } from '@robota-sdk/agent-transport-tui';

const interaction: TAnyTuiCommandInteraction = {
  onMissingArgs: 'picker',
  getItems: () => [
    { label: 'plan', value: 'plan', description: 'Plan only' },
    { label: 'default', value: 'default', description: 'Default mode' },
  ],
};
```

- `ITuiPickerInteraction` — opens a picker overlay (`onMissingArgs: 'picker'`)
- `ITuiConfirmInteraction` — opens a confirm dialog (`onMissingArgs: 'confirm'`)

## Dependency Position

```
agent-core
    ↑
agent-framework    agent-interface-transport
    ↑                      ↑
    └── agent-transport-tui ┘
              ↑
         agent-cli
```

This package must not import from `@robota-sdk/agent-transport` or `@robota-sdk/agent-cli`.

## Dependencies

- `@robota-sdk/agent-core`, `@robota-sdk/agent-framework`, `@robota-sdk/agent-interface-transport`
- `react`, `ink`, `ink-select-input`, `ink-spinner`, `ink-text-input`
- `chalk`, `marked`, `marked-terminal`, `string-width`

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-transport-tui)
- [GitHub](https://github.com/woojubb/robota)
