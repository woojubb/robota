# @robota-sdk/agent-preset

## 3.0.0-beta.78

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.78

## 3.0.0-beta.77

### Patch Changes

- @robota-sdk/agent-framework@3.0.0-beta.77

## 3.0.0-beta.76

### Patch Changes

- Updated dependencies [c0a6287]
- Updated dependencies [9df3a88]
- Updated dependencies [576af62]
  - @robota-sdk/agent-framework@3.0.0-beta.76

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
