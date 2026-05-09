# SPEC.md — @robota-sdk/agent-command-context

## Package Scope

`@robota-sdk/agent-command-context` owns the composable `/context` command module.

This package:

- exports a command module compatible with `@robota-sdk/agent-sdk`'s `ICommandModule` interface;
- owns `/context` command palette metadata;
- owns `/context` system command formatting and execution;
- owns `/context list/add/remove/clear` argument parsing and output formatting;
- owns `/context auto ...` argument parsing and auto-compact control semantics;
- consumes SDK context/compact command APIs through the command host facade.

This package does not own:

- context-window estimation or token accounting;
- file resolution, workspace boundary enforcement, or context reference storage;
- automatic compaction runtime enforcement;
- `InteractiveSession` lifecycle orchestration;
- TUI rendering or input handling.

## Public API

```ts
import { createContextCommandModule } from '@robota-sdk/agent-command-context';
```

| Symbol                       | Kind     | Description                                                                            |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------- |
| `createContextCommandModule` | function | Returns an `ICommandModule` for `/context` support                                     |
| `createContextCommandEntry`  | function | Returns command palette metadata for `/context`                                        |
| `executeContextCommand`      | function | Formats context usage, reference inventory, and auto-compact controls through SDK APIs |
| `ContextCommandSource`       | class    | Supplies slash palette metadata for `/context`                                         |

## Command Behavior

| Command                   | Behavior                                                                   |
| ------------------------- | -------------------------------------------------------------------------- |
| `/context`                | Show used/max tokens, effective auto-compact policy, and reference summary |
| `/context list`           | List active manual references and observed prompt `@file` references       |
| `/context add <path>`     | Add a workspace-local file as an active reference for future prompts       |
| `/context remove <path>`  | Remove a manual or observed context reference from the inventory           |
| `/context clear`          | Clear all context references from the inventory                            |
| `/context auto`           | Show the effective auto-compact policy plus control usage                  |
| `/context auto on`        | Enable auto-compaction at the documented default threshold                 |
| `/context auto off`       | Disable auto-compaction                                                    |
| `/context auto <percent>` | Set auto-compaction threshold, for example `85%`                           |
| `/context auto reset`     | Remove the persisted override and restore the current session default      |

The command reads structured context state, reference inventory, and auto-compact threshold values
from the SDK command host facade. Manual reference add/remove/clear operations call SDK common APIs;
the command package never reads files directly. Auto-compact controls update the active session
immediately and persist through the SDK command host settings adapter when one is available. The
command does not parse prose or call session internals.

Future repository situational awareness output must follow
[../../../.agents/specs/repository-situational-awareness.md](../../../.agents/specs/repository-situational-awareness.md).
This package may format SDK-projected context items and provenance labels, but it must not read the
workspace directly, infer package managers, discover commands, score readiness, or write repository
files.

## Class Contract Registry

| Class/Function               | Implements/Uses                           | Notes                                                 |
| ---------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| `ContextCommandSource`       | `ICommandSource`                          | Supplies slash palette metadata                       |
| `createContextSystemCommand` | `ISystemCommand`                          | Supplies executable command handler                   |
| `createContextCommandModule` | `ICommandModule`                          | Composes source and command handler                   |
| `executeContextCommand`      | SDK context/compact/reference common APIs | Formats usage, reference inventory, and policy output |

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
