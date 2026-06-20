# PRESET-006: 프리셋 발견/관리 UX (/preset + TUI 표시) — Task Breakdown

Spec: `.agents/spec-docs/done/PRESET-006-preset-discovery-ux.md`

## Plan

- [x] TC-01: `/preset` output lists every `listPresets()` id + marks the active one
- [x] TC-02: `/preset <id>` switches active preset (drives `applyPresetToSession` → set active/permission/model/persona)
- [x] TC-03: TUI status bar shows the active preset id (hidden when 'default'/unset)
- [x] TC-04: `/preset __nope__` → rejection with available ids, no switch
- [x] TC-05: agent-command + agent-transport build + `pnpm typecheck` exit 0
- [x] `createPresetCommandModule()` (agent-command) mirroring mode command; registered in default modules
- [x] agent-command → agent-preset dependency (one-way; dependency-direction check passes)
- [x] TUI `PresetText` in StatusBar/SessionStatusBar + App.tsx active-preset extraction

## Test Plan

User-facing `/preset` discovery + live switch + TUI active display, built on PRESET-011..014.
`/preset` (no args) lists presets with an active marker (read via `getActivePresetId`); `/preset <id>`
validates via `getPreset`, then `resolvePreset(id)` → `applyPresetToSession` (live permission/model/
effort/persona re-apply); unknown id is rejected with the available list (no switch). The TUI status bar
renders the active preset id when non-default (mirrors the `Mode:` display). Verified by agent-command
command-module integration tests (list+marker, switch, reject), agent-transport status-bar render tests,
monorepo typecheck/build, and `harness:scan` (incl. one-way dependency-direction for the new
agent-command → agent-preset edge). Module/execution-capability switching is deferred to PRESET-015.
