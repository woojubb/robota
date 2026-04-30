# SPEC.md — @robota-sdk/agent-command-agent

## Package Scope

`@robota-sdk/agent-command-agent` owns the composable `/agent` command module.

This package:

- exports a command module compatible with `@robota-sdk/agent-sdk`'s `ICommandModule` interface;
- owns `/agent` command palette metadata;
- owns `/agent` system command parsing and execution;
- requests the SDK `agent-runtime` session requirement so the host session wires agent tools and background runtime support.

This package does not own:

- `InteractiveSession` lifecycle or storage;
- `SubagentManager` or `BackgroundTaskManager` state machines;
- TUI rendering;
- provider creation.

## Public API

```ts
import { createAgentCommandModule } from '@robota-sdk/agent-command-agent';
```

| Symbol                     | Kind     | Description                                      |
| -------------------------- | -------- | ------------------------------------------------ |
| `createAgentCommandModule` | function | Returns an `ICommandModule` for `/agent` support |

## Composition Contract

Hosts compose this package by passing the returned command module into `InteractiveSession` and command palette registries.

```ts
const agentCommandModule = createAgentCommandModule();

const session = new InteractiveSession({
  cwd,
  provider,
  commandModules: [agentCommandModule],
});

const registry = new CommandRegistry();
registry.addModule(agentCommandModule);
```

If this module is not composed, the host must not expose `/agent`, model-visible `/agent` descriptors, or `/agent` execution.

## Command Behavior

| Command                          | Behavior                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/agent`                         | List available agent definitions and active/terminal agent jobs.                                                |
| `/agent <prompt>`                | Spawn one `general-purpose` background agent with the natural-language prompt and return `agentId` immediately. |
| `/agent <agent> <prompt>`        | Spawn the named background agent when `<agent>` matches an available agent definition.                          |
| `/agent run [<agent>] <prompt>`  | Compatibility alias for background agent spawn. Defaults to `general-purpose` when `<agent>` is omitted.        |
| `/agent parallel <spec>`         | Spawn multiple background agents from a structured spec and return all `agentId` values immediately.            |
| `/agent read <agentId> [offset]` | Read retained transcript/log output for an agent job.                                                           |
| `/agent send <agentId> <prompt>` | Send follow-up input to a running/open agent when supported.                                                    |
| `/agent stop <agentId> [reason]` | Cancel a running/queued agent job.                                                                              |
| `/agent close <agentId>`         | Close a terminal agent job.                                                                                     |
| `/agent open <agentId>`          | Read/focus an agent job detail view when supported by the host.                                                 |

Agent spawn commands are background-first. The user-facing syntax does not require `--background`; the flag is accepted only as a compatibility no-op.

`parallel` accepts both `label=agent:"prompt"` and simpler `label:"prompt"` tokens. The simpler form defaults to `general-purpose`. `parallel` spawns all valid jobs before waiting for any result and returns created job IDs immediately.

Model-routed command execution must call the generic `ExecuteCommand` tool with `command: "agent"` and natural command arguments. Assistant text such as `<agent ... />` is not command execution and must not be emitted as a substitute for the tool call.

## Class Contract Registry

| Class/Function             | Implements/Uses                     | Notes                                     |
| -------------------------- | ----------------------------------- | ----------------------------------------- |
| `AgentCommandSource`       | `ICommandSource`                    | Supplies slash palette metadata           |
| `createAgentSystemCommand` | `ISystemCommand`                    | Supplies executable command handler       |
| `createAgentCommandModule` | `ICommandModule`                    | Composes source, command, and requirement |
| `executeAgentCommand`      | `InteractiveSession` agent job APIs | Calls injected SDK runtime APIs only      |

## Dependencies

| Package                 | Purpose                                   |
| ----------------------- | ----------------------------------------- |
| `@robota-sdk/agent-sdk` | Command interfaces and InteractiveSession |

No dependency from `agent-sdk` or reusable CLI/TUI internals back into this package is required by the command contract. Product composition roots such as the Robota CLI binary may import this package to make `/agent` available.

## Verification

```bash
pnpm --filter @robota-sdk/agent-command-agent test
pnpm --filter @robota-sdk/agent-command-agent typecheck
pnpm --filter @robota-sdk/agent-command-agent build
```
