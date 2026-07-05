# Skill Node Specification

## Scope

- Owns the `skill` DAG node definition.
- Resolves a Robota skill (by name) to its expanded **inject-mode prompt string**, emitted on an output port. It does NOT run the skill through an LLM — it produces the prompt a downstream LLM node consumes.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- A "skill" is a `SKILL.md` parsed into an `ICommand` (SSOT `@robota-sdk/agent-interface-transport`). This node uses `@robota-sdk/agent-framework` `SkillCommandSource` (discover/list skills) and `executeSkill` (inject mode) to resolve the prompt.
- **Resolver, not executor.** `executeSkill` in inject mode returns a prompt string via pure substitution — no LLM, no provider, no session. Wire this node to an LLM node to actually execute the skill (`skill → llm-text → …`).
- **Fork skills are out of scope.** A skill with `context: 'fork'` requires a subagent LLM loop (`runInFork`), which a pure resolver has no runtime for — the node returns a validation error for such skills.
- **No shell execution.** `executeSkill` is called with no `shellExec`, so `` !`cmd` `` interpolations in a skill body are stripped to empty (never executed) — the resolver never runs arbitrary shell.
- The DAG subsystem stays private; this package is `private: true`. Registered in the async/optional node-registry list (lazy import of the agent-framework-backed node).

## Architecture Overview

- `SkillNodeDefinition` — node with an optional `args` input port (string) and `prompt` + `mode` output ports. `defaultInputPort='args'`, `defaultOutputPort='prompt'`.
- `SkillResolverRuntime` — resolves the skill, isolated from the node for testability via **dependency injection**:
  - `loadCommands(cwd, home): ICommand[]` — defaults to `new SkillCommandSource(cwd, home).getCommands()`.
  - `executeSkillFn` — defaults to `executeSkill`.
  - `resolvePrompt({ skillName, args })`: find the command by name (else `DAG_VALIDATION_SKILL_NOT_FOUND` with the available names as `options`); reject `context: 'fork'` skills (`DAG_VALIDATION_SKILL_FORK_UNSUPPORTED`); call `executeSkillFn(skill, args, {}, { sessionId })` and return `{ prompt, mode }`.
- Args precedence: the `args` input port (if a non-empty string) overrides `config.args`.
- Cost estimate: `config.baseCredits` (default 0 — resolution runs no model).

## Type Ownership

| Type                    | Location              | Purpose                                    |
| ----------------------- | --------------------- | ------------------------------------------ |
| `SkillNodeDefinition`   | `src/index.ts`        | Node definition class                      |
| `SkillNodeConfigSchema` | `src/index.ts`        | Zod config schema                          |
| `SkillResolverRuntime`  | `src/runtime-core.ts` | Skill discovery + inject-prompt resolution |
| `ISkillResolverOptions` | `src/runtime-core.ts` | Injected deps + `cwd`/`home`/`sessionId`   |

## Public API Surface

- `SkillNodeDefinition` — class
- `createSkillNodeDefinition()` — factory function
- `SkillNodeConfigSchema` — Zod schema
- `TSkillNodeConfig` — inferred config type
- `SkillResolverRuntime`, `ISkillResolverOptions` — re-exported from the node module

## Extension Points

- Config `skillName` (required), `args` (static default), `cwd`, `sessionId`, `baseCredits`.
- Runtime options `loadCommands` / `executeSkillFn` for injection (tests / alternate skill sources).
- Error codes: `DAG_VALIDATION_SKILL_NOT_FOUND`, `DAG_VALIDATION_SKILL_FORK_UNSUPPORTED`, `DAG_TASK_EXECUTION_SKILL_RESOLVE_FAILED`.
