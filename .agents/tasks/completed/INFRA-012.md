---
title: Migrate agent-transport interface-type imports to agent-interface-transport (INFRA-010 L2)
status: in-progress
priority: high
created: 2026-06-14
spec: .agents/spec-docs/todo/INFRA-012-migrate-transport-interface-imports.md
packages:
  - agent-transport
---

# INFRA-012 — agent-transport interface-type import migration (L2)

Repoint `agent-transport`'s **type** imports of the moved closure from `@robota-sdk/agent-framework`
to `@robota-sdk/agent-interface-transport`. Runtime-value imports and `TInteractiveSessionOptions`
stay imported from `@robota-sdk/agent-framework`. See spec for the full moved-type / retained-set lists.

## Tasks

- [x] **TC-01** — In every `packages/agent-transport/src/**` file, split each
      `@robota-sdk/agent-framework` import so that moved interface types (e.g. `IInteractiveSession`,
      `ICommand`, `ICommandResult`, `ICommandListEntry`, `ICommandPluginAdapter`, `ICommandInteraction`,
      `IToolState`, `IUsageSnapshot`, `TPermissionResultValue`, `IInteractionChannel`, `IActionRequest`,
      `IExecutionWorkspaceEntry`/`*Snapshot`/`*Filter`, `IInteractiveSessionStore`,
      `IResumableSessionSummary`, `TCommandEffect`, `IExecutionResult`, and the rest of the L1 closure)
      are imported via `import type { … } from '@robota-sdk/agent-interface-transport'`.
      Verify: `rg` over `agent-transport/src` shows the moved types sourced from
      `agent-interface-transport`, not `agent-framework`.
- [x] **TC-02** — Keep runtime values (`InteractiveSession`, `CommandRegistry`, `readSettings`,
      `writeSettings`, `getUserSettingsPath`, `createProjectSessionStore`, `tokeniseSlashCommand`,
      `isSlashCommand`, `isStatusLineCommandSettingsPatch`, `listResumableSessionSummaries`,
      `DEFAULT_STATUS_LINE_COMMAND_SETTINGS`) and the type `TInteractiveSessionOptions` imported from
      `@robota-sdk/agent-framework`. Verify these still resolve (re-export intact) via
      `pnpm --filter @robota-sdk/agent-transport typecheck`.
- [x] **TC-03** — Run the full green gate for affected packages: `pnpm build`, `pnpm typecheck`,
      `pnpm test`, plus `node scripts/harness/check-dependency-direction.mjs` and
      `pnpm harness:conformance` — all exit 0.

## Test Plan

Verification maps 1:1 to the spec's Completion Criteria and Test Plan rows:

- **TC-01** — Command-form check: `rg` over `packages/agent-transport/src` confirms moved interface
  types are imported from `@robota-sdk/agent-interface-transport` and no longer from
  `@robota-sdk/agent-framework`. No moved type may remain pointed at framework.
- **TC-02** — Build/typecheck assertion: `pnpm --filter @robota-sdk/agent-transport typecheck` proves
  runtime values + `TInteractiveSessionOptions` still resolve from `@robota-sdk/agent-framework`
  (re-export boundary intact, nothing broken by the split).
- **TC-03** — CI smoke + dependency gate: `pnpm build`, `pnpm typecheck`, `pnpm test` for affected
  packages all pass; `node scripts/harness/check-dependency-direction.mjs` and
  `pnpm harness:conformance` both exit 0, confirming dep-direction and architecture conformance stay green.
