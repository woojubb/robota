# SDK Model Capability Tool Projection

## Status

Completed.

## Created

2026-05-07

## Priority

P1 - model-routed command correctness.

## Problem

Model-invocable Robota commands currently use the generic `ExecuteCommand` wrapper, where the actual command is an enum argument. This is standards-compliant function calling, but it can hide command boundaries when many command modules are model-invocable.

Skills and agents must not be treated as special model routes. `skills` and `agent` are built-in command modules. Individual skills are UI/transport virtual aliases only: `/<skill-name> <args>` normalizes inside SDK command execution to command `skills` with args `<skill-name> <args>`. TUI and headless transports must not directly route skills or agents.

The original model route was:

- Built-in command modules expose `ISystemCommand.modelInvocable`.
- `createSession()` registers the generic `ExecuteCommand` tool when at least one composed command descriptor is model-invocable.
- `skills` model activation is `ExecuteCommand({ command: "skills", args: "<skill-name> [args]" })`.
- Skill names and descriptions remain in the system prompt `Skills` section as metadata SSOT.
- Full `SKILL.md` content is loaded only after SDK skill activation.

The completed implementation projects each model-invocable command descriptor into a provider-safe function tool without breaking this layering.

## Current Code Confirmation

- `@robota-sdk/agent-command-skills` owns `skills` as a normal `ICommandModule`.
- `packages/agent-sdk/src/assembly/create-session.ts` now registers projected `robota_command_*` tools only when at least one composed command descriptor is model-invocable.
- `packages/agent-sdk/src/tools/model-command-tool-projection.ts` maps command descriptors to provider-safe tool names and reverse command identity mappings.
- `packages/agent-sdk/src/tools/command-execution-tool.ts` remains exported as a legacy compatibility helper, but `createSession()` no longer exposes it by default.
- `packages/agent-sdk/src/commands/skill-source.ts` owns skill file discovery as SDK common API.
- `InteractiveSession.executeCommand()` normalizes virtual skill aliases to the composed `skills` command.
- Provider packages translate `IChatOptions.tools` into provider-native function tools and must remain domain-neutral.

## External Constraint

OpenAI-compatible function names must contain only letters, numbers, underscores, or dashes and are limited to 64 characters. SDK command ids are already slash-free, but projected provider tool names still need a namespace such as `robota_command_*` and a reverse map back to the command contract.

Reference: <https://platform.openai.com/docs/api-reference/chat/create>

## Scope

- `packages/agent-sdk/src/capabilities/**`
- `packages/agent-sdk/src/tools/**`
- `packages/agent-sdk/src/assembly/create-session.ts`
- `packages/agent-sdk/src/commands/system-command-executor.ts`
- `packages/agent-command-*/src/**`
- `packages/agent-sdk/docs/SPEC.md`
- `packages/agent-sdk/README.md`
- `content/guide/cli.md` and `content/guide/sdk.md`
- Provider tests only to confirm provider neutrality and valid tool schema conversion

## Recommended Direction

Introduce an SDK-owned model capability projection layer that turns model-invocable command descriptors into provider-safe `IToolWithEventService` instances.

Recommended projection:

- `compact` command descriptor -> tool name such as `robota_command_compact`
- `skills` command descriptor -> tool name such as `robota_command_skills`
- `agent` command descriptor -> tool name such as `robota_command_agent`

Each projected tool should:

- use the owning command description as the provider-visible tool description;
- expose a small JSON schema with `args` or command-owned request fields;
- execute the same `ISystemCommand` handler as slash and `ExecuteCommand` paths;
- emit the same structured command and tool events;
- keep a reverse registry from provider-safe tool name to command identity;
- reject projection name collisions at assembly time.

Because this project is still beta, direct projection replaced the generic `ExecuteCommand` wrapper after parity tests passed. `skills` now activates through `robota_command_skills({ args: "<skill-name> [args]" })`.

## Constraints

- Do not add keyword matching, alias tables, stemmers, prompt parsers, or natural-language routing in `InteractiveSession`.
- Do not hardcode Robota command names or skill names in provider packages.
- Do not make providers aware of slash commands, skills, agents, or Robota domain concepts.
- Do not add behavior instructions to the system prompt composer. Capability behavior belongs to the owning command descriptor.
- Do not expose two model routes for the same behavior.
- Do not reintroduce `ExecuteSkill` or a direct model-visible `Agent` tool as parallel routes for command-module-owned capabilities.
- Do not expose user-only or unsafe commands as model-invocable tools.
- Do not edit generated `content/api-reference/**` files directly.

## Acceptance Criteria

- [x] SDK has a pure projection function from model command descriptors to provider-safe tool schemas and reverse mappings.
- [x] Model-invocable built-in commands can be exposed as individual provider-visible tools without command-module owners changing code.
- [x] `skills` remains a model-invocable built-in command module; skill metadata stays in the system prompt `Skills` section.
- [x] Virtual `/<skill-name>` aliases continue to normalize through `skills` inside SDK command execution.
- [x] Provider packages remain domain-neutral and only convert declared tool schemas.
- [x] Headless verification proves a description-matching skill request produces structured command/skill activation evidence, not only assistant prose.
- [x] SPEC/README/content docs describe the model capability projection layer and the no-heuristics boundary.

## Verification Plan

- `pnpm --filter @robota-sdk/agent-sdk test -- command-execution-tool interactive-session-skill-command`
- `pnpm --filter @robota-sdk/agent-command-skills test`
- `pnpm --filter @robota-sdk/agent-transport-headless test -- headless-skill-activation`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- Headless `-p --output-format json` scenario with an injected provider fixture that emits a projected command tool call
- Real-provider smoke check may be run locally, but it must not be the only verification evidence

## Result

- Added SDK-owned provider-safe command projection with `robota_command_*` tool names, collision checks, long-name hashing, and command reverse maps.
- Replaced `createSession()` model-command registration from generic `ExecuteCommand` to projected command tools.
- Kept provider packages domain-neutral; providers still receive normal declared function tools only.
- Updated `skills` and headless verification to prove a `repo-writing`-matching request can run through `robota_command_skills`, load real skill content, and record `skill_activation` events.
- Prevented subagents from inheriting `robota_command_agent`, matching the existing no-recursive-agent tool rule.
