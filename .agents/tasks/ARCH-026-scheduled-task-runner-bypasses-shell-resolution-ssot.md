---
title: 'ARCH-026: the scheduled-task runner hardcodes POSIX `sh -c`, bypassing the TERM-008 resolvePlatformShell SSOT that agent-core claims is consumed by every shell-running site — scheduled command tasks get different cross-platform semantics from process tasks'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-executor, packages/agent-core
depends_on: []
---

# ARCH-026: scheduled runner hardcodes the shell

## Problem

agent-core declares `resolvePlatformShell` the zero-dependency SSOT for "which shell to spawn, and
how", consumed by every shell-running site. The executor's scheduled-task runner does not use it — it
hardcodes POSIX `sh` + `-c` — so a scheduled `command` task breaks on Windows (where the SSOT resolves
PowerShell with different argument conventions), and two runners in one package give the same command
different cross-platform semantics.

## Evidence

- `packages/agent-core/docs/SPEC.md:416-419` — `resolvePlatformShell` is the "Zero-dependency SSOT
  (TERM-008) for 'which shell to spawn, and how' … Consumed by every shell-running site" (the
  enumerated consumer list omits both executor runners).
- `packages/agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts:3` — correctly
  imports and uses `resolvePlatformShell`.
- `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts:171-172` — hand-rolled
  POSIX-only resolution: `const shell = state.request.shell ?? 'sh'; spawn(shell, ['-c', command], …)`
  — `sh` + `-c` breaks on win32, where the SSOT resolves PowerShell with `-Command`-style args.

## Direction

Make the scheduled runner resolve via `resolvePlatformShell(env, platform)` (honoring `request.shell`
as an explicit override), matching the managed-shell runner. Add both executor runners to the core
SPEC's `resolvePlatformShell` consumer list so the "consumed by every shell-running site" claim is
true. (Distinct from TERM-007, which scopes Windows work to agent-tools/agent-cli/agent-transport-tui
shell-selecting modules; this site is outside its area.)

## Test Plan

- Red-first: a scheduled `command` task's spawn arguments resolve through `resolvePlatformShell` on a
  simulated win32 platform (PowerShell + its arg convention), matching the managed-shell runner — fails
  today (always `sh -c`).
- Core SPEC's `resolvePlatformShell` consumer list includes both executor runners.
- `pnpm harness:verify -- --scope packages/agent-executor` green.

## User Execution Test Scenarios

**Applies on Windows** (scheduled background tasks are a user-facing CLI feature).

- Prerequisites: a Windows environment with the built CLI; a scheduled task that runs a shell command
  observable in its output (fixture authored by this work).
- Steps: schedule a `command` task via the background/schedule surface and let it fire once on Windows.
- Expected (after fix): the command runs through the platform shell (PowerShell) and produces output.
- Expected (before fix, contrast): the task fails to spawn (`sh` not found) or misinterprets the
  command.
- Cleanup: cancel the scheduled task.
- Evidence (fill in after implementation): the scheduled task's output on Windows. (If no Windows
  environment is available, record the red-first unit test's simulated-win32 spawn-args assertion as
  the evidence and note the platform limitation.)
