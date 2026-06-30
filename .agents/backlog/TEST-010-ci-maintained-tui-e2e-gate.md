---
title: 'TEST-010: CI-maintained TUI PTY E2E gate (background-work drill-in self-verification)'
status: in-progress
created: 2026-06-30
priority: high
urgency: soon
area: packages/agent-transport-tui, packages/agent-cli, .github/workflows
depends_on: []
---

# CI-maintained TUI E2E gate

The TUI background-work fixes (SCREEN-010..013) are verified by unit + component tests, but the
**end-to-end, real-binary** behaviour — pressing `Ctrl+B` in the live TUI to reach the
execution-workspace switcher — is only checkable by a human running the app. The repo already has a
PTY harness (`spawnTui`, `*.ptytest.ts`, `pnpm … test:pty`) that drives the **built robota CLI** in a
real pseudo-terminal, but **those PTY tests are not run in CI**, so nothing maintains them or the
behaviours they cover. A regression could silently revert the drill-in entry point.

Goal: an automated, self-run E2E that the agent can execute, **wired into CI as a blocking gate** so
the behaviour is preserved going forward.

## What

1. **PTY E2E for the drill-in entry point** — a `*.ptytest.ts` that launches the TUI through the real
   binary, presses `Ctrl+B`, and asserts the execution-workspace switcher opens (`Execution
workspace`), then `Esc` closes it. This verifies the SCREEN-013 App-level `Ctrl+B` wiring end to
   end (the switcher always lists the main thread, so it is assertable without seeded background work).
2. **CI gate** — add a `tui-e2e` job to `.github/workflows/ci.yml` that builds the CLI and runs
   `pnpm --filter @robota-sdk/agent-transport-tui test:pty` on every PR, so the PTY suite (this test +
   the existing `*.ptytest.ts`) is maintained, not bit-rotting outside CI. Soft-launch
   (`continue-on-error`) only if the first run proves flaky; otherwise blocking.
3. **Follow-up (tracked, not blocking)** — a deterministic background-task seed (test-only seam or a
   replay fixture carrying background-task events) so the panel ordering (SCREEN-010), single-line
   rows (SCREEN-011), humanized tool names (SCREEN-012), and full `Ctrl+B → ↑↓ → Enter → detail`
   drill-in can be asserted against seeded background work in the real binary.

## Test Plan

- `pnpm --filter @robota-sdk/agent-transport-tui test:pty` passes locally (agent runs it directly).
- New `tui-e2e` CI job is green on its first PR run, then blocking.
- typecheck / lint / `pnpm harness:scan` green.

## User Execution Test Scenarios

- Not applicable (test-infrastructure + CI change). The deliverable is the automated gate itself; the
  agent runs `test:pty` directly and the CI job runs it on every PR. Evidence is the green
  `test:pty` run + the green `tui-e2e` CI job, recorded below.
- Evidence: Agent ran `pnpm --filter @robota-sdk/agent-transport-tui test:pty` locally — **10 tests /
  7 files green**, including the new `background-work-switcher.ptytest.ts` which drives `Ctrl+B` in the
  real binary and asserts the execution-workspace switcher opens. CI evidence: the new `tui-e2e` job's
  green run on the PR (recorded after merge).
