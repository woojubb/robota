---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-transport': minor
---

feat: add displayName and requiresPermission to command interfaces

- `ICommand`, `ISystemCommand`, `ICommandListEntry`: add optional `displayName` field for user-friendly labels
- `ISystemCommand`: add optional `requiresPermission` field for per-command permission policy declaration
- `SystemCommandExecutor`: add `resolveRequiresPermission()` — derives from `safety` when field is undefined
- All 24 built-in commands declare explicit `displayName` and `requiresPermission`
- TUI autocomplete renders `displayName ?? name`; Tab completion still inserts the technical command ID
- `/help` output shows `Display Name (/command-id)` format
