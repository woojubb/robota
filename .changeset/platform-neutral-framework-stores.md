---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-ui-terminal': minor
---

Move the edit checkpoint store and the session stores off the framework's main entry, so a session's checkpoints and stored sessions are typed by contracts a host with no files can implement. The package stays Node-only until the rest of the split lands.

What a session now takes:

- `editCheckpointStore` is an `IEditCheckpointStore` (new, on the main entry: `beginTurn`, `captureFile`, `finalizeTurn`, `list`, `countUnreadable`, `listing`, `inspect`, `restoreToCheckpoint`, `rollbackThroughCheckpoint`, the branch methods and the active-branch pointer), not the `EditCheckpointStore` class. A host that keeps checkpoints somewhere other than a project's files implements the interface; absent, a session has no checkpoints and says why, as before. `createEditCheckpointStore` options of the CLI and the terminal UI are typed the same way.
- `IInteractiveSessionStore`, `IInteractiveSessionRecord`, `IResumableSessionSummary`, `TSessionLoadOutcome` and `IHostToolResultSpillStore` are unchanged on the main entry, as are the listing and resolving helpers (`scanSessionStore`, `listResumableSessions`, `resolveSessionIdByIdOrName`, `lockedSessionsNotice` and the rest) and `decorateSessionStore`; they work over any store.

Moved to `@robota-sdk/agent-framework/node` (no longer on the main entry): `EditCheckpointStore`, `createDirectoryEditCheckpointState`, `migrateWorkspaceEditCheckpoints` and the types `IEditCheckpointStateStorage`, `IEditCheckpointMigration`, `IMigrateEditCheckpointsOptions` and `TEditCheckpointKeptPlainReason`; `createProjectSessionStore`, `createNodeHostSessionStore`, `createUserSessionStore`, `createUserPromptHistoryFile`, `createNodeToolResultSpillStore`, `sweepStaleToolResultSpillDirectories`, `WorkspaceProjectSessionStore`, `WorkspaceSessionLogSink`, `WorkspaceSessionLogSource`, `migrateWorkspaceProjectSessionLogs`, `migrateWorkspaceProjectSessionRecords` and their option and result types. They seal, read and migrate exactly as before, through `@robota-sdk/agent-session/node`. The repository's lint rule that keeps product packages from building a conversation store outside the product factory now names the same constructors on the Node entry too.
