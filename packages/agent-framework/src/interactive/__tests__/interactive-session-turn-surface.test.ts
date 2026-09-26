import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

function runtime(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({ maxTokens: 100, usedTokens: 0, usedPercentage: 0, remainingPercentage: 100 }),
    getSessionId: () => 'session_surface',
    getModelId: () => 'test-model',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

describe('the surface a turn was accepted on', () => {
  it('is recorded on the turn usage observation, independently of the driver id', async () => {
    const session = new InteractiveSession({ session: runtime() as never, cwd: '/tmp' });
    for (const surface of ['remote', 'attach'] as const) {
      await (await session.submit('hello', undefined, undefined, { driverId: 'device-1', surface })).completed;
    }
    const surfaces = session.getFullHistory()
      .filter((entry) => entry.type === 'usage-observation')
      .map((entry) => (entry.data as { surface?: string }).surface);
    expect(surfaces).toEqual(['remote', 'attach']);
  });
});
