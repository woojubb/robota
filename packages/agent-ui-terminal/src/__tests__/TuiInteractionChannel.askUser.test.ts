/**
 * Unit tests for TuiInteractionChannel.askUser() — the CMD-004 unified ask path (the sole
 * "ask the user" seam). Queue resolution + abort cancellation in isolation; no Ink render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@robota-sdk/agent-framework', async () => {
  const actual = await vi.importActual<typeof import('@robota-sdk/agent-framework')>(
    '@robota-sdk/agent-framework',
  );
  // RUNTIME-001: construction flows through buildRuntimeSession (wraps InteractiveSession); mock both.
  const makeMockSession = (): unknown => ({
    getFullHistory: vi.fn().mockReturnValue([]),
    setName: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-id'),
    isInitialized: false,
    on: vi.fn(),
    off: vi.fn(),
    cancelQueue: vi.fn(),
    abort: vi.fn(),
  });
  return {
    ...actual,
    InteractiveSession: vi.fn().mockImplementation(makeMockSession),
    buildRuntimeSession: vi.fn().mockImplementation(makeMockSession),
    CommandRegistry: vi.fn().mockImplementation(() => ({
      addModule: vi.fn(),
    })),
  };
});

import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

import type { IAIProvider, IActionRequest } from '@robota-sdk/agent-core';

function makeChannel(): TuiInteractionChannel {
  return new TuiInteractionChannel({ cwd: '/tmp', provider: {} as IAIProvider });
}

const SELECT: IActionRequest = {
  id: 'mode',
  title: 'Select mode',
  options: [
    { value: 'plan', label: 'Plan' },
    { value: 'default', label: 'Default' },
  ],
  maxSelect: 1,
};

const CONFIRM: IActionRequest = {
  id: 'exit',
  title: 'Exit?',
  options: [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ],
  maxSelect: 1,
};

describe('TuiInteractionChannel.askUser', () => {
  let channel: TuiInteractionChannel;

  beforeEach(() => {
    channel = makeChannel();
  });

  it('sets pendingUserAction when askUser is called', () => {
    void channel.askUser(SELECT);
    expect(channel.pendingUserAction).toMatchObject({ id: 'mode' });
  });

  it('resolves the answer when resolveUserAction is called, then clears pendingUserAction', async () => {
    const promise = channel.askUser(SELECT);
    channel.resolveUserAction({ type: 'answer', values: ['default'] });
    const response = await promise;
    expect(response).toEqual({ type: 'answer', values: ['default'] });
    expect(channel.pendingUserAction).toBeNull();
  });

  it('resolves cancelled', async () => {
    const promise = channel.askUser(SELECT);
    channel.resolveUserAction({ type: 'cancelled' });
    expect(await promise).toEqual({ type: 'cancelled' });
  });

  it('queues multiple asks and processes them sequentially', async () => {
    const p1 = channel.askUser(SELECT);
    const p2 = channel.askUser(CONFIRM);
    expect(channel.pendingUserAction).toMatchObject({ id: 'mode' });

    channel.resolveUserAction({ type: 'answer', values: ['plan'] });
    await p1;
    expect(channel.pendingUserAction).toMatchObject({ id: 'exit' });

    channel.resolveUserAction({ type: 'answer', values: ['no'] });
    expect(await p2).toEqual({ type: 'answer', values: ['no'] });
    expect(channel.pendingUserAction).toBeNull();
  });

  it('cancelQueue() resolves every in-flight/queued ask as cancelled', async () => {
    const p1 = channel.askUser(SELECT);
    const p2 = channel.askUser(CONFIRM);
    channel.cancelQueue();
    expect(await p1).toEqual({ type: 'cancelled' });
    expect(await p2).toEqual({ type: 'cancelled' });
    expect(channel.pendingUserAction).toBeNull();
  });

  it('abort() resolves an in-flight ask as cancelled', async () => {
    const promise = channel.askUser(SELECT);
    channel.abort();
    expect(await promise).toEqual({ type: 'cancelled' });
  });

  it('calls onChange when pendingUserAction changes', () => {
    const onChange = vi.fn();
    channel.onChange = onChange;
    void channel.askUser(SELECT);
    expect(onChange).toHaveBeenCalled();
  });
});
