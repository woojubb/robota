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

| Command                           | Behavior                                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/agent`                          | List available agent definitions and active/terminal agent jobs.                                                                                                       |
| `/agent PROMPT`                   | Spawn one `general-purpose` background agent with the natural-language prompt and return `agentId` immediately.                                                        |
| `/agent AGENT_NAME PROMPT`        | Spawn the named background agent when `AGENT_NAME` matches an available agent definition.                                                                              |
| `/agent run [AGENT_NAME] PROMPT`  | Compatibility alias for background agent spawn. Defaults to `general-purpose` when `AGENT_NAME` is omitted.                                                            |
| `/agent parallel <spec>`          | Spawn multiple background agents from a structured spec, create a `wait_all` background job group, wait for group completion, and return the SDK group result summary. |
| `/agent parallel --wait <spec>`   | Compatibility alias for default `parallel` behavior: wait for group completion and return the SDK group result summary.                                                |
| `/agent parallel --detach <spec>` | Spawn multiple background agents, create a `wait_all` group, and return all `agentId` values plus `groupId` immediately for later `/agent wait GROUP_ID`.              |
| `/agent wait GROUP_ID`            | Wait for an existing background job group and return the SDK group result summary.                                                                                     |
| `/agent read AGENT_ID [OFFSET]`   | Read retained transcript/log output for an agent job.                                                                                                                  |
| `/agent send AGENT_ID PROMPT`     | Send follow-up input to a running/open agent when supported.                                                                                                           |
| `/agent stop AGENT_ID [REASON]`   | Cancel a running/queued agent job.                                                                                                                                     |
| `/agent close AGENT_ID`           | Close a terminal agent job.                                                                                                                                            |
| `/agent open AGENT_ID`            | Read/focus an agent job detail view when supported by the host.                                                                                                        |

Agent spawn commands are background-first. The user-facing syntax does not require `--background`; the flag is accepted only as a compatibility no-op.

`parallel` accepts both `label=agent:"prompt"` and simpler `label:"prompt"` tokens. The simpler form defaults to `general-purpose`. `parallel` spawns all valid jobs before waiting for any result, creates a background job group with `wait_all`, and waits for the SDK-owned group completion result before returning the command result. Jobs still run as background jobs; the command waits on the group summary so model-routed parallel delegation produces a consolidated parent response even when the model omits an explicit wait flag. `--wait` is accepted as an explicit compatibility alias. `--detach` returns created job IDs immediately and leaves consolidation to a later `/agent wait GROUP_ID`.

Model-routed command execution must call the generic `ExecuteCommand` tool with `command: "agent"` and natural command arguments. Assistant text is not command execution and must not be emitted as a substitute for the tool call.

For parallel delegation, the `/agent` descriptor should guide the model to give each agent a self-contained task and request a concise final summary from each agent. `parallel` is the default same-turn orchestration path and returns the consolidated SDK group summary. Detached background orchestration must be requested explicitly with `parallel --detach ...`, which returns `groupId` for later `/agent wait GROUP_ID`. That guidance belongs to this command descriptor, not to `system-prompt-builder` or SDK core prompt code.

When the user enters `/agent run <natural-language prompt>`, the first unflagged token is treated as an agent type only if it matches an available agent definition or was supplied through `--agent`/`--type`. Otherwise the whole phrase remains the prompt and the command defaults to `general-purpose`. This keeps arbitrary natural-language prompts from being misread as unknown agent names.

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
