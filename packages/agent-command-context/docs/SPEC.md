# SPEC.md — @robota-sdk/agent-command-context

## Package Scope

`@robota-sdk/agent-command-context` owns the composable `/context` command module.

This package:

- exports a command module compatible with `@robota-sdk/agent-sdk`'s `ICommandModule` interface;
- owns `/context` command palette metadata;
- owns `/context` system command formatting and execution;
- consumes SDK context/compact command APIs through the command host facade.

This package does not own:

- context-window estimation or token accounting;
- automatic compaction runtime policy;
- `InteractiveSession` lifecycle orchestration;
- TUI rendering or input handling.

## Public API

```ts
import { createContextCommandModule } from '@robota-sdk/agent-command-context';
```

| Symbol                       | Kind     | Description                                                   |
| ---------------------------- | -------- | ------------------------------------------------------------- |
| `createContextCommandModule` | function | Returns an `ICommandModule` for `/context` support            |
| `createContextCommandEntry`  | function | Returns command palette metadata for `/context`               |
| `executeContextCommand`      | function | Formats context usage and auto-compact state through SDK APIs |
| `ContextCommandSource`       | class    | Supplies slash palette metadata for `/context`                |

## Command Behavior

| Command    | Behavior                                                                 |
| ---------- | ------------------------------------------------------------------------ |
| `/context` | Show used/max tokens, used percentage, and effective auto-compact policy |

The command reads structured context state and auto-compact threshold values from the SDK command host facade. It does not parse prose or call session internals.

## Class Contract Registry

| Class/Function               | Implements/Uses                 | Notes                               |
| ---------------------------- | ------------------------------- | ----------------------------------- |
| `ContextCommandSource`       | `ICommandSource`                | Supplies slash palette metadata     |
| `createContextSystemCommand` | `ISystemCommand`                | Supplies executable command handler |
| `createContextCommandModule` | `ICommandModule`                | Composes source and command handler |
| `executeContextCommand`      | SDK context/compact common APIs | Formats usage and policy output     |

## Dependencies

| Package                 | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `@robota-sdk/agent-sdk` | Command contracts and context/compact common API |

No dependency from `agent-sdk` or reusable CLI/TUI internals back into this package is allowed. Product composition roots such as the Robota CLI binary may import this package to make `/context` available.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-context test
pnpm --filter @robota-sdk/agent-command-context typecheck
pnpm --filter @robota-sdk/agent-command-context build
```
