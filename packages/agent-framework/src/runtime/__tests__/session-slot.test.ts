/**
 * #3189 — the session slot: one stable session object whose calls, listeners and switch notice
 * follow whichever session is current.
 */

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { SESSION_CAPABILITY_MEMBER_KEYS } from '@robota-sdk/agent-interface-session';
import { describe, expect, it, vi } from 'vitest';

import { SessionSlot } from '../session-slot.js';

import type {
  IInteractiveSession,
  IInteractiveSessionEvents,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

type THandler = (...args: unknown[]) => void;

interface IEmittingSession extends IInteractiveSession {
  emit(event: TInteractiveEventName, ...args: unknown[]): void;
  listenerCount(): number;
}

function emittingSession(
  id: string,
  overrides: Partial<IInteractiveSession> = {},
): IEmittingSession {
  const listeners = new Map<TInteractiveEventName, Set<THandler>>();
  const session = createTestInteractiveSession({
    getSession: () => ({ getSessionId: () => id }),
    shutdown: vi.fn(async () => undefined),
    on: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler as THandler);
    },
    off: (event, handler) => {
      listeners.get(event)?.delete(handler as THandler);
    },
    ...overrides,
  });
  return Object.assign(session, {
    emit: (event: TInteractiveEventName, ...args: unknown[]) => {
      for (const handler of listeners.get(event) ?? []) handler(...args);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  });
}

describe('SessionSlot (#3189)', () => {
  it('moves registered listeners onto the replacing session', async () => {
    const first = emittingSession('s-1');
    const second = emittingSession('s-2');
    const slot = new SessionSlot<IEmittingSession>(first);
    const onText = vi.fn();
    slot.on('text_delta', onText);

    await slot.replace(second);

    first.emit('text_delta', 'old');
    second.emit('text_delta', 'new');
    expect(onText.mock.calls).toEqual([['new']]);
    expect(first.listenerCount()).toBe(0);
  });

  it('does not move a listener that was removed before the replace', async () => {
    const first = emittingSession('s-1');
    const second = emittingSession('s-2');
    const slot = new SessionSlot<IEmittingSession>(first);
    const onText = vi.fn();
    slot.on('text_delta', onText);
    slot.off('text_delta', onText);

    await slot.replace(second);

    second.emit('text_delta', 'new');
    expect(onText).not.toHaveBeenCalled();
  });

  it('shuts the replaced session down and makes the next one current', async () => {
    const first = emittingSession('s-1');
    const second = emittingSession('s-2');
    const slot = new SessionSlot<IEmittingSession>(first);

    await slot.replace(second);

    expect(first.shutdown).toHaveBeenCalledTimes(1);
    expect(second.shutdown).not.toHaveBeenCalled();
    expect(slot.current).toBe(second);
    expect(slot.getSession().getSessionId()).toBe('s-2');
  });

  it("emits session_switched with the new session's id to the slot's listeners", async () => {
    const slot = new SessionSlot<IEmittingSession>(emittingSession('s-1'));
    const onSwitched = vi.fn<IInteractiveSessionEvents['session_switched']>();
    slot.on('session_switched', onSwitched);

    await slot.replace(emittingSession('s-2'));

    expect(onSwitched).toHaveBeenCalledTimes(1);
    expect(onSwitched).toHaveBeenCalledWith({ sessionId: 's-2' });
  });

  it('still switches when the old session never finishes shutting down', async () => {
    const wedged = emittingSession('s-1', { shutdown: () => new Promise<void>(() => undefined) });
    const slot = new SessionSlot<IEmittingSession>(wedged, { shutdownTimeoutMs: 10 });
    const onSwitched = vi.fn();
    slot.on('session_switched', onSwitched);

    await slot.replace(emittingSession('s-2'));

    expect(onSwitched).toHaveBeenCalledWith({ sessionId: 's-2' });
  });

  it('moveTo leaves the previous session running for whoever else is on it', () => {
    const shared = emittingSession('s-1');
    const next = emittingSession('s-2');
    const moving = new SessionSlot<IEmittingSession>(shared);
    const staying = new SessionSlot<IEmittingSession>(shared);
    const movingText = vi.fn();
    const stayingText = vi.fn();
    moving.on('text_delta', movingText);
    staying.on('text_delta', stayingText);

    moving.moveTo(next);

    expect(shared.shutdown).not.toHaveBeenCalled();
    expect(moving.current).toBe(next);
    expect(staying.current).toBe(shared);
    shared.emit('text_delta', 'on-shared');
    next.emit('text_delta', 'on-next');
    expect(movingText.mock.calls).toEqual([['on-next']]);
    expect(stayingText.mock.calls).toEqual([['on-shared']]);
  });

  it('moveTo tells only its own slot that the session switched', () => {
    const shared = emittingSession('s-1');
    const moving = new SessionSlot<IEmittingSession>(shared);
    const staying = new SessionSlot<IEmittingSession>(shared);
    const movingSwitched = vi.fn<IInteractiveSessionEvents['session_switched']>();
    const stayingSwitched = vi.fn<IInteractiveSessionEvents['session_switched']>();
    moving.on('session_switched', movingSwitched);
    staying.on('session_switched', stayingSwitched);

    moving.moveTo(emittingSession('s-2'));
    moving.moveTo(moving.current);

    expect(movingSwitched.mock.calls).toEqual([[{ sessionId: 's-2' }]]);
    expect(stayingSwitched).not.toHaveBeenCalled();
  });

  it('forwards every contract member to the current session', async () => {
    const first = emittingSession('s-1');
    const second = emittingSession('s-2');
    const slot = new SessionSlot<IEmittingSession>(first);
    await slot.replace(second);

    const forwarded = Object.values(SESSION_CAPABILITY_MEMBER_KEYS)
      .flat()
      .filter((key) => !['on', 'off', 'isInitialized', 'shutdown'].includes(key));
    for (const key of forwarded) {
      const spy = vi.fn(() => `from-${key}`);
      (second as unknown as Record<string, unknown>)[key] = spy;
      const member = (slot as unknown as Record<string, (...args: unknown[]) => unknown>)[key]!;
      expect(member('arg'), key).toBe(`from-${key}`);
      expect(spy, key).toHaveBeenCalledWith('arg');
    }

    await slot.shutdown({ message: 'bye' });
    expect(second.shutdown).toHaveBeenCalledWith({ message: 'bye' });
  });
});
