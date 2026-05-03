# SDK Command Common API Layer

## What

Build the SDK-owned common API layer that lets every built-in command be implemented as an external-style `agent-command-*` module instead of as SDK-embedded or CLI/TUI-specific logic.

This is immediate work, not a long-term compatibility track. Robota is still in beta and this structure has not been released as a stable contract, so the implementation should move directly to the final layering without preserving duplicate legacy command paths.

## Why

Command implementations need a stable API surface that is strong enough to support provider setup, compact/context management, model switching, permissions, memory, rewind, background tasks, plugin commands, statusline changes, and session operations without letting command-specific behavior leak into `agent-cli` or SDK orchestration classes.

The command layer must make these boundaries explicit:

- `agent-sdk` owns generic command contracts, command host context, lifecycle metadata, interactions, effects, and reusable command-facing ports.
- `agent-command-*` packages own user-visible command behavior and consume SDK APIs like third-party modules.
- `agent-cli` stays a thin host that composes modules, renders generic interactions, applies typed effects, and implements local adapters.
- `agent-core` receives only lower-level domain-neutral contracts when a command API proves to be foundational outside SDK command/session execution.

## Final Target Structure

```text
packages/
  agent-sdk/
    src/
      command-api/
        contracts.ts
        lifecycle.ts
        interactions.ts
        effects.ts
        host-context.ts
        host-adapters.ts
        provider/
        context/
        session/
        permissions/
        model/
        memory/
        background/
        checkpoint/
      commands/
        registry.ts
        executor.ts
        module-loader.ts
  agent-command-provider/
  agent-command-compact/
  agent-command-context/
  agent-command-model/
  agent-command-permissions/
  agent-command-memory/
  agent-command-rewind/
  agent-command-background/
  agent-command-session/
  agent-command-plugin/
  agent-command-statusline/
  agent-cli/
```

`packages/agent-sdk/src/commands/` should become registry/executor infrastructure only. Feature command implementation files under SDK should be removed, not kept as compatibility aliases.

## API Responsibilities

### Generic Command Contracts

- [ ] Define one public command module contract for user-visible commands.
- [ ] Define one command descriptor contract used by slash autocomplete, `/help`, model-invocable command exposure, and documentation.
- [ ] Define lifecycle metadata for blocking, background, write, process-control, interactive, restart-required, and host-adapter requirements.
- [ ] Define result contracts for success, failure, warnings, structured display payloads, queued follow-up work, typed interactions, and typed effects.
- [ ] Remove duplicate descriptor lists once all command metadata is derived from registered command modules.

### Command Host Context

- [ ] Introduce a narrow `ICommandHostContext` or equivalent facade passed to command modules.
- [ ] Do not pass `InteractiveSession`, React state, CLI settings files, provider factories, or TUI hooks directly to command modules.
- [ ] Split host context into focused sub-facades so commands depend only on the capabilities they declare.
- [ ] Add tests proving commands can be executed through the host context without importing `agent-cli`.

### Host Adapter Contracts

- [ ] Define SDK-owned adapter interfaces for settings reads/writes, process restart/exit, session picking, statusline patching, plugin UI actions, provider creation, and local environment access.
- [ ] Ensure `agent-cli` implements adapters at the composition root.
- [ ] Ensure command packages receive adapters only through SDK command execution context.
- [ ] Add harness checks that block command packages from importing CLI/TUI code.

### Interaction and Effect Contracts

- [ ] Keep all command prompts generic, typed, and render-agnostic.
- [ ] Keep all command side effects typed and host-applied.
- [ ] Remove command-specific interaction state machines from TUI hooks.
- [ ] Add parity tests for provider setup, compact progress, model restart, statusline patch, plugin actions, and exit/restart effects.

### Provider Common API

- [x] Move provider env-ref, provider settings document, profile merge/validation, setup-flow primitives, and provider probe contracts under `agent-sdk/src/command-api/provider/`.
- [x] Extract `/provider` behavior into `agent-command-provider`.
- [x] Delete transitional SDK provider command implementation after extraction.
- [x] Keep provider setup flow independent from CLI prompt rendering and SDK session orchestration internals.

### Context and Compact API

- [x] Define context usage read APIs that `/context` and auto-compact descriptors can consume.
- [x] Define compact execution APIs with lifecycle metadata that drives normal blocking command state.
- [x] Define auto-compact threshold and enabled-state APIs without embedding them in CLI-only state.
- [ ] Ensure manual `/compact` and auto-triggered compact use the same command execution pipeline.

### Session and Checkpoint APIs

- [ ] Define command-facing session APIs for clear, rename, resume, reset, and history state reads.
- [ ] Define checkpoint/rewind APIs without exposing session internals.
- [ ] Move `/clear`, `/rename`, `/resume`, `/reset`, and `/rewind` into command modules that consume these APIs.

### Settings APIs

- [ ] Define command-facing model, mode, language, permission, and statusline settings APIs.
- [ ] Return restart-required effects where host restart is needed.
- [ ] Remove direct settings mutation from CLI command branches.
- [ ] Move `/model`, `/mode`, `/language`, `/permissions`, and `/statusline` into command modules.

### Runtime APIs

