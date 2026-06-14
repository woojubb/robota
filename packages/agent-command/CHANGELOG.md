# @robota-sdk/agent-command

## 3.0.0-beta.76

### Patch Changes

- DQ-AUDIT-002 — consolidate duplicated domain data onto single owners: one model-pricing SSOT in agent-core (`MODEL_PRICES`/`lookupModelPrice`/`calculateModelCost`/`estimateBlendedCostPer1000`) consumed by agent-command and agent-plugin (drops two embedded/stale price tables); the `len/4` token estimator replaced by core `CONTEXT_ESTIMATE_CHARS_PER_TOKEN`; TUI `IContextState` derived from core `IContextWindowState`; dead pass-through re-exports removed from agent-session.
- 576af62: Fix `ConfigurationError: Agent must be fully initialized before changing model configuration` when running `/preset` (or any live model re-apply) on a fresh interactive session before the first message. The Robota agent initialized lazily on the first `run()`, but `setModel` requires full initialization. `Session.applyModelOptions` now awaits the new idempotent `Robota.ensureReady()` before `setModel`, and the preset live-switch path (`applyPresetToSession` → `executePresetCommand`) is async end-to-end. Adds a real cold-session regression test (no mocked Robota).
- Updated dependencies
- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies
- Updated dependencies
- Updated dependencies [576af62]
  - @robota-sdk/agent-core@3.0.0-beta.76
  - @robota-sdk/agent-framework@3.0.0-beta.76
  - @robota-sdk/agent-interface-transport@3.0.0-beta.76
  - @robota-sdk/agent-preset@3.0.0-beta.76

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
  - @robota-sdk/agent-preset@3.0.0-beta.75
  - @robota-sdk/agent-framework@3.0.0-beta.75
  - @robota-sdk/agent-core@3.0.0-beta.75
  - @robota-sdk/agent-interface-transport@3.0.0-beta.75

## 3.0.0-beta.74

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.74
  - @robota-sdk/agent-core@3.0.0-beta.74
  - @robota-sdk/agent-interface-transport@3.0.0-beta.74

## 3.0.0-beta.73

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.73
- @robota-sdk/agent-framework@3.0.0-beta.73

## 3.0.0-beta.72

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.72
  - @robota-sdk/agent-core@3.0.0-beta.72

## 3.0.0-beta.71

### Patch Changes

- fix(context): unify token estimation to single SSOT — status bar and /context list now use the same serialized JSON estimate
- Updated dependencies
  - @robota-sdk/agent-core@3.0.0-beta.71
  - @robota-sdk/agent-framework@3.0.0-beta.71

## 3.0.0-beta.70

### Patch Changes

- CLI UX fixes: /context list full LLM context breakdown (CLI-B10), logo resize fix (CLI-B03), token estimates in context list (CLI-B04)
- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.70
  - @robota-sdk/agent-core@3.0.0-beta.70

## 3.0.0-beta.69

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.69
  - @robota-sdk/agent-core@3.0.0-beta.69

## 3.0.0-beta.68

### Patch Changes

- @robota-sdk/agent-core@3.0.0-beta.68
- @robota-sdk/agent-framework@3.0.0-beta.68

## 3.0.0-beta.67

### Patch Changes

- Updated dependencies
  - @robota-sdk/agent-framework@3.0.0-beta.67
  - @robota-sdk/agent-core@3.0.0-beta.67

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
