import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactionOrchestrator } from '../compaction-orchestrator.js';

import type { IHookInput } from '@robota-sdk/agent-core';

const hookInputs: IHookInput[] = [];

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    runHooks: vi.fn().mockImplementation((_hooks, _event, input: IHookInput) => {
      hookInputs.push(input);
      return Promise.resolve({ blocked: false, stdout: '' });
    }),
  };
});

const provider = {
  name: 'offline-compaction-provider',
  chat: vi.fn().mockResolvedValue({
    role: 'assistant',
    content: 'summary',
    timestamp: new Date('2026-08-15T00:00:00.000Z'),
  }),
} as never;

const history = [
  {
    id: 'user-1',
    role: 'user',
    content: 'hello',
    state: 'complete',
    timestamp: new Date('2026-08-15T00:00:00.000Z'),
  },
] as never;

function createOrchestrator(): CompactionOrchestrator {
  return new CompactionOrchestrator({
    sessionId: 'session-trigger',
    cwd: '/tmp/arch-016',
    model: 'offline-model',
    hooks: { PreCompact: [] },
  });
}

describe('CompactionOrchestrator trigger ownership', () => {
  beforeEach(() => {
    hookInputs.length = 0;
  });

  it.each(['manual', 'auto'] as const)(
    'passes the explicit %s trigger unchanged to PreCompact',
    async (trigger) => {
      await createOrchestrator().compact(provider, history, undefined, undefined, trigger);

      expect(hookInputs.map((input) => input.trigger)).toEqual([trigger]);
    },
  );
});
