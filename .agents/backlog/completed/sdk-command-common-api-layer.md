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
  agent-command-reset/
  agent-command-session/
  agent-command-plugin/
  agent-command-statusline/
  agent-cli/
```

`packages/agent-sdk/src/commands/` should become registry/executor infrastructure only. Feature command implementation files under SDK should be removed, not kept as compatibility aliases.

## API Responsibilities

### Generic Command Contracts

- [x] Define one public command module contract for user-visible commands.
- [x] Define one command descriptor contract used by slash autocomplete, `/help`, model-invocable command exposure, and documentation.
- [x] Define lifecycle metadata for blocking, background, write, process-control, interactive, restart-required, and host-adapter requirements.
- [x] Define result contracts for success, failure, warnings, structured display payloads, queued follow-up work, typed interactions, and typed effects.
- [x] Remove duplicate descriptor lists once all command metadata is derived from registered command modules.

### Command Host Context

- [x] Introduce a narrow `ICommandHostContext` or equivalent facade passed to command modules.
- [x] Do not pass `InteractiveSession`, React state, CLI settings files, provider factories, or TUI hooks directly to command modules.
- [x] Split host context into focused sub-facades so commands depend only on the capabilities they declare.
- [x] Add tests proving commands can be executed through the host context without importing `agent-cli`.

### Host Adapter Contracts

- [x] Define SDK-owned adapter interfaces for settings reads/writes, process restart/exit, session picking, statusline patching, plugin UI actions, provider creation, and local environment access.
- [x] Ensure `agent-cli` implements adapters at the composition root.
- [x] Ensure command packages receive adapters only through SDK command execution context.
- [x] Add harness checks that block command packages from importing CLI/TUI code.

### Interaction and Effect Contracts

- [x] Keep all command prompts generic, typed, and render-agnostic.
- [x] Keep all command side effects typed and host-applied.
- [x] Remove command-specific interaction state machines from TUI hooks.
- [x] Add parity tests for provider setup, compact progress, model restart, statusline patch, plugin actions, and exit/restart effects.

### Provider Common API

- [x] Move provider env-ref, provider settings document, profile merge/validation, setup-flow primitives, and provider probe contracts under `agent-sdk/src/command-api/provider/`.
- [x] Extract `/provider` behavior into `agent-command-provider`.
- [x] Delete transitional SDK provider command implementation after extraction.
- [x] Keep provider setup flow independent from CLI prompt rendering and SDK session orchestration internals.

### Context and Compact API

- [x] Define context usage read APIs that `/context` and auto-compact descriptors can consume.
- [x] Define compact execution APIs with lifecycle metadata that drives normal blocking command state.
- [x] Define auto-compact threshold and enabled-state APIs without embedding them in CLI-only state.
- [x] Ensure manual `/compact` and auto-triggered compact use the same command execution pipeline.

### Session and Checkpoint APIs

- [x] Define command-facing session APIs for clear, rename, resume, cost, reset, and history state reads.
  - [x] Clear-history facade and host-rendered history-clear effect are available.
  - [x] Session-name parsing and host-rendered rename effect helpers are available.
  - [x] Session-picker request effect helper is available.
- [x] Session-info read helper is available for `/cost`.
- [x] Session-exit request effect helper is available for `/exit`.
- [x] Define checkpoint/rewind APIs without exposing session internals.
- [x] Move `/clear`, `/rename`, `/resume`, `/reset`, and `/rewind` into command modules that consume these APIs.

### Settings APIs

- [x] Define command-facing model, mode, language, permission, and statusline settings APIs.
- [x] Return restart-required effects where host restart is needed.
- [x] Remove direct settings mutation from CLI command branches.
- [x] Move `/model`, `/mode`, `/language`, `/permissions`, and `/statusline` into command modules.

### Runtime APIs

- [x] Define command-facing memory APIs.
- [x] Define command-facing background-task APIs.
- [x] Move `/memory` into a command module.
- [x] Move `/background` into a command module.
- [x] Ensure background commands are non-blocking only when lifecycle metadata explicitly declares them background.

### Plugin and Help APIs

- [x] Define plugin command adapter APIs without giving command modules direct access to CLI plugin UI internals.
- [x] Move `/plugin` and `/reload-plugins` into command modules or a plugin-command package.
  - [x] `/plugin` migrated to `agent-command-plugin`.
  - [x] `/reload-plugins` migrated to `agent-command-plugin`.
- [x] Generate `/help` output from registered command descriptors.
- [x] Ensure `/agent` keeps using the same command API and does not need special CLI routing.

## Package Extraction Plan

- [x] Create one command package for each command owner group rather than keeping feature behavior in SDK.
- [x] Prefer grouped packages only when the group shares one cohesive domain API, such as session commands.
- [x] Do not create pass-through packages that only re-export SDK types.
- [x] Do not add compatibility shims for old SDK-embedded command files.
- [x] Remove legacy command implementations in the same PR that introduces the replacement command packages.
- [x] Add public exports only from owner packages and avoid duplicate type definitions across packages.

## Migration Sequence

1. [x] Create `agent-sdk/src/command-api/` and move generic command contracts, effects, interactions, lifecycle metadata, and host context contracts into it.
2. [x] Refactor command execution so all built-ins execute through the same registry, descriptor, lifecycle, interaction, and effect pipeline.
3. [x] Extract provider common APIs into `agent-sdk/src/command-api/provider/`.
4. [x] Create `agent-command-provider` and delete transitional SDK provider command implementation.
5. [x] Extract context/compact APIs and migrate `/context` and `/compact`.
6. [x] Extract settings APIs and migrate `/model`, `/mode`, `/language`, `/permissions`, and `/statusline`.
7. [x] Extract session/checkpoint APIs and migrate `/clear`, `/rename`, `/resume`, `/reset`, and `/rewind`.

- [x] `/clear` migrated to `agent-command-session`.
- [x] `/rename` migrated to `agent-command-session`.
- [x] `/resume` migrated to `agent-command-session`.
- [x] `/reset` migrated to `agent-command-reset`.
- [x] `/rewind` migrated to `agent-command-rewind`.
- [x] `/memory` migrated to `agent-command-memory`.
- [x] `/exit` migrated to `agent-command-exit`.
- [x] `/plugin` migrated to `agent-command-plugin`.

8. [x] Extract runtime APIs and migrate `/memory` and `/background`.
9. [x] Extract plugin/help APIs and migrate `/plugin`, `/reload-plugins`, and `/help`.
   - [x] `/plugin` migrated to `agent-command-plugin`.
   - [x] `/reload-plugins` migrated to `agent-command-plugin`.
   - [x] `/help` migrated to `agent-command-help`.
10. [x] Remove all CLI command-specific switch branches that are no longer pure slash parsing or host effect projection.
11. [x] Remove duplicate built-in command metadata sources after descriptor parity tests pass.
12. [x] Run full repository verification and publish-readiness checks.

## Relationship To Existing Backlog

This item is the foundation for the command-specific migration backlog:

- `.agents/tasks/completed/command-migration-provider.md`
- `.agents/tasks/completed/command-migration-compact.md`
- `.agents/tasks/completed/command-migration-context.md`
- `.agents/tasks/completed/command-migration-model.md`
- `.agents/tasks/completed/command-migration-mode.md`
- `.agents/tasks/completed/command-migration-language.md`
- `.agents/tasks/completed/command-migration-permissions.md`
- `.agents/tasks/completed/command-migration-statusline.md`
- `.agents/tasks/completed/command-migration-clear.md`
- `.agents/tasks/completed/command-migration-rename.md`
- `.agents/tasks/completed/command-migration-resume.md`
- `.agents/tasks/completed/command-migration-cost.md`
- `.agents/tasks/completed/command-migration-reset.md`
- `.agents/tasks/completed/command-migration-rewind.md`
- `.agents/tasks/completed/command-migration-memory.md`
- `.agents/tasks/completed/command-migration-background.md`
- `.agents/tasks/completed/command-migration-exit.md`
- `.agents/tasks/completed/command-migration-plugin.md`
- `.agents/tasks/completed/command-migration-reload-plugins.md`
- `.agents/backlog/completed/command-migration-help.md`
- `.agents/backlog/completed/command-migration-agent.md`

The command-specific backlog items should not be treated as later cleanup. They are the execution slices for this API-layer migration.

## Acceptance Criteria

- [x] `agent-sdk` exposes a documented command API layer for contracts, lifecycle, interactions, effects, host context, and command-facing ports.
- [x] Every built-in command implementation lives in an `agent-command-*` package or a clearly owned command-module package outside SDK/CLI.
- [x] `agent-sdk` contains no feature-specific built-in command implementation files.
- [x] `agent-cli` contains no command-specific setup flows, provider profile mutation, command metadata ownership, or semantic command switch branches.
- [x] Help, autocomplete, and model-invocable command descriptors are derived from registered command modules.
- [x] Manual `/compact`, auto-compact, and other blocking commands use the same visible command execution lifecycle.
- [x] Settings-changing commands return typed effects or use typed adapters rather than mutating CLI files directly.
- [x] Harness checks block regressions across SDK, command packages, and CLI/TUI.
- [x] Package specs document the final layering, not transitional compatibility.

## Test Plan

- Add SDK command API contract tests for descriptors, lifecycle metadata, interactions, effects, and host context capability declaration.
- Add command registry tests proving descriptors and execution handlers come from the same module owner.
- Add per-command package tests for provider, compact/context, settings, session/checkpoint, runtime, plugin/help, and process-control commands.
- Add CLI integration tests proving slash input resolves through registered modules and TUI hooks only render generic interactions/effects.
- Add model-invocable command tests proving only explicitly safe descriptors are exposed.
- Add harness tests that reject SDK imports from command packages, command-package imports from SDK, CLI imports from command packages, and command-specific state in TUI hooks.
- Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, targeted package tests, and `pnpm harness:scan`.

## Promotion Path

Completed in `feat/sdk-command-common-api-finalize`.

## Result

- `agent-sdk/src/command-api/` now owns command contracts, lifecycle metadata, interactions,
  effects, host context, host adapters, and command-facing common APIs.
- User-visible built-ins are implemented in `agent-command-*` packages and selected by composition
  roots instead of SDK or CLI command switches.
- `agent-cli` composes command modules, renders generic interactions/effects, and applies host
  adapters without owning semantic command branches.
- `pnpm harness:scan:commands` mechanically guards SDK, CLI, and command-package layering.
