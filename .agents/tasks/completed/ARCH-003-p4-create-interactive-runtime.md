---
title: 'ARCH-003-p4: createInteractiveRuntime factory in agent-framework'
status: done
created: 2026-05-30
completed: 2026-05-31
priority: high
urgency: soon
area: packages/agent-framework
depends_on: [ARCH-003-p1, ARCH-003-p2, ARCH-003-p3]
---

## Background

Currently `TuiTransport` and `cli.ts` each contain session-creation and routing logic.
This phase centralises that into a single factory in `agent-framework` that wires an
`IInteractionChannel` to an `InteractiveSession`. After this phase the framework fully
owns the command dispatch loop. See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Implement `createInteractiveRuntime` in `agent-framework`. Wire channel ↔ session:

- Parse user input (using `input-parser` from p2)
- Route slash commands; call `channel.requestAction()` when `interactionHints` present
- Emit `InteractionEvent` to channel for all session output
- Provide available commands to channel for autocomplete

## File to create

```
packages/agent-framework/src/interaction/createInteractiveRuntime.ts
packages/agent-framework/src/interaction/InteractiveRuntime.ts
```

### Public API

```typescript
export interface IInteractiveRuntimeOptions {
  channel: IInteractionChannel;
  commandModules: ICommandModule[];
  provider: IAIProvider;
  sessionStore?: ISessionStore;
  // ...other options currently passed to TuiTransport
}

export interface IInteractiveRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createInteractiveRuntime(options: IInteractiveRuntimeOptions): IInteractiveRuntime;
```

### Internal logic

```
start():
  1. Create InteractiveSession (provider, sessionStore, ...)
  2. Register commandModules into CommandRegistry
  3. Collect interactionHints from all modules
  4. channel.setAvailableCommands(registry.list())
  5. channel.onSubmit(handleSubmit)
  6. channel.start()

handleSubmit(text):
  1. parsed = parseInput(text)
  2. if parsed.type === 'user-message' → session.submitUserMessage(text)
     → stream chunks via channel.write({ type: 'assistant-chunk', ... })
     → done via channel.write({ type: 'assistant-done', ... })
  3. if parsed.type === 'slash-command':
     a. hint = interactionHints[parsed.name]
     b. if hint && parsed.args.length === 0:
          response = await channel.requestAction(buildActionRequest(hint))
          if response.type === 'cancelled' → return
          args = [response.item.value]  (pick) or [] (confirm)
     c. result = await session.executeCommand(parsed.name, args)
     d. channel.write({ type: 'command-result', name: parsed.name, output: result.output })
```

## MockInteractionChannel for tests

```typescript
// packages/agent-framework/src/interaction/__tests__/MockInteractionChannel.ts
export class MockInteractionChannel implements IInteractionChannel {
  private submitHandler?: (text: string) => Promise<void>;
  readonly events: InteractionEvent[] = [];
  readonly actionQueue: TActionResponse[] = [];

  onSubmit(h: (text: string) => Promise<void>) {
    this.submitHandler = h;
  }
  write(e: InteractionEvent) {
    this.events.push(e);
  }
  async requestAction(_: TActionRequest): Promise<TActionResponse> {
    return this.actionQueue.shift() ?? { type: 'cancelled' };
  }
  setAvailableCommands() {}
  setBusy() {}
  async start() {}
  async stop() {}

  async simulateSubmit(text: string) {
    await this.submitHandler!(text);
  }
}
```

## Test file to create

```
packages/agent-framework/src/interaction/__tests__/createInteractiveRuntime.test.ts
```

Cover:

- `/mode plan` (args present) → command-result, no requestAction
- `/mode` (no args, hint present) → requestAction called with pick action → command-result
- `/mode` (no args, cancelled) → no command-result emitted
- `/exit` (confirm hint, confirmed) → command executes
- `/exit` (confirm hint, cancelled) → command skipped
- `'hello'` (user message) → assistant-chunk events → assistant-done
- `/nonexistent` → error event

## Files to update

- `packages/agent-framework/src/index.ts` — export `createInteractiveRuntime`,
  `IInteractiveRuntime`, `IInteractiveRuntimeOptions`

## Constraints

- `createInteractiveRuntime` must not import Ink or any TUI library
- Session creation logic currently in `TuiTransport` moves here; `TuiTransport` will be
  simplified in p5

## Done gate

- [ ] `pnpm --filter @robota-sdk/agent-framework test` — all `createInteractiveRuntime` tests pass
- [ ] `requestAction` is called exactly when and only when args are missing and a hint exists
- [ ] No Ink import in `agent-framework`
- [ ] `pnpm --filter @robota-sdk/agent-framework typecheck` passes
