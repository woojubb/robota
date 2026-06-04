# @robota-sdk/agent-transport

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-framework@3.0.0-beta.71
  - @robota-sdk/agent-interface-transport@3.0.0-beta.71
  - @robota-sdk/agent-interface-tui@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- CLI UX fixes: /context list full LLM context breakdown (CLI-B10), logo resize fix (CLI-B03), token estimates in context list (CLI-B04)
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.70
  - @robota-sdk/agent-core@3.0.0-beta.70
  - @robota-sdk/agent-interface-transport@3.0.0-beta.70
  - @robota-sdk/agent-interface-tui@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.69
  - @robota-sdk/agent-core@3.0.0-beta.69
  - @robota-sdk/agent-interface-transport@3.0.0-beta.69
  - @robota-sdk/agent-interface-tui@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- Wrap Korean IME spacer in Box position=absolute to reduce terminal cursor offset by 1 row, moving the IME candidate window closer to the input area.
  - @robota-sdk/agent-core@3.0.0-beta.68
  - @robota-sdk/agent-framework@3.0.0-beta.68
  - @robota-sdk/agent-interface-transport@3.0.0-beta.68
  - @robota-sdk/agent-interface-tui@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.67
  - @robota-sdk/agent-interface-tui@3.0.0-beta.67
  - @robota-sdk/agent-core@3.0.0-beta.67
  - @robota-sdk/agent-interface-transport@3.0.0-beta.67

## 3.0.0-beta.66

### Patch Changes

- refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules
  - CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
  - CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
  - Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.66
  - @robota-sdk/agent-core@3.0.0-beta.66
  - @robota-sdk/agent-interface-transport@3.0.0-beta.66

## 3.0.0-beta.65

### Minor Changes

- feat(CMD-003): TUI command interaction — picker/confirm overlay on missing args
  - Add `command-interaction.ts` with `ITuiPickerInteraction`, `ITuiConfirmInteraction`, `TAnyTuiCommandInteraction` types
  - Add `CommandPicker` and `CommandConfirm` Ink overlay components
  - Extend `TCommandSelectionResult` with `open-interaction` variant in input-area-flow
  - `resolveEnterCommandSelection` opens interaction overlay when command has `onMissingArgs` and no args typed
  - `InputArea` accepts `resolveInteraction` prop; renders picker/confirm overlay when active
  - Add `resolveInteraction` to `IRenderOptions` / `App` / `render`
  - Add `TUI_COMMAND_INTERACTIONS` registry in `agent-cli` with mode/language/provider/exit/clear interactions
  - Fix `SlashAutocomplete` to show technical command name (`cmd.name`) instead of `displayName`

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.65
- @robota-sdk/agent-framework@3.0.0-beta.65
- @robota-sdk/agent-interface-transport@3.0.0-beta.65

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
  - @robota-sdk/agent-interface-transport@3.0.0-beta.64
