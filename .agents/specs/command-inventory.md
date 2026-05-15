# Command Inventory

This inventory records the current user-visible built-in command ownership after the
command-module migration. Built-in means the Robota product composes the module by default; it does
not mean the implementation lives in `agent-sdk` or `agent-cli`.

## Layering Rules

- `agent-sdk` owns command contracts, common APIs, registry/executor infrastructure, and host
  context/effect contracts.
- `agent-command-*` packages own user-visible built-in command metadata and execution.
- `agent-cli` composes the default product command modules, renders generic interactions/effects,
  and applies host adapters.
- Reusable CLI/TUI code must not import or special-case command implementation packages.

## Current Built-ins

| Command           | Owner package                           | Lifecycle | Model-invocable | Host adapter/effect surface                               |
| ----------------- | --------------------------------------- | --------- | --------------- | --------------------------------------------------------- |
| `/agent`          | `@robota-sdk/agent-command-agent`       | inline    | yes             | agent runtime session requirement and background job APIs |
| `/background`     | `@robota-sdk/agent-command-background`  | inline    | no              | background task read/control APIs                         |
| `/clear`          | `@robota-sdk/agent-command-session`     | inline    | no              | `conversation-history-cleared` effect                     |
| `/compact`        | `@robota-sdk/agent-command-compact`     | blocking  | yes             | compaction host context                                   |
| `/context`        | `@robota-sdk/agent-command-context`     | inline    | no              | context reads and auto-compact settings persistence       |
| `/cost`           | `@robota-sdk/agent-command-session`     | inline    | no              | session info reads                                        |
| `/exit`           | `@robota-sdk/agent-command-exit`        | inline    | no              | `session-exit-requested` effect                           |
| `/help`           | `@robota-sdk/agent-command-help`        | inline    | no              | registered command listing                                |
| `/language`       | `@robota-sdk/agent-command-language`    | inline    | no              | `language-change-requested` effect                        |
| `/memory`         | `@robota-sdk/agent-command-memory`      | inline    | yes             | project memory APIs                                       |
| `/mode`           | `@robota-sdk/agent-command-mode`        | inline    | no              | permission mode APIs                                      |
| `/model`          | `@robota-sdk/agent-command-model`       | inline    | no              | `model-change-requested` effect                           |
| `/permissions`    | `@robota-sdk/agent-command-permissions` | inline    | no              | permission/session-approved-tool reads                    |
| `/plugin`         | `@robota-sdk/agent-command-plugin`      | inline    | no              | plugin adapter and `plugin-tui-requested` effect          |
| `/provider`       | `@robota-sdk/agent-command-provider`    | inline    | no              | provider settings adapter, interaction prompts, restart   |
| `/reload-plugins` | `@robota-sdk/agent-command-plugin`      | inline    | no              | `plugin-registry-reload-requested` effect                 |
| `/rename`         | `@robota-sdk/agent-command-session`     | inline    | no              | `session-renamed` effect                                  |
| `/reset`          | `@robota-sdk/agent-command-reset`       | inline    | no              | `settings-reset-requested` effect                         |
| `/resume`         | `@robota-sdk/agent-command-session`     | inline    | no              | `session-picker-requested` effect                         |
| `/rewind`         | `@robota-sdk/agent-command-rewind`      | inline    | no              | checkpoint list/restore/rollback APIs                     |
| `/settings`       | `@robota-sdk/agent-command-settings`    | inline    | no              | `settings-tui-requested` effect                           |
| `/statusline`     | `@robota-sdk/agent-command-statusline`  | inline    | no              | `statusline-settings-patch` effect                        |
| `/user-local`     | `@robota-sdk/agent-command-user-local`  | inline    | no              | user-local storage reads/writes (memory, storage inspect) |

## Retired Sources

- `agent-sdk` `createSystemCommands()` intentionally returns no user-visible built-ins.
- `BuiltinCommandSource` is empty by default; default product command metadata comes from composed
  command modules.
- `agent-cli` no longer keeps a `slash-executor.ts` command-specific switch. TUI slash input routes
  through `session.executeCommand(name, args)` first, then generic skill/plugin fallback, then
  unknown-command rendering.
