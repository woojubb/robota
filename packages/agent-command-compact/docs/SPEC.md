# SPEC.md — @robota-sdk/agent-command-compact

## Package Scope

`@robota-sdk/agent-command-compact` owns the composable `/compact` command module.

This package:

- exports a command module compatible with `@robota-sdk/agent-sdk`'s `ICommandModule` interface;
- owns `/compact` command palette metadata;
- owns `/compact` descriptor metadata, model-invocable policy, system command parsing, and execution;
- consumes SDK context/compact command APIs through the command host facade.

This package does not own:

- context-window estimation or tracking;
- the `Session.compact()` implementation;
- `InteractiveSession` lifecycle orchestration;
- TUI rendering or input handling.

## Public API

```ts
import { createCompactCommandModule } from '@robota-sdk/agent-command-compact';
```

| Symbol                       | Kind     | Description                                         |
| ---------------------------- | -------- | --------------------------------------------------- |
| `createCompactCommandModule` | function | Returns an `ICommandModule` for `/compact` support  |
| `createCompactCommandEntry`  | function | Returns command palette metadata for `/compact`     |
| `executeCompactCommand`      | function | Executes manual context compaction through SDK APIs |
| `CompactCommandSource`       | class    | Supplies slash palette metadata for `/compact`      |

## Command Behavior

| Command                   | Behavior                                                          |
| ------------------------- | ----------------------------------------------------------------- |
| `/compact`                | Compact the current context with no extra focus instructions      |
| `/compact <instructions>` | Compact the current context with user-provided focus instructions |

The executable command declares `lifecycle: "blocking"` so hosts run it through the same foreground thinking/input-guard path as prompt execution. It is model-invocable with `safety: "write"` because compaction mutates the session conversation history by replacing prior messages with a summary.

## Class Contract Registry

| Class/Function               | Implements/Uses                 | Notes                               |
| ---------------------------- | ------------------------------- | ----------------------------------- |
| `CompactCommandSource`       | `ICommandSource`                | Supplies slash palette metadata     |
| `createCompactSystemCommand` | `ISystemCommand`                | Supplies executable command handler |
| `createCompactCommandModule` | `ICommandModule`                | Composes source and command handler |
| `executeCompactCommand`      | SDK context/compact common APIs | Parses optional instructions        |

## Dependencies

| Package                 | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `@robota-sdk/agent-sdk` | Command contracts and context/compact common API |

No dependency from `agent-sdk` or reusable CLI/TUI internals back into this package is allowed. Product composition roots such as the Robota CLI binary may import this package to make `/compact` available.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-compact test
pnpm --filter @robota-sdk/agent-command-compact typecheck
pnpm --filter @robota-sdk/agent-command-compact build
```
