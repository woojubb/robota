---
title: 'ARCH-003-p8b: TUI dialog tests (ink-testing-library)'
status: todo
created: 2026-05-30
priority: high
urgency: soon
area: packages/agent-transport
depends_on: [ARCH-003-p5]
---

## Background

`TuiInteractionChannel.requestAction()` shows Ink picker/confirm dialogs and resolves a
Promise when the user responds. This phase tests that rendering and keyboard handling in
isolation — with no framework or command logic involved.
See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Test suite in `agent-transport/tui` that verifies `TuiInteractionChannel.requestAction()`
and the underlying `<CommandPicker />` / `<CommandConfirm />` components independently of
`createInteractiveRuntime` or any command module.

## Test file

```
packages/agent-transport/src/tui/__tests__/TuiInteractionChannel.requestAction.test.tsx
packages/agent-transport/src/tui/interactions/__tests__/CommandPicker.test.tsx
packages/agent-transport/src/tui/interactions/__tests__/CommandConfirm.test.tsx
```

## Test cases

### `TuiInteractionChannel.requestAction` — pick

```typescript
import { render } from 'ink-testing-library';

const channel = new TuiInteractionChannel({
  /* minimal options */
});

// Start requestAction (non-blocking)
const responsePromise = channel.requestAction({
  type: 'pick',
  id: 'test-pick',
  title: 'mode',
  items: [
    { label: 'plan', value: 'plan' },
    { label: 'default', value: 'default' },
  ],
});

// Picker renders
expect(lastFrame()).toContain('plan');
expect(lastFrame()).toContain('default');

// Arrow down moves selection
stdin.write('[B'); // ↓
expect(/* second item highlighted */);

// Enter selects
stdin.write('\r');
const response = await responsePromise;
expect(response).toEqual({ type: 'pick', item: { label: 'default', value: 'default' } });
```

### `TuiInteractionChannel.requestAction` — pick cancelled

```typescript
const responsePromise = channel.requestAction({ type: 'pick', id: 'x', title: 'mode', items });
stdin.write('\x1B'); // Esc
expect(await responsePromise).toEqual({ type: 'cancelled' });
```

### `TuiInteractionChannel.requestAction` — confirm accepted

```typescript
const responsePromise = channel.requestAction({
  type: 'confirm',
  id: 'exit-confirm',
  message: 'Exit the session?',
});
expect(lastFrame()).toContain('Exit the session?');
stdin.write('y');
expect(await responsePromise).toEqual({ type: 'confirm', confirmed: true });
```

### `TuiInteractionChannel.requestAction` — confirm cancelled

```typescript
const responsePromise = channel.requestAction({ type: 'confirm', id: 'x', message: 'Exit?' });
stdin.write('n');
expect(await responsePromise).toEqual({ type: 'cancelled' });
```

### `CommandPicker` component (unit)

```typescript
// Renders all items, highlights first by default
// ↑↓ changes highlighted index
// Enter calls onSelect with highlighted item
// Esc calls onCancel
```

### `CommandConfirm` component (unit)

```typescript
// Renders message
// y / Enter calls onConfirm
// n / Esc calls onCancel
```

## Constraints

- No `InteractiveSession` or `createInteractiveRuntime` import in these tests
- No `agent-cli` import
- `ink-testing-library` must be added to `agent-transport` devDependencies if not present

## Done gate

- [ ] All test cases pass with `pnpm --filter @robota-sdk/agent-transport test`
- [ ] Picker: Enter resolves with selected item, Esc resolves with `cancelled`
- [ ] Confirm: y/Enter → `confirmed: true`, n/Esc → `cancelled`
- [ ] No command-processing imports in test files
