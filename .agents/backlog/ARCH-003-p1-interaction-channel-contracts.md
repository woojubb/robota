---
title: 'ARCH-003-p1: Define IInteractionChannel + types in agent-framework'
status: todo
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

ARCH-003 introduces `IInteractionChannel` as the standard contract between the framework
and any surface (TUI, web, test). This phase creates all type definitions — contracts only,
no implementation. See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Add the full set of interaction contract types to `agent-framework` and export them from
the package public API.

## Files to create

```
packages/agent-framework/src/interaction/IInteractionChannel.ts
packages/agent-framework/src/interaction/types.ts
```

### `types.ts`

```typescript
/** One-way display events pushed by the framework to the channel. */
export type InteractionEvent =
  | { type: 'user-message'; text: string }
  | { type: 'assistant-chunk'; chunk: string }
  | { type: 'assistant-done'; fullText: string }
  | { type: 'tool-call'; id: string; name: string; args: unknown }
  | { type: 'tool-result'; id: string; name: string; result: unknown }
  | { type: 'permission-request'; request: IPermissionRequest }
  | { type: 'permission-resolved'; id: string; granted: boolean }
  | { type: 'command-result'; name: string; output: string }
  | { type: 'error'; error: Error };

/** Request-response contract for disambiguation dialogs. */
export type IActionRequest =
  | { type: 'pick'; id: string; title: string; items: IPickItem[]; defaultIndex?: number }
  | { type: 'confirm'; id: string; message: string; defaultValue?: boolean };

export type IActionResponse =
  | { type: 'pick'; item: IPickItem }
  | { type: 'confirm'; confirmed: boolean }
  | { type: 'cancelled' };

export interface IPickItem {
  label: string;
  value: string;
  description?: string;
}

export interface ICommandInfo {
  name: string;
  description: string;
  subcommands?: ICommandInfo[];
}

/** Declared by command modules; consumed by createInteractiveRuntime to call requestAction. */
export type ICommandInteractionHint =
  | { type: 'pick'; getItems(): IPickItem[] }
  | { type: 'confirm'; message: string };
```

### `IInteractionChannel.ts`

```typescript
export interface IInteractionChannel {
  /** Framework registers input handler. Channel calls it when user submits text. */
  onSubmit(handler: (text: string) => Promise<void>): void;

  /** Framework pushes one-way display events. Fire-and-forget. */
  write(event: InteractionEvent): void;

  /**
   * Framework requests user disambiguation. Channel decides HOW to present it
   * (Ink dialog, web modal, programmatic preset). Resolves when user responds.
   */
  requestAction(action: IActionRequest): Promise<IActionResponse>;

  /** Framework provides registered slash commands for autocomplete. */
  setAvailableCommands(commands: ICommandInfo[]): void;

  /** Signal whether session is busy (channel may disable input). */
  setBusy(busy: boolean): void;

  start(): Promise<void>;
  stop(): Promise<void>;
}
```

## Files to update

- `packages/agent-framework/src/index.ts` — export all new symbols
- `packages/agent-framework/src/command-api/command-module.ts` — add optional field:
  ```typescript
  interactionHints?: Record<string, ICommandInteractionHint>;
  ```

## Constraints

- No implementation code in this phase — contracts only
- `IPermissionRequest` reference must use the existing type already in `agent-framework`
- Ink must not be imported anywhere in `agent-framework`

## Done gate

- [ ] `pnpm --filter @robota-sdk/agent-framework typecheck` passes
- [ ] All new types exported from `agent-framework` public API
- [ ] `ICommandModule` has optional `interactionHints` field
- [ ] No implementation files added
