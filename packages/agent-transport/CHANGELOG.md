# @robota-sdk/agent-transport

## 3.0.0-beta.78

### Patch Changes

- Updated dependencies [6f308d1]
  - @robota-sdk/agent-core@3.0.0-beta.78
  - @robota-sdk/agent-framework@3.0.0-beta.78
  - @robota-sdk/agent-interface-transport@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.77
  - @robota-sdk/agent-framework@3.0.0-beta.77
  - @robota-sdk/agent-interface-transport@3.0.0-beta.77

## 3.0.0-beta.76

### Minor Changes

- 9df3a88: Split the consolidated `@robota-sdk/agent-transport` package into per-concern transport packages (DQ-AUDIT-005) so unrelated heavy dependencies (React/Ink, ws, Hono, MCP SDK) no longer share one publishable unit and are not dragged into non-TUI consumers' graphs:

  - `@robota-sdk/agent-transport` — lean core: headless adapter + `TransportRegistry` + scripted-provider testing fixtures (no external runtime deps).
  - `@robota-sdk/agent-transport-tui` — React + Ink terminal UI.
  - `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol (`agent-web-ui` now depends only on this for WS types).
  - `@robota-sdk/agent-transport-http` — Hono HTTP transport.
  - `@robota-sdk/agent-transport-mcp` — MCP server transport.

  The default transport-registry wiring (pre-registering `WsTransport`) moves to the CLI composition root, removing the core→ws edge.

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `TContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- c0a6287: Relocate session feature logic out of the CLI shell and the transport (DQ-AUDIT-004):

  - Extract session-log timing analysis into the new `@robota-sdk/agent-session-analytics` package (pure analysis over canonical session records — no duplicate types, no file I/O). `agent-cli`'s `session analyze` command shrinks to thin wiring and loads records via the new `createUserSessionStore()` / existing `createProjectSessionStore()` framework facades.
  - Move LLM-based session auto-naming (`generateSessionName`) from `agent-transport/tui` into `agent-framework` (session-lifecycle owner); the TUI transport now invokes it through the framework.

- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76

## 3.0.0-beta.75

### Patch Changes

- Agent preset system + live preset switching + context/history correctness fixes.

  - **Preset system (PRESET-001~017):** new `@robota-sdk/agent-preset` package layering framework
    assembly options into named, selectable profiles (`default`, `autonomous-builder`, `careful-reviewer`,
    `neutral-executor`) plus user-authored external presets loaded from `~/.robota/presets/*.json`.
  - **Live preset switching:** `/preset` command (list + active marker + switch) and a TUI active-preset
    display. Switching live re-applies permission posture, model/effort, persona, command-module
    selection, parallel-subagents gating, and a self-verification system-prompt section via the single
    `applyPresetToSession` engine.
  - **CTX-001:** the TUI Context display + session auto-compact now use the accurate provider-based token
    estimate (system prompt + tool schemas included) instead of a crude history-only char heuristic.
  - **HIST-001:** conversation history is now append-only — removed the silent 100-message count cap that
    could drop early context; context size is managed solely by size-based compaction.

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.75
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-interface-transport@3.0.0-beta.75
  - @robota-sdk/agent-interface-tui@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.74
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-interface-transport@3.0.0-beta.74
  - @robota-sdk/agent-interface-tui@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- d4fd33f: TUI input area UX: remove side borders and status bar box (SCREEN-001), move status bar below input area (SCREEN-002), fix top border corner characters.
  - @robota-sdk/agent-core@3.0.0-beta.73
  - @robota-sdk/agent-framework@3.0.0-beta.73
  - @robota-sdk/agent-interface-transport@3.0.0-beta.73
  - @robota-sdk/agent-interface-tui@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Revert Korean IME blank line to normal flow so it persists after session switch (AppInner remount).
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.72
  - @robota-sdk/agent-core@3.0.0-beta.72
  - @robota-sdk/agent-interface-transport@3.0.0-beta.72
  - @robota-sdk/agent-interface-tui@3.0.0-beta.72

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
