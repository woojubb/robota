# CLI-030: Session-Level "Allow for this session" Permission

- **Status**: completed
- **Created**: 2026-05-24
- **Branch**: feat/cli-030-allow-session-permission
- **Scope**: packages/agent-session, packages/agent-framework, packages/agent-transport

## Objective

Add "Allow for this session" option to permission prompts so users can reduce repeated approval friction without enabling the unsafe bypassPermissions mode. Session-local allow list lives in memory and is discarded on session end.

## Plan

- [x] Update `permission-prompt.ts` — add "Allow for this session" option (3-option prompt)
- [x] Update `PermissionEnforcer.checkPermission` — handle `allow-session`/`allow-project` from `promptForApprovalFn`
- [x] Update `permission-types.ts` — `promptForApprovalFn` return type changed to `Promise<TPermissionResult>`
- [x] Update `session-types.ts` — same type change
- [x] Update `create-session-types.ts` — same type change
- [x] Add unit tests for `PermissionEnforcer.checkPermission` session-allow behavior (12 tests)
- [x] Add unit tests for `promptForApproval` (framework) — 3-option selection (6 tests)
- [x] Update SPEC.md — document session-allow, project-allow, and TUI prompt options

## Decisions

- Terminal-based prompt (non-TUI) gets 3 options: Allow once / Allow for this session / Deny
- "Allow always (this project)" is TUI-only for now (backlog marks it optional)
- TUI already has all 4 options via `PermissionPrompt.tsx` — no change needed there

## Progress

### 2026-05-24

- Discovered implementation changes already present in working tree on develop
- Created branch `feat/cli-030-allow-session-permission`
- Added 12 unit tests for `PermissionEnforcer.checkPermission` session-allow behavior
- Added 6 unit tests for `promptForApproval` 3-option terminal prompt
- Updated SPEC.md Permission System section with session-allow, project-allow, and TUI details
- All 826 agent-framework tests + 60 agent-session tests pass

## Blockers

- (none)

## Result

Implemented session-level "Allow for this session" permission option. Terminal prompt now has 3 options (Allow once / Allow for this session / Deny). `PermissionEnforcer` handles `allow-session` from both `permissionHandler` and `promptForApprovalFn` paths by adding the tool to an in-memory set that auto-approves future calls within the session. TUI `PermissionPrompt.tsx` was already complete with 4 options. 18 new tests added across `agent-session` and `agent-framework`.
