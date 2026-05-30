---
title: 'ARCH-003-p5: TuiInteractionChannel in agent-transport/tui'
status: todo
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-transport
depends_on: [ARCH-003-p4]
---

## Background

`TuiTransport` currently creates `InteractiveSession` internally and manages its lifecycle
via the `useInteractiveSession` React hook. After p4, `createInteractiveRuntime` in
`agent-framework` owns that role. This phase refactors `agent-transport/tui` to be a pure
Ink adapter that implements `IInteractionChannel`.
See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Implement `TuiInteractionChannel implements IInteractionChannel`. The class bridges:

- **Inbound**: Ink keyboard events → `onSubmit` handler
- **Outbound**: `InteractionEvent` → React state updates → Ink re-render
- **Actions**: `requestAction()` → mount `<CommandPicker />` or `<CommandConfirm />`,
  await user input, resolve Promise

`InputArea.tsx` is simplified to a dumb keyboard capture component.

## File to create

```
packages/agent-transport/src/tui/TuiInteractionChannel.ts
```

### Skeleton

```typescript
export class TuiInteractionChannel implements IInteractionChannel {
  private submitHandler?: (text: string) => Promise<void>;
  private stateUpdater?: (event: InteractionEvent) => void;
  private actionResolver?: (response: IActionResponse) => void;

  onSubmit(handler: (text: string) => Promise<void>) {
    this.submitHandler = handler;
  }

  write(event: InteractionEvent) {
    this.stateUpdater?.(event);
  }

  async requestAction(action: IActionRequest): Promise<IActionResponse> {
    // 1. signal App.tsx to mount the appropriate dialog
    // 2. return a Promise that resolves when user picks/confirms/cancels
    return new Promise((resolve) => {
      this.actionResolver = resolve;
      this.stateUpdater?.({ type: '__action-request', action } as any);
    });
  }

  setAvailableCommands(commands: ICommandInfo[]) {
    /* feed to InputArea */
  }
  setBusy(busy: boolean) {
    /* feed to App */
  }

  async start() {
    // mount Ink <App channel={this} />
  }
  async stop() {
    /* unmount */
  }
}
```

## Files to update / delete

| File                                      | Change                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/tui/useInteractiveSession.ts`        | **DELETE** — session lifecycle moves to p4 factory                                                                             |
| `src/tui/tui-transport.ts`                | Simplify or replace: now just creates `TuiInteractionChannel`                                                                  |
| `src/tui/App.tsx`                         | Receive `channel: TuiInteractionChannel`; subscribe to events; render action dialogs                                           |
| `src/tui/InputArea.tsx`                   | Remove registry calls, `activeInteraction` state, `resolveCommandInteraction`; call `channel.handlers.onSubmit(text)` on Enter |
| `src/tui/flows/input-area-flow.ts`        | Remove `open-interaction` branch (deleted in p3); simplify or delete                                                           |
| `src/tui/interactions/CommandPicker.tsx`  | Keep — now invoked by `TuiInteractionChannel.requestAction()`                                                                  |
| `src/tui/interactions/CommandConfirm.tsx` | Keep — now invoked by `TuiInteractionChannel.requestAction()`                                                                  |

## Constraints

- `TuiInteractionChannel` must import `IInteractionChannel` from `agent-framework`
- `TuiInteractionChannel` must NOT import from `agent-cli`
- `App.tsx` must NOT create `InteractiveSession` directly
- `useInteractiveSession` hook must be fully deleted (not just unused)

## Done gate

- [ ] `useInteractiveSession.ts` deleted
- [ ] `grep -r 'useInteractiveSession' packages/agent-transport` returns no results
- [ ] `grep -r 'resolveCommandInteraction' packages/agent-transport` returns no results
- [ ] `TuiInteractionChannel` implements all methods of `IInteractionChannel`
- [ ] `pnpm --filter @robota-sdk/agent-transport typecheck` passes
