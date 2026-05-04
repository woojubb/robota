# CLI Command Compatibility Shims Retirement

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: refactor/cli-command-shims-retirement
- **Scope**: packages/agent-cli, packages/agent-sdk, scripts/harness

## Objective

Remove public-looking CLI command compatibility shims so command infrastructure is imported from its owning SDK package. Keep only CLI-private host glue in `agent-cli` and update documentation and harness guards so the boundary does not regress.

## Plan

- [x] Audit current CLI command shim files, imports, tests, and docs.
- [x] Replace CLI shim imports with SDK-owned imports.
- [x] Decide and document `skill-executor.ts` ownership.
- [x] Remove re-export-only shim files and tests.
- [x] Add or update harness guards for forbidden CLI command shim surfaces.
- [x] Update `ARCHITECTURE-MAP.md`, package specs, and backlog records.
- [x] Run targeted verification and commit the completed work.

## Progress

### 2026-05-05

- Started from `develop` on `refactor/cli-command-shims-retirement`.
- Removed CLI command re-export shims and switched UI imports to SDK-owned command APIs.
- Moved command behavior tests from `agent-cli` to `agent-sdk`.
- Updated harness guard and CLI architecture/spec documentation for the removed compatibility surface.
- Verified targeted tests, affected package tests, typechecks, docs build, command scans, and root
  monorepo build.

## Decisions

- `skill-executor.ts` ownership is SDK-owned. The CLI should invoke skill execution through
  `InteractiveSession` and import common command APIs from `@robota-sdk/agent-sdk`.

## Test Plan

- Run moved SDK command tests for registry, built-in source, skill source, and skill execution.
- Run CLI input-area flow tests to verify slash autocomplete and command selection still consume
  SDK-owned command types correctly.
- Run command-layering harness tests and `pnpm harness:scan:commands` to prove the removed
  `agent-cli/src/commands` shim surface cannot return unnoticed.
- Run full affected package tests, typechecks, docs build, root monorepo build, and diff hygiene.

## Blockers

- (none)

## Result

Removed the `agent-cli/src/commands` compatibility surface and moved command behavior coverage to
the SDK owner package. CLI UI command palette code now consumes SDK-owned command contracts
directly, and command-layering harness coverage prevents new CLI command shim files from being
introduced unnoticed.
