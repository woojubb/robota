---
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-command': minor
---

ARCH-024 replaces framework knowledge of command-owner ids with optional, owner-declared semantic
roles. `ISystemCommand` can declare `skillActivation`, `contextReduction`, or `subagentSpawn`;
`SystemCommandExecutor` exposes the selected role projection and rejects duplicate owners with the
typed `DuplicateSystemCommandSemanticRoleError`, atomically across construction, registration, and
replacement.

This is a beta-line breaking contract correction: unannotated commands named `skills`, `compact`, or
`agent` no longer receive special framework behavior. `@robota-sdk/agent-command` now declares the
roles on its shipped skills, compact, and agent commands.
