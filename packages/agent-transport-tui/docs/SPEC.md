# @robota-sdk/agent-transport-tui — Package Specification

## 1. Purpose

TUI rendering layer for the Robota CLI. Provides all Ink/React terminal UI components, hooks, and the `TuiTransport` adapter. Extracted from `@robota-sdk/agent-transport` (ARCH-001) to isolate React/Ink dependencies from protocol-level transport packages.

## 2. Scope

**In scope:**

- `TuiTransport` — implements `IConfigurableTransport<IInteractiveSession>` for Ink-based interactive sessions
- All React/Ink components: `App`, `InputArea`, `MessageList`, `StatusBar`, `MenuSelect`, `ListPicker`, `ConfirmPrompt`, `PermissionPrompt`, `PluginTUI`, and others
- React hooks: `useInteractiveSession`, `useAutocomplete`, `usePluginCallbacks`, `useSideEffects`, etc.
- Pure-TS TUI helpers: `flows/`, `hooks/` state machines, `utils/`, `render-markdown`, `tui-state-manager`
- TUI command interaction types: `ITuiCommandInteraction`, `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction`

**Out of scope:**

- Protocol-level transports (headless, HTTP, WebSocket, MCP) — those live in `@robota-sdk/agent-transport`
- Browser React rendering — that lives in `agent-web-ui` and `agent-playground`
- Command registration and execution logic — that lives in `agent-command` and `agent-framework`

**React / Ink policy:**

This is the **only** non-app package in the SDK allowed to use React and Ink. All other SDK packages must be pure TypeScript.

## 3. Dependency Position

```
agent-core
    ↑
agent-framework          agent-interface-transport
    ↑                             ↑
    └──────── agent-transport-tui ┘
                      ↑
                 agent-cli
```

`agent-transport-tui` must never import from `agent-transport` or `agent-cli`.

## 4. Dependencies

```
@robota-sdk/agent-core              workspace:*
@robota-sdk/agent-interface-transport workspace:*
@robota-sdk/agent-framework         workspace:*

react                   19.x
ink                     ^7.0.1
ink-select-input        ^6.2.0
ink-spinner             ^5.0.0
ink-text-input          ^6.0.0
chalk                   ^5.3.0
marked                  ^9.1.5
marked-terminal         ^7.3.0
string-width            ^8.2.0
```

## 5. Public API

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

All exports come from the package root (no sub-path exports).

### `TuiTransport`

```typescript
class TuiTransport implements IConfigurableTransport<IInteractiveSession> {
  constructor(options: IRenderOptions);
  start(): void;
}
```

Renders the full Ink TUI to the terminal. Receives an `IRenderOptions` object that carries the CLI adapter, command registry, provider, and all session configuration.

### TUI Command Interaction System

`ITuiCommandInteraction` defines extension points for richer command UX when a user invokes a slash command without supplying args.

- `ITuiPickerInteraction` — opens a picker overlay (`onMissingArgs: 'picker'`)
- `ITuiConfirmInteraction` — opens a confirm dialog (`onMissingArgs: 'confirm'`)

The interaction registry lives in `agent-cli`. `InputArea` receives `resolveInteraction?: (name: string) => ITuiCommandInteraction | undefined` as a prop — no direct dependency on `agent-cli`.

## 6. Build Output

- Format: ESM + CJS dual output via tsdown
- Output directory: `dist/node/`
- Entry point: `index` only (root export, no sub-paths)
- JSX transform: `react-jsx`
- External (never bundled): all `@robota-sdk/*`, `ink*`, `react*`, `chalk`, `marked*`, `string-width`

## 7. Invariants

1. This package must never import from `@robota-sdk/agent-transport`
2. This package must never import from `@robota-sdk/agent-cli`
3. No other SDK package (except `agent-cli`) may depend on this package
4. React and Ink are regular (non-peer) dependencies — consumers do not need to install them separately

## 8. Testing

```bash
pnpm --filter @robota-sdk/agent-transport-tui test
```

Expected: 38 test files, 323 tests, all passing.
