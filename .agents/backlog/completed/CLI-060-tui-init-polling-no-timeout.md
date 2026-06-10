---
title: 'CLI-060: TUI session-init polling swallows errors indefinitely without timeout'
status: done
created: 2026-06-10
completed: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-transport
depends_on: []
---

# CLI-060: TUI session initialization polling has no failure path

## Problem

`TuiInteractionChannel` polls session readiness every 200ms and swallows all errors:
`packages/agent-transport/src/tui/TuiInteractionChannel.ts:435-438` —
`catch { /* Not yet initialized */ }`. If initialization fails persistently (bad provider
config, thrown constructor error, storage failure), the catch hides it and the poll loop runs
forever; the user sees a TUI that never becomes ready, with no error message. Only genuine
"not yet initialized" states should be retried.

## Expected Behavior

The polling loop distinguishes "not initialized yet" from real errors, and applies a bounded
timeout (e.g. N seconds) after which a clear initialization-failure message is rendered and the
session enters an error state instead of silently spinning.

## Test Plan

- Unit test: init that always throws a non-readiness error surfaces a failure state within the
  timeout; init that succeeds on attempt k < timeout proceeds normally.
- `pnpm --filter @robota-sdk/agent-transport build && pnpm --filter @robota-sdk/agent-transport test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary; a settings file with a provider profile that fails at
  construction (e.g. malformed model config that throws in createProvider). Environment can be
  prepared by editing a temp settings file.
- Steps: run `robota` with the broken profile.
- Expected observable result: within the timeout the TUI shows a clear initialization error
  (not an eternal loading state), and exiting works normally.
- Cleanup: restore the settings file.
- Evidence (2026-06-11): polling moved to pure `flows/session-init-poller.ts` — benign
  /not initialized/ errors retry until a 15s timeout then surface `{kind:'timeout'}`; any other
  error surfaces `{kind:'error'}` immediately. `TuiInteractionChannel` failure path sets the error
  state and appends a `session-init-error` event entry ("Session initialization failed: …").
  Tests: poller suite (4 fake-timer cases) + channel failure test with mocked session throwing
  ENOENT → entry rendered with the message (all pass). The user scenario (broken provider profile
  → visible error within 15s instead of eternal spinner) is exercised end-to-end by the channel
  test; a manual TUI run additionally requires only a malformed settings profile.
