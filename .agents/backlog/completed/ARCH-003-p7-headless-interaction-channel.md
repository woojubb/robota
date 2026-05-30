---
title: 'ARCH-003-p7: HeadlessInteractionChannel in agent-transport/headless'
status: done
created: 2026-05-30
completed: 2026-05-31
priority: high
urgency: soon
area: packages/agent-transport, packages/agent-cli
depends_on: [ARCH-003-p6]
---

## Background

Print mode (`-p` flag) uses `HeadlessTransport` and a separate `runPrintMode()` function
in `agent-cli/src/modes/print-mode.ts`. Both create `InteractiveSession` independently,
duplicating session-creation logic. This phase unifies headless behind the same
`createInteractiveRuntime` factory. See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Implement `HeadlessInteractionChannel implements IInteractionChannel`. Wire it through
`createInteractiveRuntime` in `print-mode.ts`. Delete duplicated session-creation code.

## File to create

```
packages/agent-transport/src/headless/HeadlessInteractionChannel.ts
```

### Behaviour

| Method                   | Headless behaviour                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `onSubmit(handler)`      | Store handler; call once with the `-p` prompt value, then done                     |
| `write(event)`           | Format and write to stdout (text / json / stream-json) based on output format flag |
| `requestAction(action)`  | Return `{ type: 'cancelled' }` — headless mode has no interactive disambiguation   |
| `setAvailableCommands()` | No-op                                                                              |
| `setBusy()`              | No-op                                                                              |
| `start()`                | Submit the prompt, await completion, exit                                          |
| `stop()`                 | No-op                                                                              |

## Files to update / delete

| File                                         | Change                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/headless/headless-transport.ts`         | Simplify or replace with `HeadlessInteractionChannel`                                                              |
| `packages/agent-cli/src/modes/print-mode.ts` | Replace internal session-creation with `new HeadlessInteractionChannel(options)` + `createInteractiveRuntime(...)` |

## Constraints

- `HeadlessInteractionChannel.requestAction()` must return `{ type: 'cancelled' }` without
  blocking — headless mode cannot prompt for user input
- Output format (text / json / stream-json) must continue to work identically
- Exit codes (0 = success, 1 = error) must be preserved

## Done gate

- [ ] `pnpm robota -p "hello"` outputs AI response and exits 0
- [ ] `pnpm robota -p "hello" --output-format json` outputs valid JSON
- [ ] No duplicate session-creation code between `print-mode.ts` and `tui` path
- [ ] `pnpm --filter @robota-sdk/agent-transport typecheck` passes
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` passes
