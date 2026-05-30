/**
 * Unit tests for TuiInteractionChannel.requestAction() promise protocol.
 *
 * Tests the queue-based action resolution mechanism in isolation —
 * no Ink rendering, no InteractiveSession, no real provider required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@robota-sdk/agent-framework', async () => {
  const actual = await vi.importActual<typeof import('@robota-sdk/agent-framework')>(
    '@robota-sdk/agent-framework',
  );
  return {
    ...actual,
    InteractiveSession: vi.fn().mockImplementation(() => ({
      getFullHistory: vi.fn().mockReturnValue([]),
      setName: vi.fn(),
      getSessionId: vi.fn().mockReturnValue('test-id'),
      isInitialized: false,
      on: vi.fn(),
      off: vi.fn(),
    })),
    CommandRegistry: vi.fn().mockImplementation(() => ({
      addModule: vi.fn(),
    })),
  };
});

import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IActionRequest } from '@robota-sdk/agent-framework';

function makeChannel(): TuiInteractionChannel {
  return new TuiInteractionChannel({
    cwd: '/tmp',
    provider: {} as IAIProvider,
  });
}

const PICK_ACTION: IActionRequest = {
  type: 'pick',
  id: 'mode',
  title: '/mode',
  items: [
    { label: 'plan', value: 'plan' },
    { label: 'default', value: 'default' },
  ],
};

const CONFIRM_ACTION: IActionRequest = {
  type: 'confirm',
  id: 'exit',
  message: 'Exit the session?',
};

describe('TuiInteractionChannel.requestAction', () => {
  let channel: TuiInteractionChannel;

  beforeEach(() => {
    channel = makeChannel();
  });

  it('sets pendingAction when requestAction is called', () => {
    void channel.requestAction(PICK_ACTION);
    expect(channel.pendingAction).toMatchObject({ type: 'pick', id: 'mode' });
  });

  it('resolves pick response when resolveAction is called', async () => {
    const responsePromise = channel.requestAction(PICK_ACTION);
    channel.resolveAction({ type: 'pick', item: { label: 'plan', value: 'plan' } });
    const response = await responsePromise;
    expect(response).toEqual({ type: 'pick', item: { label: 'plan', value: 'plan' } });
  });

  it('clears pendingAction after resolveAction', async () => {
    const responsePromise = channel.requestAction(PICK_ACTION);
    channel.resolveAction({ type: 'cancelled' });
    await responsePromise;
    expect(channel.pendingAction).toBeNull();
  });

  it('resolves confirm response when resolveAction is called', async () => {
    const responsePromise = channel.requestAction(CONFIRM_ACTION);
    channel.resolveAction({ type: 'confirm', confirmed: true });
    const response = await responsePromise;
    expect(response).toEqual({ type: 'confirm', confirmed: true });
  });

  it('resolves cancelled when resolveAction is called with cancelled', async () => {
    const responsePromise = channel.requestAction(PICK_ACTION);
    channel.resolveAction({ type: 'cancelled' });
    const response = await responsePromise;
    expect(response).toEqual({ type: 'cancelled' });
  });

  it('queues multiple actions and processes them sequentially', async () => {
    const p1 = channel.requestAction(PICK_ACTION);
    const p2 = channel.requestAction(CONFIRM_ACTION);

    // First action is pending immediately
    expect(channel.pendingAction).toMatchObject({ type: 'pick' });

    // Resolve first
    channel.resolveAction({ type: 'pick', item: { label: 'plan', value: 'plan' } });
    await p1;

    // Second action becomes pending after first resolves
    expect(channel.pendingAction).toMatchObject({ type: 'confirm' });

    // Resolve second
    channel.resolveAction({ type: 'confirm', confirmed: false });
    const r2 = await p2;
    expect(r2).toEqual({ type: 'confirm', confirmed: false });
    expect(channel.pendingAction).toBeNull();
  });

  it('calls onChange when pendingAction changes', () => {
    const onChange = vi.fn();
    channel.onChange = onChange;
    void channel.requestAction(PICK_ACTION);
    expect(onChange).toHaveBeenCalled();
  });
});
