import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { withChildSession } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pair = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock('@robota-sdk/agent-local-host', async (loadOriginal) => ({
  ...(await loadOriginal<typeof import('@robota-sdk/agent-local-host')>()),
  answerHandedOverSpawnerPair: pair.answer,
}));

import { answerSpawnerPairOrExit, SUPERVISED_SPAWNER_PAIR_FLAG } from '../secure-runtime-startup.js';

afterEach(() => {
  vi.restoreAllMocks();
  pair.answer.mockReset();
  resetChildSessionsForTesting();
});

describe('spawner descriptor handover', () => {
  it('holds child spawn paths while reading the handed-over pair and releases afterward', () => {
    const identity = createRuntimeIdentity();
    pair.answer.mockImplementation(() => {
      expect(() => withChildSession({})).toThrow(/spawn.*handover/iu);
      return identity;
    });

    expect(answerSpawnerPairOrExit(['node', 'cli', SUPERVISED_SPAWNER_PAIR_FLAG])).toBe(identity);
    expect(withChildSession({})).toEqual({});
  });

  it('releases the hold when an unsuccessful handover exits', () => {
    pair.answer.mockImplementation(() => { throw new Error('pair failed'); });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

    expect(() => answerSpawnerPairOrExit(['node', 'cli', SUPERVISED_SPAWNER_PAIR_FLAG])).toThrow('exit');
    expect(withChildSession({})).toEqual({});
  });
});
