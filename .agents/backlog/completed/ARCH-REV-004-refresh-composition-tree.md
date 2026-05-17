---
title: 'ARCH-REV-004: Refresh composition-tree.md — stale post-CLIR refactor (startup sequence, TuiTransport, App.tsx)'
status: todo
created: 2026-05-18
priority: critical
urgency: now
area: .agents/specs/architecture-map/agent-cli/composition-tree.md
depends_on: []
---

## Problem

`composition-tree.md` documents the pre-`createAgentRuntime` call sequence from the `refactor/arch-002-slim-agent-cli` branch. That branch has since merged. The file has **6 critical inaccuracies** that will actively mislead any developer reading the startup code:

**C-01 — Startup call sequence wrong**: `startCli()` no longer calls `buildCommandSetup()`, `readProviderSettings()`, `createProviderFromSettings()`, `createDefaultBackgroundTaskRunners()`, `createProjectSessionStore()` directly. Current call sequence:

```
startCli()
  parseArgsOrExit()
  readVersion()
  new PrintTerminal()
  handlePreflightCommands()
  toConfigPhaseOptions()
  runUserLocalDirectCommandIfRequested()
  createCommandSetup()
  handleConfigPhase()
  createProviderSetup()
  createSessionSetup()
  createAgentRuntime({ ... })
  runPrintMode(sessionOpts, runtime) OR runTuiMode({ runtime, ... })
```

**C-02 — cli.ts line count wrong**: Document says 196 lines. Actual: 98 lines (verified: `wc -l`).

**C-03 — TuiTransport constructor wrong**: Documented as `new TuiTransport({ cwd, provider, ..., transportRegistry, cliAdapter })`. Actual: takes `options: ITuiRenderOptions` with `runtime: IAgentRuntime` as primary field.

**C-04 — InteractiveSession construction location wrong**: `runPrintMode()` calls `runtime.createSession()` (not `new InteractiveSession()`). `new InteractiveSession(...)` is constructed inside `agent-transport/src/tui/hooks/use-interactive-session-init.ts::initializeSession()`.

**M-01 — App.tsx render tree incomplete**: Missing `StreamingIndicator`, `TransportTUI`, `UpdateNotice`, `usePluginCallbacks`, `useStatusLineSettings`, `TuiCliAdapterProvider`. `StatusBar` and `SlashAutocomplete` listed at wrong hierarchy levels.

**M-03 — CommandEffectQueue wrong file**: Documented as `tui/command-interaction.ts` (a 9-line re-export shim). Actual class is in `tui/hooks/command-effect-queue.ts`.

Source: Senior Developer (C-01 through C-06, M-01 through M-03).

## Recommendation

**Proceed without user approval** — all inaccuracies are factual and verified against actual source code by the Senior Developer agent. This is a documentation sync, not a design decision.

Approach:

1. Read current `cli.ts` and startup modules to document the actual call sequence
2. Read `App.tsx` to get the accurate render tree
3. Verify `TuiTransport` constructor signature from source
4. Rewrite the composition tree startup section and App.tsx section to match current code
5. Update the line count for `cli.ts` (98 lines)
6. Fix `CommandEffectQueue` file reference

## Test Plan

- Verify `wc -l packages/agent-cli/src/cli.ts` matches documented line count
- Grep for `createAgentRuntime` in cli.ts to confirm call sequence
- Grep for `ITuiRenderOptions` in TuiTransport to confirm constructor type
- Grep for `CommandEffectQueue` in `tui/hooks/` to confirm actual location
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
