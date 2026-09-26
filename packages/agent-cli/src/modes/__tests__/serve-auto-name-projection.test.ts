import { describe, expect, it } from 'vitest';

import { buildServeSessionOptions } from '../serve-mode.js';

describe('served session naming', () => {
  it('builds sessions that name themselves, so a daemon and its pool name their own sessions', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
    } as never);

    expect(options.autoName).toBe(true);
  });
});
