# Self-Hosting Loop Verification

- **Status**: implemented by CLI-BL-014
- **Owner Packages**: `@robota-sdk/agent-tools`, `@robota-sdk/agent-sdk`
- **Last Updated**: 2026-05-02

## Objective

Robota must be able to edit its own source tree, then run build/test verification without requiring the currently running agent process to reload the modified code. The loop is:

1. create a recoverable checkpoint,
2. apply file edits atomically,
3. run verification in a child process over the new on-disk tree,
4. keep the current process alive on already-loaded code,
5. restore from checkpoint if verification fails and the user requests rollback.

## Research

- Claude Code hooks document deterministic lifecycle points around tool execution and stop behavior. Robota should model verification as a lifecycle protocol around mutations rather than as hidden model instructions.
- Replit Agent checkpoints document recoverable snapshots and rollbacks at development milestones, validation points, and risky fix attempts. Robota should pair self-editing with checkpoint visibility and restore operations.
- GitHub Copilot cloud agent documents an isolated environment that can make changes, run tests and linters, and expose logs while work happens on a branch. Robota's local equivalent is a child process that verifies the on-disk tree independently of the currently loaded SDK process.
- Codex CLI documentation describes a local coding agent that edits and runs code in the selected directory while respecting project instructions and checks. Robota should express its self-hosting protocol through repository-owned specs and command plans, not provider-specific prompt text.

## Package Boundaries

### `@robota-sdk/agent-tools`

Owns filesystem mutation semantics for built-in tools.

- `Write` and `Edit` MUST write UTF-8 content through same-directory temporary files followed by atomic rename.
- Temporary files MUST be removed after failed writes when possible.
- Tool behavior remains provider-agnostic and session-agnostic.
- This package MUST NOT know about `.robota`, checkpoints, sessions, prompts, CLI/TUI, or self-hosting policies.

### `@robota-sdk/agent-sdk`

Owns self-hosting loop planning and state transitions.

- The planner describes the required checkpoint, atomic-edit, handoff, verify, and rollback steps.
- The planner MUST be provider-neutral and UI-neutral.
- Verification commands are data, not hardcoded model prompt instructions.
- The state machine MUST reject invalid lifecycle transitions deterministically.

## Handoff Protocol

The running Robota process is treated as the old runtime. It keeps using modules already loaded by Node.js. The modified code exists only on disk until a verification command starts a fresh child process.

The protocol:

1. **Checkpoint**: create a turn-level edit checkpoint before the first mutation.
2. **Atomic write**: each `Write`/`Edit` mutation writes content to a same-directory temp file and renames it into place.
3. **Handoff**: verification commands run as child processes. They load the new on-disk code without replacing the old runtime process.
4. **Verify**: run package-level checks for affected scopes, then `pnpm harness:verify -- --base-ref <ref> --skip-record-check`.
5. **Recover**: if verification fails, keep the current process alive and expose checkpoint restore via existing rewind APIs.

## Verification Defaults

For changed package scopes, the default command plan is:

```bash
pnpm --filter <scope> test
pnpm --filter <scope> typecheck
pnpm --filter <scope> build
pnpm harness:verify -- --base-ref <base-ref> --skip-record-check
```

If no package scopes are supplied, the planner still includes the harness verification command. Consumers may add broader checks, but MUST NOT silently remove the harness verification step.

## Test Requirements

- Atomic write tests MUST prove successful writes replace content and leave no temp files behind.
- Failure tests MUST prove a failed target replacement preserves the previous filesystem state and cleans temp files.
- Handoff tests MUST prove an old in-memory runtime value remains unchanged while a new child process observes the new on-disk value.
- Planner tests MUST assert command ordering and harness inclusion.
- State-machine tests MUST assert valid success/failure paths and invalid transition rejection.
