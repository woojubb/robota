# CLI `@file` Reference Import

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: feat/cli-at-file-reference-import
- **Scope**: packages/agent-sdk, packages/agent-cli, command/context packages as needed

## Objective

Add SDK-owned `@file` reference import support so CLI prompts can include local file references without
making the TUI own parsing, path resolution, or context-loading semantics.

## Plan

- [x] Research existing prompt/context ingestion and command boundaries.
- [x] Update owning specs before implementation.
- [x] Add failing unit tests for parsing, resolution, diagnostics, and integration behavior.
- [x] Implement SDK-owned resolver and thin CLI/command wiring.
- [x] Update docs and architecture notes.
- [x] Run targeted verification and repository checks.
- [x] Move backlog/task records to completed.

## Test List

- [x] `@AGENTS.md` resolves from the documented project base directory.
- [x] `@path/to/file.md` resolves with structured source metadata.
- [x] Missing files return structured diagnostics.
- [x] Oversize references are rejected before loading into context.
- [x] Nested/circular references are bounded by explicit recursion policy.
- [x] CLI prompt ingestion delegates parsing/loading to SDK-owned code.

## Progress

### 2026-05-05

- Started task from backlog and selected `@file` import as the prerequisite for `/context` inventory.
- Added SDK-owned prompt file-reference resolver, formatter, diagnostics, and structured history records.
- Integrated prompt preprocessing into `InteractiveSession.submit()` without adding CLI/TUI parsing.
- Updated SDK/CLI specs, README content, and `ARCHITECTURE-MAP.md`.
- Split parser/path helpers out of the resolver so new source files stay under the 300-line file-size rule.
- Verified SDK tests, SDK typecheck/build/lint, docs build, root typecheck/build, formatting, diff whitespace, and harness scan.

## Decisions

- Treat CLI as a thin host adapter. SDK or a command package owns reference parsing and diagnostics.
- Implement file-only prompt references now; directory listings and MCP resource mentions remain out of scope.
- Resolve relative paths against session `cwd` and reject paths outside that workspace root.

## Blockers

- None.

## Result

Implemented SDK-owned `@file` prompt reference preprocessing. Ordinary CLI prompts pass through
unchanged to `InteractiveSession.submit()`, where SDK code reads bounded workspace-local file
references, records structured history metadata, and sends enriched model input.
