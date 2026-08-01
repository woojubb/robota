# CLI TUI PTY E2E Harness

- **Status**: completed
- **Created**: 2026-04-30
- **Branch**: test/cli-tui-pty-e2e-harness
- **Scope**: packages/agent-cli

## Objective

Add a PTY-backed E2E harness for terminal UI prompt interactions without moving prompt semantics back into Ink components.

The harness must verify that TUI input is only transport for prompt values while provider setup meaning remains unit-tested in `provider-setup-flow`.

## Plan

- [x] Inspect existing agent-cli test setup and dependency constraints.
- [x] Add a small PTY harness for spawning Ink prompt drivers in tests.
- [x] Add E2E coverage for provider setup prompt input flow through a real pseudo terminal.
- [x] Keep prompt semantics covered by pure unit tests, not assertions over key meaning inside TUI.
- [x] Run affected tests, typecheck, build, and harness scan.

## Test Plan

Verify the new PTY E2E harness at three levels: targeted PTY tests prove the Ink provider prompt can render and accept terminal input through a real pseudo terminal; full `@robota-sdk/agent-cli` tests prove the new harness does not regress existing prompt-flow and TUI unit coverage; package typecheck, lint, build, and repository harness scan prove the changed test files and dependency metadata remain valid.

## Progress

### 2026-04-30

- Created task branch from updated `develop`.
- Added `node-pty` as an agent-cli dev dependency.
- Added a PTY driver and E2E test for provider setup prompt progression through a real pseudo terminal.
- Replaced `node-pty` with `@homebridge/node-pty-prebuilt-multiarch` after local `node-pty` PTY spawning failed with `posix_spawnp failed`.
- Fixed the PTY wait helper to re-check output on every terminal chunk and to reject timeouts cleanly.
- Passed targeted PTY E2E, full agent-cli tests, typecheck, lint, and build.

## Decisions

- TUI E2E should use a pseudo terminal, not plain `child_process.spawn`, because Ink behavior depends on TTY semantics.
- Provider setup semantics remain owned by `provider-setup-flow`; E2E only verifies terminal wiring and rendered prompt progression.
- Use `@homebridge/node-pty-prebuilt-multiarch` instead of `node-pty` because it provides the same PTY API and works in the current Node 24 local environment.

## Blockers

- `pnpm harness:scan` initially failed because this task document lacked a `Test Plan` section. The document was updated and scan was rerun.

## Result

Added a PTY-backed E2E harness for `ProviderSetupPrompt` that runs through a real pseudo terminal. The harness verifies OpenAI-compatible default submissions and Anthropic typed-value submissions while leaving prompt meaning and validation covered by existing unit tests. Verification passed for targeted PTY E2E, full `@robota-sdk/agent-cli` tests, typecheck, lint, build, and `pnpm harness:scan`.
