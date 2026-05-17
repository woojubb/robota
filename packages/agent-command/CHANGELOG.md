# @robota-sdk/agent-command

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.66
  - @robota-sdk/agent-core@3.0.0-beta.66

## 3.0.0-beta.65

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-framework@3.0.0-beta.65

## 3.0.0-beta.64

### Minor Changes

- feat: add displayName and requiresPermission to command interfaces
  - `ICommand`, `ISystemCommand`, `ICommandListEntry`: add optional `displayName` field for user-friendly labels
  - `ISystemCommand`: add optional `requiresPermission` field for per-command permission policy declaration
  - `SystemCommandExecutor`: add `resolveRequiresPermission()` — derives from `safety` when field is undefined
  - All 24 built-in commands declare explicit `displayName` and `requiresPermission`
  - TUI autocomplete renders `displayName ?? name`; Tab completion still inserts the technical command ID
  - `/help` output shows `Display Name (/command-id)` format

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.64
  - @robota-sdk/agent-core@3.0.0-beta.64
