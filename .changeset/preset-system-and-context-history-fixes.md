---
'@robota-sdk/agent-preset': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-cli': patch
---

Agent preset system + live preset switching + context/history correctness fixes.

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
