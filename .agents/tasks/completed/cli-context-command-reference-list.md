# CLI `/context` Reference Inventory

- **Status**: completed
- **Created**: 2026-05-05
- **Branch**: feat/cli-context-reference-inventory
- **Scope**: packages/agent-sdk, packages/agent-command-context, packages/agent-cli docs

## Objective

Extend `/context` so users can inspect and manage file references loaded through manual context
commands and prompt `@file` references while preserving the CLI-as-thin-renderer boundary.

## Plan

- [x] Research comparable context-management behavior and current command boundaries.
- [x] Update command/API specs before implementation.
- [x] Add failing tests for `/context list/add/remove/clear` and SDK inventory integration.
- [x] Implement SDK-owned context reference inventory and command common APIs.
- [x] Integrate `@file` prompt references with the inventory.
- [x] Update package docs and architecture notes.
- [x] Run targeted and repository verification.
- [x] Move backlog/task records to completed.

## Progress

### 2026-05-05

- Selected SDK-owned context reference inventory as the implementation boundary.
- Added command common APIs for listing, adding, removing, and clearing context references.
- Integrated manual `/context add` references with prompt-time model input.
- Registered prompt `@file` references as observed context references.
- Updated SDK, CLI, command, and session docs/specs.
- Split resolver and persistence helpers so new SDK files stay under the file-size rule.
- Verified targeted package checks, root typecheck/build, docs build, diff whitespace, and harness scan.

## Decisions

- Keep `agent-command-context` as the command parser/formatter only.
- Keep file path resolution, workspace bounds, and manual context state in `agent-sdk`.
- Treat prompt `@file` references as observed session references. Treat `/context add` references as
  active references that are included in future prompt model input.
- Use byte/reference budgets as the first eviction policy; token-specific LRU can build on this
  inventory later when exact token accounting is available for arbitrary files.

## Research Notes

- Comparable CLIs expose both context usage and explicit file add/remove workflows.
- The current Robota `/context` command already owns auto-compact controls through SDK common APIs,
  so extending that same common API layer is the narrowest boundary-preserving path.

## Test Plan

- `pnpm --filter @robota-sdk/agent-command-context test`
- `pnpm --filter @robota-sdk/agent-command-context typecheck`
- `pnpm --filter @robota-sdk/agent-sdk test -- context-command-api interactive-session`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm harness:scan`

## Blockers

- None.

## Result

Implemented `/context` reference inventory through SDK-owned state and command common APIs. Manual
references added with `/context add` are active and injected into future prompts; prompt `@file`
references are recorded as observed references for inspection through `/context` and `/context list`.
