# Compact Auto Controls

Status: completed in `feat/compact-auto-controls`.

## What

Add a user-facing way to inspect, enable, disable, and tune the automatic context compaction threshold that is now shown by `/context`.

## Why

`/context` exposes the current auto-compact threshold, but users cannot change that setting from the command surface that revealed it. This creates an incomplete control loop: Robota can explain that auto-compaction is enabled at a percentage, but users must know an undocumented configuration path to change or disable it.

## Current Signals

- `packages/agent-command-context/src/context-command.ts` reports `Auto compact` from the `context` command.
- `packages/agent-sessions/src/session-types.ts` supports `autoCompactThreshold?: TAutoCompactThreshold`.
- `packages/agent-sessions/src/context-window-tracker.ts` accepts a threshold fraction or `false`.
- `packages/agent-sdk/src/assembly/create-session.ts` can pass `autoCompactThreshold` into the session.

## Research Required

Before implementation, research how this should fit into the command/settings model:

- whether the control should live under `/context`, `/compact`, `/config`, `/settings`, or a provider/session profile command;
- whether thresholds should be session-local, project-local, or user-global;
- whether CLI changes should immediately affect the current session or only newly created sessions;
- whether the command should accept percentages (`85%`), fractions (`0.85`), named presets, or all of them;
- whether disabling auto-compact should require confirmation near high context usage;
- how to surface current defaults, project overrides, and user overrides without confusing users.

## Recommendation

Implemented as a descriptor-owned settings command that updates the current session and persists through the host settings adapter used for session options.

Recommended initial command shape:

- `/context auto on`
- `/context auto off`
- `/context auto 85%`
- `/context auto reset`

Rationale: users discover the setting through `/context`, so the smallest coherent UX is to place the control next to the status display. If a broader settings command later exists, it can delegate to the same descriptor/action without moving the user-facing semantics.

Persistence decision: the command writes the user settings target supplied by the host adapter and updates the active session immediately. Project-local settings can still override user settings for newly created sessions according to the existing config precedence.

## Scope

- [x] Define the command descriptor and argument parsing for auto-compact controls.
- [x] Decide and document persistence precedence for user, project, and session values.
- [x] Update the active session threshold immediately when changed from the CLI.
- [x] Show the effective value and source in `/context`.
- [x] Add validation for invalid, unsafe, or out-of-range thresholds.
- [x] Add tests for enable, disable, percentage change, reset, and persistence.

## Non-Goals

- Do not change the default threshold without separate research.
- Do not hide the current auto-compact status from `/context`.
- Do not make auto-compaction provider-specific.
- Do not require users to edit generated documentation or generated API reference files.

## Acceptance Criteria

- [x] Users can enable auto-compaction from a command.
- [x] Users can disable auto-compaction from a command.
- [x] Users can set the threshold as a human-readable percentage.
- [x] Users can reset to the documented default.
- [x] `/context` reports the effective threshold and its source.
- [x] The current session behavior changes without requiring a full CLI restart.
- [x] Tests cover command parsing, persistence, session update, and `/context` output.

## Test Plan

- [x] Add SDK command tests for auto-compact control descriptors and command results.
- [x] Add session tests proving threshold updates affect `shouldAutoCompact()`.
- [x] Add CLI slash-routing tests proving the command reaches the shared system-command path.
- [x] Add settings I/O tests for persisted threshold values and reset behavior.

## Promotion Path

1. [x] Move to `.agents/tasks/completed/compact-auto-controls.md`.
2. [x] Complete command/settings research before choosing the persistence layer.
3. [x] Implement session-local behavior first, then persist the setting once precedence is explicit.
