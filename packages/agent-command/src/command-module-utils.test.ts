import { describe, expect, it } from 'vitest';

import { createSystemCommandFromEntry } from './command-module-utils.js';

const behavior = {
  lifecycle: 'inline',
  requiresPermission: false,
  execute: () => ({ success: true, message: 'ran' }),
} as const;

describe('createSystemCommandFromEntry', () => {
  it('#3189: carries where the entry says it runs, so the catalog and the palette agree', () => {
    const command = createSystemCommandFromEntry(
      {
        name: 'local',
        description: 'Runs on the terminal',
        source: 'test',
        runner: 'client',
        surfaces: ['terminal'],
      },
      behavior,
    );

    expect(command.runner).toBe('client');
    expect(command.surfaces).toEqual(['terminal']);
  });

  it('leaves an unstated placement unstated rather than guessing one', () => {
    const command = createSystemCommandFromEntry(
      { name: 'plain', description: 'Runs on the runtime', source: 'test' },
      behavior,
    );

    expect('runner' in command).toBe(false);
    expect('surfaces' in command).toBe(false);
  });
});
