# @robota-sdk/agent-command-skills Specification

## Scope

`@robota-sdk/agent-command-skills` owns the `skills` built-in command module. User-facing shells render and parse it as `/skills`; SDK command identity remains `skills`.

The package exports an `ICommandModule` that consumes command contracts and skill common APIs from `@robota-sdk/agent-sdk`. It does not own skill file discovery, skill execution, session orchestration, or UI behavior.

## Public Surface

| Export                       | Type     | Contract                                           |
| ---------------------------- | -------- | -------------------------------------------------- |
| `createSkillsCommandModule`  | function | Returns an `ICommandModule` for `skills` support.  |
| `createSkillsCommandEntry`   | function | Returns command palette metadata for `skills`.     |
| `SkillsCommandSource`        | class    | Provides `skills` command metadata.                |
| `executeSkillsCommand`       | function | Executes `skills` using `ICommandHostContext`.     |
| `SKILLS_COMMAND_DESCRIPTION` | constant | Owner-provided model/user descriptor for `skills`. |

## Layering

- `skills` is a normal built-in command module, equivalent to other `agent-command-*` packages.
- `agent-sdk` owns the common APIs consumed by this command: `ICommandModule`, `ISystemCommand`, `ICommandHostContext`, `SkillCommandSource`, `listSkills()`, and `executeSkillCommandByName()`.
- `agent-cli` composes this module by default and renders generic command results only.
- TUI and headless transports must not directly route skills. They pass slash input to `InteractiveSession.executeCommand()`.
- Individual `/{skill-name}` entries are UI/transport virtual aliases. The SDK normalizes them to command `skills` with args `<skill-name> [args]` when this command module is composed.

## Model Invocation

`skills` is `modelInvocable: true`. The model-facing route is the standard `ExecuteCommand` tool:

```json
{ "command": "skills", "args": "<skill-name> [args]" }
```

When this model-invocable command module is composed, skill names and descriptions are listed in the system prompt `Skills` section as selection metadata. Full `SKILL.md` content is loaded only by SDK skill execution after `skills` activates a matching skill.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-command-skills test`
- `pnpm --filter @robota-sdk/agent-command-skills typecheck`
- `pnpm --filter @robota-sdk/agent-sdk test -- system-command interactive-session-skill-command command-execution-tool`
- `pnpm --filter @robota-sdk/agent-transport-headless test -- headless-skill-activation`
