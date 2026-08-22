---
'@robota-sdk/agent-cli': major
'@robota-sdk/agent-command': major
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-interface-transport': major
'@robota-sdk/agent-session': major
'@robota-sdk/agent-transport': major
'@robota-sdk/agent-transport-tui': major
---

**BREAKING — ARCH-042: project filesystem access is now an explicit, host-issued authority instead of an ambient consequence of `cwd`.**

`@robota-sdk/agent-framework` adds `WorkspaceTrustService` and the opaque
`IWorkspaceProjectAuthority`, plus bounded reader, settings-writer, state-storage, and mutation
facets. Public session, settings, context, checkpoint, memory, contribution, query, and replay
contracts consume those facets. A caller that does not supply `projectAccess` is deliberately
restricted to user-owned host state and receives no project filesystem capability.

The framework removes or renames ambient Node/project exports. Migrate `checkSettingsFile` to
`checkNodeHostSettingsFile`, `readMergedProviderSettingsFromPaths` to
`readMergedProviderSettingsFromSources`, `resolveProviderSettingsWriteTargetPath` to
`resolveProviderSettingsWriteTarget`, `FileSystemMemoryStore` / `createFileSystemMemoryStore` to
`WorkspaceMemoryStore` / `createWorkspaceMemoryStore`, and `PluginSettingsStore` to
`NodeHostPluginSettingsStore`. Host-only git helpers now carry the `FromNodeHost` suffix.
`projectPaths`, `resolveSettingsPathForScope`, and `getProviderSettingsPaths` are removed; project
consumers must use the authority facets rather than recover absolute paths.

`@robota-sdk/agent-session` renames the Node filesystem implementation `SessionStore` to
`NodeSessionStore` and adds explicit session-log/external-payload source and sink ports. Session
replay no longer resolves external payload files from an ambient directory.

`@robota-sdk/agent-interface-transport` changes `ISkillExecutionPort.loadCommands(cwd, home?)` to
the authority-bound `loadCommands()` and removes the optional absolute-path leak
`IInteractiveSessionStore.getFilePath`. `@robota-sdk/agent-command` consequently replaces the
`cwd` option of `createSkillsCommandModule` with required `contributionSources`; default command
composition accepts explicit contribution sources and discovers no project skills when none are
provided.

`@robota-sdk/agent-cli`, `@robota-sdk/agent-transport`, and
`@robota-sdk/agent-transport-tui` thread the trusted-or-restricted project decision through every
session surface. Embedded callers that need project settings, state, context, skills, checkpoints,
or mutation must mint access through `WorkspaceTrustService` and pass the returned
`projectAccess` (and a separately approved mutation/settings facet where required). Omitting it is
still type-compatible but is behaviorally breaking: the surface now fails closed instead of
reading or writing the current directory.
