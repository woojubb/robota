---
title: 'ARCH-003-p8a: Framework interaction tests (no PTY)'
status: done
created: 2026-05-30
completed: 2026-05-31
priority: high
urgency: soon
area: packages/agent-framework
depends_on: [ARCH-003-p4]
---

## Background

With `createInteractiveRuntime` and `MockInteractionChannel` in place, the command
dispatch logic can be verified without any terminal. This phase adds the programmatic
test suite in `agent-framework`. Closes `CLI-040` and `CLI-041`.
See [ARCH-003 overview](ARCH-003-cli-interaction-channel-abstraction.md).

## Goal

Full test suite in `agent-framework` that drives `createInteractiveRuntime` via
`MockInteractionChannel`. Tests focus on **when/what** the framework does — not on
how the channel renders it.

## Test file

```
packages/agent-framework/src/interaction/__tests__/createInteractiveRuntime.test.ts
```

## Test cases

### Input routing

```typescript
// 슬래시 커맨드 (args 있음) → requestAction 호출 안 됨
await channel.simulateSubmit('/mode plan');
expect(requestActionSpy).not.toHaveBeenCalled();
expect(channel.events).toContainEqual({ type: 'command-result', name: 'mode', ... });

// 슬래시 커맨드 (args 없음, hint 있음) → requestAction 호출됨
channel.actionQueue.push({ type: 'pick', item: { label: 'plan', value: 'plan' } });
await channel.simulateSubmit('/mode');
expect(requestActionSpy).toHaveBeenCalledWith(
  expect.objectContaining({ type: 'pick', title: expect.stringContaining('mode') })
);
expect(channel.events).toContainEqual({ type: 'command-result', name: 'mode', ... });
```

### Action cancellation

```typescript
// pick 취소 → command 실행 안 됨
channel.actionQueue.push({ type: 'cancelled' });
await channel.simulateSubmit('/mode');
expect(channel.events).not.toContainEqual(expect.objectContaining({ type: 'command-result' }));

// confirm 취소 → command 실행 안 됨
channel.actionQueue.push({ type: 'cancelled' });
await channel.simulateSubmit('/exit');
expect(channel.events).not.toContainEqual(
  expect.objectContaining({ type: 'command-result', name: 'exit' }),
);
```

### AI message streaming

```typescript
await channel.simulateSubmit('hello');
const chunks = channel.events.filter((e) => e.type === 'assistant-chunk');
expect(chunks.length).toBeGreaterThan(0);
expect(channel.events.at(-1)).toMatchObject({ type: 'assistant-done' });
```

### Permission flow

```typescript
// tool call triggers permission-request; grant resumes
await channel.simulateBashToolCall({ command: 'ls' });
expect(channel.events).toContainEqual(expect.objectContaining({ type: 'permission-request' }));
await channel.simulatePermissionGrant();
expect(channel.events).toContainEqual(
  expect.objectContaining({ type: 'permission-resolved', granted: true }),
);
```

### Error propagation

```typescript
await channel.simulateSubmit('/nonexistent-command');
expect(channel.events).toContainEqual(expect.objectContaining({ type: 'error' }));
```

### setBusy signalling

```typescript
const busyCalls: boolean[] = [];
jest.spyOn(channel, 'setBusy').mockImplementation((v) => busyCalls.push(v));

await channel.simulateSubmit('hello');
expect(busyCalls).toEqual([true, false]); // busy while processing, idle after
```

## Constraints

- Zero Ink imports in this test file or its dependencies
- Use a mocked `IAIProvider` that returns deterministic chunks
- `MockInteractionChannel` defined in p4 is the only test double needed

## Done gate

- [ ] All test cases pass with `pnpm --filter @robota-sdk/agent-framework test`
- [ ] No PTY, no Ink, no real provider in test setup
- [ ] `CLI-040` marked resolved
- [ ] `CLI-041` marked resolved
