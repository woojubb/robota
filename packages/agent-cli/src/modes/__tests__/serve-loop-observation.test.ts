import { describe, expect, it } from 'vitest';

import { nextWaitingLoopAt } from '../serve-mode.js';

import type { ISessionLoopState } from '@robota-sdk/agent-interface-session';

const NOW = Date.parse('2026-09-24T00:00:00.000Z');

function loop(phase: ISessionLoopState['phase'], nextAllowedAt: string, expiresAt = '2026-09-25T00:00:00.000Z'): ISessionLoopState {
  return { phase, nextAllowedAt, expiresAt } as ISessionLoopState;
}

describe('supervised loop observation', () => {
  it('reports the earliest actual waiting eligibility without using running or expired loops', () => {
    expect(nextWaitingLoopAt([
      loop('running', '2026-09-24T00:01:00.000Z'),
      loop('waiting', '2026-09-24T00:05:00.000Z'),
      loop('waiting', '2026-09-24T00:02:00.000Z'),
      loop('waiting', '2026-09-24 00:00:30'),
      loop('waiting', '2026-09-24T00:00:30.000Z', '2026-09-23T23:59:00.000Z'),
    ], NOW)).toBe('2026-09-24T00:02:00.000Z');
    expect(nextWaitingLoopAt([loop('stopped', '2026-09-24T00:01:00.000Z')], NOW)).toBeUndefined();
  });
});