- [ ] Define command-facing memory and background-task APIs.
- [ ] Move `/memory` and `/background` into command modules.
- [ ] Ensure background commands are non-blocking only when lifecycle metadata explicitly declares them background.

### Plugin and Help APIs

- [ ] Define plugin command adapter APIs without giving command modules direct access to CLI plugin UI internals.
- [ ] Move `/plugin` and `/reload-plugins` into command modules or a plugin-command package.
- [ ] Generate `/help` output from registered command descriptors.
- [ ] Ensure `/agent` keeps using the same command API and does not need special CLI routing.

## Package Extraction Plan

- [ ] Create one command package for each command owner group rather than keeping feature behavior in SDK.
- [ ] Prefer grouped packages only when the group shares one cohesive domain API, such as session commands.
- [ ] Do not create pass-through packages that only re-export SDK types.
- [ ] Do not add compatibility shims for old SDK-embedded command files.
- [ ] Remove legacy command implementations in the same PR that introduces the replacement command packages.
- [ ] Add public exports only from owner packages and avoid duplicate type definitions across packages.

## Migration Sequence

1. [ ] Create `agent-sdk/src/command-api/` and move generic command contracts, effects, interactions, lifecycle metadata, and host context contracts into it.
2. [ ] Refactor command execution so all built-ins execute through the same registry, descriptor, lifecycle, interaction, and effect pipeline.
3. [x] Extract provider common APIs into `agent-sdk/src/command-api/provider/`.
4. [x] Create `agent-command-provider` and delete transitional SDK provider command implementation.
5. [x] Extract context/compact APIs and migrate `/context` and `/compact`.
6. [ ] Extract settings APIs and migrate `/model`, `/mode`, `/language`, `/permissions`, and `/statusline`.
7. [ ] Extract session/checkpoint APIs and migrate `/clear`, `/rename`, `/resume`, `/reset`, and `/rewind`.
8. [ ] Extract runtime APIs and migrate `/memory` and `/background`.
9. [ ] Extract plugin/help APIs and migrate `/plugin`, `/reload-plugins`, `/help`, and `/exit`.
10. [ ] Remove all CLI command-specific switch branches that are no longer pure slash parsing or host effect projection.
11. [ ] Remove duplicate built-in command metadata sources after descriptor parity tests pass.
12. [ ] Run full repository verification and publish-readiness checks.

## Relationship To Existing Backlog

This item is the foundation for the command-specific migration backlog:

- `.agents/tasks/completed/command-migration-provider.md`
- `command-migration-compact.md`
- `command-migration-context.md`
- `.agents/tasks/completed/command-migration-model.md`
- `.agents/tasks/completed/command-migration-mode.md`
- `command-migration-language.md`
- `command-migration-permissions.md`
- `command-migration-statusline.md`
- `command-migration-clear.md`
- `command-migration-rename.md`
- `command-migration-resume.md`
- `command-migration-reset.md`
- `command-migration-rewind.md`
- `command-migration-memory.md`
- `command-migration-background.md`
- `command-migration-plugin.md`
- `command-migration-reload-plugins.md`
- `command-migration-help.md`
- `command-migration-exit.md`
- `command-migration-agent.md`

The command-specific backlog items should not be treated as later cleanup. They are the execution slices for this API-layer migration.

## Acceptance Criteria

- [ ] `agent-sdk` exposes a documented command API layer for contracts, lifecycle, interactions, effects, host context, and command-facing ports.
- [ ] Every built-in command implementation lives in an `agent-command-*` package or a clearly owned command-module package outside SDK/CLI.
- [ ] `agent-sdk` contains no feature-specific built-in command implementation files.
- [ ] `agent-cli` contains no command-specific setup flows, provider profile mutation, command metadata ownership, or semantic command switch branches.
- [ ] Help, autocomplete, and model-invocable command descriptors are derived from registered command modules.
- [ ] Manual `/compact`, auto-compact, and other blocking commands use the same visible command execution lifecycle.
- [ ] Settings-changing commands return typed effects or use typed adapters rather than mutating CLI files directly.
- [ ] Harness checks block regressions across SDK, command packages, and CLI/TUI.
- [ ] Package specs document the final layering, not transitional compatibility.

## Test Plan

- Add SDK command API contract tests for descriptors, lifecycle metadata, interactions, effects, and host context capability declaration.
- Add command registry tests proving descriptors and execution handlers come from the same module owner.
- Add per-command package tests for provider, compact/context, settings, session/checkpoint, runtime, plugin/help, and process-control commands.
- Add CLI integration tests proving slash input resolves through registered modules and TUI hooks only render generic interactions/effects.
- Add model-invocable command tests proving only explicitly safe descriptors are exposed.
- Add harness tests that reject SDK imports from command packages, command-package imports from SDK, CLI imports from command packages, and command-specific state in TUI hooks.
- Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, targeted package tests, and `pnpm harness:scan`.

## Promotion Path

1. Move this file to `.agents/tasks/sdk-command-common-api-layer.md`.
2. Treat the full target structure as the implementation target; do not create a legacy-preservation phase.
3. Implement the SDK command API foundation first, then migrate command packages in the sequence above.
4. Close this task only after SDK/CLI no longer own feature command behavior and all command-specific backlog items are completed or superseded by the implemented package split.
