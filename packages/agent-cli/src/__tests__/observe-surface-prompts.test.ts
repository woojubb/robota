/**
 * A read-only observer attached to a real session must leave its prompt posture unchanged: with only
 * observers attached, a permission or ask request fails closed at once instead of parking for a
 * surface that is not allowed to answer.
 */

import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createOutboundDelivery, createSessionMessageHandler } from '@robota-sdk/agent-transport';
import { describe, expect, it, vi } from 'vitest';

import type { TServerMessage } from '@robota-sdk/agent-transport';

function createRuntimeSession(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({ maxTokens: 100, usedTokens: 0, usedPercentage: 0, remainingPercentage: 100 }),
    getSessionId: () => 'session_observe',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

interface IPromptRegistry {
  requestPermission(name: string, args: never): Promise<boolean>;
  requestAsk(request: { id: string; title: string }): Promise<unknown>;
}

function setup(): { session: InteractiveSession; registry: IPromptRegistry } {
  const session = new InteractiveSession({ session: createRuntimeSession() as never, cwd: '/tmp' });
  const registry = (session as unknown as { promptRegistry: IPromptRegistry }).promptRegistry;
  return { session, registry };
}

function attach(session: InteractiveSession, role: 'drive' | 'observe', driverId: string) {
  const sent: TServerMessage[] = [];
  const handler = createSessionMessageHandler({
    session,
    role,
    driverId,
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
  });
  return { sent, ...handler };
}

describe('observer prompt posture on a real session', () => {
  it('denies a permission and cancels an ask at once when only an observer is attached', async () => {
    const { session, registry } = setup();
    const observer = attach(session, 'observe', 'attach:1');
    await expect(registry.requestPermission('Bash', {} as never)).resolves.toBe(false);
    await expect(registry.requestAsk({ id: 'r', title: 'Pick' })).resolves.toEqual({ type: 'cancelled' });
    expect(session.getLocalActivityStatus()).toBe('idle');
    expect(session.getUserInteraction()).toBeUndefined();
    expect(observer.sent.some((message) => message.type === 'permission_request')).toBe(false);
    observer.cleanup();
  });

  it('lets only the drive surface answer, and denies when the last drive surface detaches', async () => {
    const { session, registry } = setup();
    const drive = attach(session, 'drive', 'attach:1');
    const observer = attach(session, 'observe', 'attach:2');

    const first = registry.requestPermission('Bash', {} as never);
    const request = drive.sent.find((message) => message.type === 'permission_request');
    expect(request?.type).toBe('permission_request');
    const id = request?.type === 'permission_request' ? request.event.id : '';
    expect(observer.sent.some((message) => message.type === 'permission_request')).toBe(false);
    expect(session.getLocalActivityStatus()).toBe('needs-input');

    observer.onMessage(JSON.stringify({ type: 'permission-response', id, result: true }));
    expect(session.getLocalActivityStatus()).toBe('needs-input');
    drive.onMessage(JSON.stringify({ type: 'permission-response', id, result: true }));
    await expect(first).resolves.toBe(true);
    expect(observer.sent).toContainEqual(
      expect.objectContaining({ type: 'prompt_resolved', event: expect.objectContaining({ id }) }),
    );

    const second = registry.requestPermission('Bash', {} as never);
    drive.cleanup();
    await expect(second).resolves.toBe(false);
    observer.cleanup();
  });
});
