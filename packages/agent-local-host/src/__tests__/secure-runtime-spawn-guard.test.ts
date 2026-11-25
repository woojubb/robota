import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { withChildSession } from '@robota-sdk/agent-core/node';
import { resetChildSessionsForTesting } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pair = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock('../supervised-spawner-pair.js', async (loadOriginal) => ({
  ...(await loadOriginal<typeof import('../supervised-spawner-pair.js')>()),
  answerHandedOverSpawnerPair: pair.answer,
}));

import { answerSpawnerPairOrExit } from '../secure-runtime-startup.js';
import { SUPERVISED_SPAWNER_PAIR_FLAG } from '../supervised-spawner-pair.js';

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
