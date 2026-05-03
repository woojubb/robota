# SDK Built-in Command Layering

## What

Migrate Robota slash-command behavior into built-in command modules that are injected by product composition roots, with the SDK responsible for command contracts/common APIs and the CLI responsible only for slash parsing, TUI lifecycle, and host-specific adapters.

## Why

Many commands currently look like built-ins to users, but their metadata and execution are split across separate hardcoded paths. This makes behavior inconsistent, causes lifecycle gaps such as `/compact` not entering the normal running state, and makes it unclear which package owns command semantics.

The command layer should have one source of truth:

- command metadata and descriptors;
- command execution handlers;
- model-invocable policy;
- user-invocable slash behavior;
- blocking/background lifecycle policy;
- host-specific side-effect requirements.

## Original Signals

- `packages/agent-sdk/src/commands/system-command.ts` no longer owns user-visible command execution; `/help` moved to `@robota-sdk/agent-command-help`.
- `packages/agent-sdk/src/commands/builtin-source.ts` owns built-in command palette metadata separately from execution.
- `packages/agent-cli/src/commands/slash-executor.ts` hardcoded several command behaviors and returned `handled: false` for others so a later path could execute them.
- `.agents/specs/agent-invocation-router.md` already states that built-in command modules should be injected by composition roots and should own their descriptors.
- Extracted command packages such as `agent-command-statusline` show that command modules can package system commands for injection without living in the CLI.

## Desired Layering

### SDK Core

SDK core should own the generic command contracts, common APIs, and executor:

- `ICommandModule`
- `ISystemCommand`
- command descriptors
- model-invocable filtering
- command result shape;
- execution lifecycle metadata such as blocking, background, write, process, and interactive-host requirements;
- reusable command-facing APIs/ports such as provider settings/profile helpers.

SDK core should not own CLI rendering, key handling, process exit, direct user settings file mutation, or product/domain command flows that can be implemented by a command module.

### Command Modules

Each built-in command should live in an owner module that provides both metadata and behavior. Built-in means the product composes the module by default, not that the implementation lives in SDK core.

Examples:

- context/compact command module;
- rewind command module;
- memory command module;
- background task command module;
- provider profile command module;
- session resume/rename command module;
- permissions/mode command module;
- language/model command module;
- plugin command module;
- statusline command module.

Modules may be default-composed or optional product modules. They should consume SDK command contracts and common APIs the same way a third-party command package would.

### CLI Layer

The CLI should own only:

- slash-prefix parsing and input routing;
- TUI busy/thinking/progress projection;
- picker/modal rendering;
- process exit/restart;
- filesystem-backed host adapters for CLI settings;
- displaying command results.

The CLI should not duplicate command semantics in a switch statement when a command module can own the behavior.

## Research Required

Before implementation, inventory existing commands and classify each one:

- SDK-default built-in command;
- CLI-host built-in command;
- optional command module;
- skill/plugin command;
- model-invocable command;
- user-only command;
- blocking foreground command;
- background command;
- command that requires host adapters.

Research questions:

- Should `BuiltinCommandSource` be generated from registered executable commands instead of maintained separately?
- Should all user-visible built-ins implement `ISystemCommand`, or should host-only commands use a parallel host command interface?
- How should command lifecycle metadata drive `Thinking`, input blocking, cancellation, and queued input?
- How should commands declare required adapters such as settings I/O, provider switching, session picker, plugin registry, restart, and exit?
- Which commands should be model-invocable, and which must remain user-only for safety?
- How should command modules expose nested subcommands without duplicating autocomplete metadata?

## Recommended Migration Plan

1. **Inventory and classification**
   - Build a command matrix from `BuiltinCommandSource`, `createSystemCommands()`, `executeSlashCommand()`, plugin command handlers, and CLI command modules.
   - Mark owner package, execution path, metadata source, lifecycle policy, and host adapter needs.

2. **Define SDK common APIs**
   - Keep generic command contracts, executors, lifecycle metadata, and reusable command-facing APIs in SDK.
   - Move provider settings/profile helpers into explicit SDK common APIs when command modules need them.
   - Keep concrete host I/O behind adapter interfaces supplied by composition roots.

3. **Unify metadata and execution**
   - Extend the command/module contract so command metadata, descriptors, subcommands, and execution live together.
   - Derive autocomplete and help output from registered commands.
   - Remove separate hardcoded command lists once parity tests pass.

4. **Move hardcoded CLI commands into modules**
   - Migrate direct CLI handlers such as `help`, `clear`, `mode`, `model`, `language`, `cost`, `permissions`, and `context` to registered command modules.
   - Keep host-specific side effects behind adapters instead of embedding them in SDK core.

5. **Normalize command lifecycle**
   - Add lifecycle metadata so blocking commands enter the same running state as prompts.
   - Ensure `/compact` and other model-backed commands block or queue input consistently.
   - Ensure background commands stay non-blocking only when explicitly declared as background.

6. **Retire the CLI switch as the command owner**
   - Replace `executeSlashCommand` command-specific behavior with generic lookup, adapter injection, and result projection.
   - Keep only slash parsing, dynamic skill/plugin fallback, and unknown-command handling in the CLI layer.

7. **Expand model-invocable command support**
   - Expose only explicitly safe registered commands to the model command tool.
   - Ensure model-invocable execution uses the same handler as slash input.

## Non-Goals

- Do not move TUI rendering or key handling into SDK core.
- Do not make every built-in command model-invocable.
- Do not keep duplicate command metadata lists after the migration is complete.
- Do not introduce natural-language pre-routing before the model sees prompts.
- Do not treat generated API documentation as the source for command behavior.
- Do not treat SDK-embedded legacy commands as precedent for new built-in command implementations.

## Acceptance Criteria

- [x] A command inventory exists for every current built-in slash command.
- [x] Each command has a single owner module for metadata and execution.
- [x] Autocomplete/help descriptors are derived from registered command modules.
- [x] CLI hardcoded command behavior is removed or reduced to host-only adapters.
- [x] Blocking commands share the normal prompt execution lifecycle.
- [x] Host-only commands explicitly declare required adapters.
- [x] Model-invocable commands use the same registered handlers as user slash input.
- [x] Tests prevent adding built-in command metadata without an executable command owner.
- [x] Tests prevent command-specific provider/setup state from returning to CLI/TUI hooks.

## Test Plan

- Add contract tests that every registered built-in command has metadata, execution, and lifecycle policy.
- Add CLI slash-routing tests proving user input resolves through the command registry rather than command-specific switch cases.
- Add command descriptor tests proving autocomplete/help/model-visible descriptors are derived from the same registered modules.
- Add lifecycle tests for blocking, background, and host-only commands.
- Add parity tests comparing the old command inventory to the new registered module inventory during migration.

## Promotion Path

Completed in `feat/command-layering-finalize`.

## Result

- Added `.agents/specs/command-inventory.md` as the command ownership, lifecycle, model-invocation,
  and host-adapter inventory.
- Removed the legacy CLI `slash-executor.ts` command switch and its test suite.
- Removed the legacy CLI-local `PluginCommandSource` copy; plugin command discovery now uses the
  SDK-owned source only.
- Kept CLI slash routing on `session.executeCommand(name, args)` with generic skill/plugin fallback.
- Added harness checks that fail if legacy CLI command-source files or command-specific router
  branches return.
- Fixed the binary entrypoint so the default `/agent` module is composed once by `startCli()`.
