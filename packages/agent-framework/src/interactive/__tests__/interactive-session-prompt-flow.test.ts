/**
 * REMOTE-007 (B4-2a) — InteractiveSession transport-neutral permission/ask WIRING.
 *
 * The registry's parking/fail-closed/drain logic is unit-tested in session-prompt-registry.test.ts.
 * These tests prove the InteractiveSession glue: the ask default emits through the REAL session
 * emitter, `resolveAsk` settles the awaiting caller, the command-port PRESENCE gate (D4a) preserves
 * the headless `undefined` contract, and teardown/detach drain the parked prompts.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IAskRequestEvent, IPromptResolvedEvent } from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';

function createSessionStub(): Session {
  return {
    getSessionId: () => 'session_prompt',
    getHistory: () => [],
    getSystemMessage: () => 'system',
    getToolSchemas: () => [],
    getContextState: () => ({
      usedTokens: 0,
      maxTokens: 100,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    abort: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  } as unknown as Session;
}

describe('InteractiveSession transport-neutral ask flow (REMOTE-007)', () => {
  it('TC-04c: getUserInteraction() returns undefined with no ask_request listener (headless contract preserved)', () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    // No surface subscribed → the command port is ABSENT, so headless /exit, /clear, /mode proceed.
    expect(session.getUserInteraction()).toBeUndefined();
  });

  it('TC-04c: subscribing a surface to ask_request makes the command port PRESENT (per-call gate)', () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    const handler = (): void => {};
    session.on('ask_request', handler);
    expect(session.getUserInteraction()).toBeDefined();
    // Detaching the only surface reverts to absent — evaluated per call.
    session.off('ask_request', handler);
    expect(session.getUserInteraction()).toBeUndefined();
  });

  it('the command-port ask emits ask_request through the real emitter and resolveAsk settles it', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    const asks: IAskRequestEvent[] = [];
    session.on('ask_request', (event) => asks.push(event));

    const port = session.getUserInteraction();
    expect(port).toBeDefined();
    const pending = port!.ask({
      id: 'req-1',
      title: 'Proceed?',
      options: [{ value: 'y', label: 'Yes' }],
    });

    expect(asks).toHaveLength(1);
    expect(asks[0]!.request.title).toBe('Proceed?');

    session.resolveAsk(asks[0]!.id, { type: 'answer', values: ['y'] });
    await expect(pending).resolves.toEqual({ type: 'answer', values: ['y'] });
  });

  it('reconcile-on-detach: a parked ask cancels when the last surface unsubscribes mid-prompt', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    const handler = (): void => {};
    session.on('ask_request', handler);

    const pending = session.getUserInteraction()!.ask({ id: 'r', title: 't' });
    session.off('ask_request', handler); // surface disconnects before answering
    await expect(pending).resolves.toEqual({ type: 'cancelled' });
  });

  it('TC-03c: abort() drains a parked ask (the awaiting caller settles cancelled — no hang)', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    const resolved: IPromptResolvedEvent[] = [];
    session.on('ask_request', () => {});
    session.on('prompt_resolved', (event) => resolved.push(event));

    const pending = session.getUserInteraction()!.ask({ id: 'r', title: 't' });
    session.abort();
    await expect(pending).resolves.toEqual({ type: 'cancelled' });
    expect(resolved).toHaveLength(1);
  });

  it('TC-03c: cancelQueue() also drains parked prompts', async () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    session.on('ask_request', () => {});
    const pending = session.getUserInteraction()!.ask({ id: 'r', title: 't' });
    session.cancelQueue();
    await expect(pending).resolves.toEqual({ type: 'cancelled' });
  });

  it('resolvePermission/resolveAsk for an unknown id are safe no-ops', () => {
    const session = new InteractiveSession({ session: createSessionStub() });
    expect(() => session.resolvePermission('nope', true)).not.toThrow();
    expect(() => session.resolveAsk('nope', { type: 'cancelled' })).not.toThrow();
  });
});
