# CLI `@file` Reference Import

## Status

Completed.

## Priority

P2 - improves context-loading ergonomics for CLI users.

## Problem

Some AI coding CLIs support references such as `@AGENTS.md` or `@docs/spec.md` inside prompts or
markdown-like command input. The referenced file is resolved, read, and included in the active
context so users can compose work from settings, task files, backlog items, or specs without
manually pasting file contents.

`agent-cli` does not currently have a standard file-reference import path. Adding one would make
context-heavy workflows easier, but the implementation must not turn the CLI/TUI into the owner of
context parsing or file-loading semantics.

## Scope

- `packages/agent-sdk`
- `packages/agent-command-context` or another owning command package if user-visible command
  behavior is required
- `packages/agent-cli` only for thin host wiring and rendering

## Research Needed

- Review existing CLI prompt/context loading paths in `agent-sdk`, including project context, task
  context, and skill/plugin command expansion.
- Review how comparable tools define `@file` resolution rules, recursion limits, missing-file
  behavior, and display feedback.
- Decide whether `@file` imports are prompt-time context, command-managed context, or both.

## Constraints

- `agent-cli` must remain a renderer and host adapter provider.
- File-reference parsing, resolution, recursion control, and loaded-context records must be owned by
  SDK common APIs or a command package, not by Ink components or TUI hooks.
- The feature must not conflict with future mention-like syntaxes that also use `@`.
- Referenced files must be constrained to safe local file reads and must respect existing
  permissions/context policies.

## Recommended Direction

Create an SDK-owned file-reference resolver with a small explicit contract:

- parse `@path` tokens from prompt/context input;
- resolve relative paths against a documented base directory;
- prevent self-import and circular imports;
- enforce a maximum depth and maximum loaded bytes/tokens;
- return structured imported-context records and structured diagnostics.

Then compose that resolver through the context command or prompt ingestion path. The CLI should only
render diagnostics and pass user input to the SDK/command layer.

## Acceptance Criteria

- [ ] `@AGENTS.md` and `@path/to/file.md` references can be resolved from the documented base
      directory.
- [ ] Imported files are represented as structured context records with source path and import
      reason.
- [ ] Circular references and excessive nesting are rejected with clear diagnostics.
- [ ] Missing files produce a clear user-facing error without silently dropping the reference.
- [ ] The relative-path policy, recursion policy, size policy, and syntax are documented.
- [ ] CLI/TUI code does not own file-reference parsing or context loading semantics.

## Verification Plan

- Add unit tests for reference parsing and path resolution.
- Add unit tests for circular-reference and max-depth protection.
- Add unit tests for missing-file and oversize-file diagnostics.
- Add command or SDK integration tests proving imported files become structured context records.
- Run `pnpm --filter @robota-sdk/agent-sdk test` and the affected command/CLI package tests.
