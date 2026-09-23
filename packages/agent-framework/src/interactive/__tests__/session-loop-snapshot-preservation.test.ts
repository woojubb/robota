import { describe, expect, it, vi } from 'vitest';

import { persistSession } from '../interactive-session-persistence.js';
import { loadSessionRecord } from '../interactive-session-restore.js';

import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';
import type { Session } from '@robota-sdk/agent-session';

describe('self-paced loop snapshot preservation', () => {
  it('does not erase the durable loop on an unrelated ordinary session snapshot', () => {
    const initial: IInteractiveSessionRecord = {
      id: 'session-1',
      cwd: '/work',
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:01:00.000Z',
      messages: [],
      sessionLoops: [
        {
          loopId: 'loop_stable',
          instruction: 'Check the build',
          createdAt: '2026-09-24T00:00:00.000Z',
          expiresAt: '2026-10-01T00:00:00.000Z',
          revision: 1,
          generation: 1,
          phase: 'waiting',
          nextAllowedAt: '2026-09-24T00:20:00.000Z',
          delaySeconds: 1200,
          reason: 'Waiting for CI',
          fallbackUsed: false,
        },
      ],
    };
    const save = vi.fn();
    const store = {
      load: vi.fn().mockReturnValue({ status: 'valid', record: initial }),
      save,
    } as unknown as IInteractiveSessionStore;
    const session = {
      getSessionId: () => initial.id,
      getHistory: () => [],
      getSystemMessage: () => 'prompt',
      getToolSchemas: () => [],
    } as unknown as Session;

    persistSession(store, session, undefined, initial.cwd, []);

    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0]?.[0] as IInteractiveSessionRecord).sessionLoops).toEqual(
      initial.sessionLoops,
    );
    expect(loadSessionRecord(store, initial.id, null).sessionLoops).toEqual(initial.sessionLoops);
  });
});
