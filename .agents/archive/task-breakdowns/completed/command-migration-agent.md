# Command Migration: `/agent`

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/command-agent-composition
- **Scope**: packages/agent-cli, packages/agent-command-agent, .agents

## Objective

Finish `/agent` migration hardening by ensuring the Robota CLI product composition injects
`@robota-sdk/agent-command-agent` as the command owner while SDK and reusable TUI layers stay
generic.

## Checklist

- [x] Confirm `/agent` implementation already lives in `@robota-sdk/agent-command-agent`.
- [x] Confirm SDK does not import the command implementation package.
- [x] Compose `createAgentCommandModule()` in the CLI default command module list.
- [x] Add regression coverage proving default CLI commands expose `/agent`.
- [x] Update docs/backlog state.
- [x] Run targeted verification and command layering scan.
- [x] Create PR and merge into `develop`.

## Progress

### 2026-05-03

- Created task record and branch.
- Audited current ownership: `agent-command-agent` owns metadata/execution and SDK has no implementation import.
- Found the missing product wiring: `agent-cli` depends on `agent-command-agent` but does not compose `createAgentCommandModule()` by default.
- Composed `createAgentCommandModule()` in `agent-cli` default command modules.
- Added headless `/help` regression coverage proving `/agent` appears in the default product command list.

## Decision

Use product composition only. The CLI entrypoint may import the command module to assemble the
default Robota product, while SDK and reusable TUI code continue to consume generic command module
contracts and remain free of `/agent` special-casing.

## Test Plan

Run `@robota-sdk/agent-command-agent` tests, targeted CLI headless command exposure tests, CLI
typecheck/build, and `pnpm harness:scan:commands`.

## Result

Completed. `/agent` remains owned by `@robota-sdk/agent-command-agent`, and the Robota CLI product composition now includes it by default without SDK or reusable TUI special-casing.
