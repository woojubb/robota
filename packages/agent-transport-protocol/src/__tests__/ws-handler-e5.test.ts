import { describe, it, expect, vi } from 'vitest';

import { createWsHandler } from '../ws-handler.js';
import type { TServerMessage } from '../ws-protocol.js';
import type {
  IInteractiveSession,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';

/**
 * REMOTE-014 E5 TC-03/05 — the protocol layer: the SERVER-ASSIGNED driver id is injected into inbound
 * submit/command/prompt-response (a client cannot send its own), and turn-authored events are SELECTIVELY
 * stamped with the active turn's driver (background events are never stamped).
 */

function mockSession(activeDriverId: string | null) {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  return {
    submit: vi.fn().mockResolvedValue(undefined),
    executeCommand: vi.fn().mockResolvedValue({ message: 'ok', success: true }),
    resolvePermission: vi.fn(),
    resolveAsk: vi.fn(),
    getActiveDriverId: vi.fn().mockReturnValue(activeDriverId),
    on: (e: string, h: (...a: unknown[]) => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(h);
    },
    off: (e: string, h: (...a: unknown[]) => void) => listeners.get(e)?.delete(h),
    _emit: (e: string, ...a: unknown[]) => listeners.get(e)?.forEach((h) => h(...a)),
  } as unknown as IInteractiveSession & { _emit: (e: string, ...a: unknown[]) => void };
}

describe('ws-handler E5 driver attribution (REMOTE-014)', () => {
  it('TC-05: injects the SERVER-ASSIGNED driver id into submit + prompt-response (client cannot forge it)', () => {
    const session = mockSession(null);
    const { onMessage } = createWsHandler({
      session,
      send: () => {},
      driverId: 'device-42',
    });
    // A client submit frame carries NO driverId field (structurally — TClientMessage has none); the handler
    // injects the bound server id.
    onMessage(JSON.stringify({ type: 'submit', prompt: 'hi', driverId: 'spoofed' }));
    expect(session.submit as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'hi',
      undefined,
      undefined,
      {
        driverId: 'device-42',
      },
    );
    onMessage(JSON.stringify({ type: 'permission-response', id: 'p1', result: true }));
    expect(session.resolvePermission).toHaveBeenCalledWith('p1', true, 'device-42');
    onMessage(
      JSON.stringify({ type: 'ask-response', id: 'a1', response: { type: 'answer', answer: 'y' } }),
    );
    expect(session.resolveAsk).toHaveBeenCalledWith(
      'a1',
      { type: 'answer', answer: 'y' },
      'device-42',
    );
  });

  it('TC-03: SELECTIVELY stamps turn-authored events with the active driver; background events carry none', () => {
    const session = mockSession('driver-A');
    const sent: TServerMessage[] = [];
    createWsHandler({ session, send: (m) => sent.push(m) });

    session._emit('user_message', 'hello');
    session._emit('text_delta', 'chunk');
    session._emit('background_task_event', { type: 'noop' } as unknown as TBackgroundTaskEvent);

    const userMsg = sent.find((m) => m.type === 'user_message') as { driverId?: string };
    const textDelta = sent.find((m) => m.type === 'text_delta') as { driverId?: string };
    const bgEvent = sent.find((m) => m.type === 'background_task_event') as { driverId?: string };
    expect(userMsg.driverId).toBe('driver-A');
    expect(textDelta.driverId).toBe('driver-A');
    expect(bgEvent.driverId).toBeUndefined(); // background events are NOT turn-authored
  });

  it('TC-03: an unattributed (idle) turn stamps no driverId', () => {
    const session = mockSession(null); // getActiveDriverId → null
    const sent: TServerMessage[] = [];
    createWsHandler({ session, send: (m) => sent.push(m) });
    session._emit('user_message', 'hi');
    expect((sent[0] as { driverId?: string }).driverId).toBeUndefined();
  });
});
