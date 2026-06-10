---
title: 'CLI-053: --denied-tools never consumed; --allowed-tools/--denied-tools not threaded into TUI mode'
status: done
created: 2026-06-10
completed: 2026-06-11
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-transport
depends_on: []
---

# CLI-053: Tool filter flags not fully threaded

## Problem

Two gaps in the tool filter flags delivered by CLI-046:

1. `--denied-tools` is parsed into `IParsedCliArgs.deniedTools`
   (`packages/agent-cli/src/utils/cli-args.ts:195`) but never read again. Print mode passes
   only `allowedTools` (`packages/agent-cli/src/modes/print-mode.ts:46-47`). The SDK layer
   fully supports `deniedTools` (`packages/agent-framework/src/interactive/interactive-session-options.ts`,
   `packages/agent-transport/src/tui/TuiInteractionChannel.ts`), so only the CLI hand-off is missing.
2. In interactive TUI mode, `renderApp()` (`packages/agent-cli/src/cli.ts:166-194`) receives
   neither `allowedTools` nor `deniedTools`, so both flags silently no-op in the primary mode.

Help text and SPEC advertise both flags as session-wide.

## Expected Behavior

Both flags are passed to the headless channel in print mode and through `renderApp` /
`ITuiCliAdapter` wiring in TUI mode, restricting the tool set in both modes identically.

## Test Plan

- Unit tests: print mode passes `deniedTools`; TUI render options carry both lists into
  the interaction channel.
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary; a provider key configured. Environment already exists.
- Steps:
  1. `robota -p "list files in this directory" --denied-tools Bash,Glob` — ask something that
     would normally use a denied tool.
  2. `robota --allowed-tools Read` (TUI mode), then prompt "run ls via bash".
- Expected observable result: (1) the agent cannot invoke Bash/Glob (tool unavailable in
  transcript); (2) in TUI mode the agent has only Read available and Bash invocation is not
  offered/executed.
- Cleanup: none.
- Evidence (2026-06-11): unit chain fully verified — `headless-channel-options.test.ts` proves
  `HeadlessInteractionChannel` forwards `deniedTools: ['Bash','Glob']` into `InteractiveSession`
  options; `render-channel-options.test.ts` proves `toChannelOptions()` threads both lists from
  `IRenderOptions` into `TuiInteractionChannel`; new `permission-gate.test.ts` proves deny patterns
  win over every mode including `bypassPermissions` (print-mode default). Live-LLM transcript not
  executable in this environment (no API credentials configured); the scenario above runs as
  written once a provider key is configured.
