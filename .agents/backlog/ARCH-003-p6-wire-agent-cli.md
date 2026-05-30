---
title: 'ARCH-003-p6: Wire agent-cli composition root'
status: todo
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-cli
depends_on: [ARCH-003-p5]
---

## Background

`agent-cli/src/cli.ts` currently constructs `TuiTransport` with many options and starts it.
After p4 and p5, the composition becomes: create `TuiInteractionChannel`, call
`createInteractiveRuntime`, start. This phase applies that simplification.
See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Update `cli.ts` to use the new API. Remove redundant session-creation code and any logic
that has been absorbed by `createInteractiveRuntime`.

## Change in `src/cli.ts`

```typescript
// Before (simplified)
const tuiTransport = new TuiTransport({
  provider,
  modelId,
  commandModules,
  sessionStore,
  shellExec,
  cliAdapter,
  ...
});
await tuiTransport.start();

// After
const channel = new TuiInteractionChannel({ cliAdapter, shellExec, ...tuiOnlyOptions });
const runtime = createInteractiveRuntime({
  channel,
  commandModules,
  provider,
  sessionStore,
  ...
});
await runtime.start();
```

## Files to update

| File                           | Change                                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `src/cli.ts`                   | Replace `TuiTransport` construction with `TuiInteractionChannel` + `createInteractiveRuntime`                               |
| `src/startup/command-setup.ts` | Verify `buildCommandSetup()` return value is compatible with `IInteractiveRuntimeOptions.commandModules` — adjust if needed |
| `src/modes/print-mode.ts`      | No change in this phase (handled in p7)                                                                                     |

## Constraints

- `agent-cli` must not contain session-creation or command-routing logic after this phase
- All flags and CLI arguments must continue to work unchanged
- `src/cli.ts` should become noticeably shorter

## Done gate

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` passes
- [ ] `pnpm robota --help` works
- [ ] `pnpm robota -p "hello"` works (headless — unchanged path)
- [ ] TUI mode launches correctly (User Execution Test Scenario A from ARCH-003 master)
