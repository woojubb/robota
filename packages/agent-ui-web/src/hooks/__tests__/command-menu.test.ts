import { describe, expect, it } from 'vitest';

import { commandMenuFor, COMMAND_MENU_LIMIT } from '../command-menu.js';

import type { TCommandCatalog } from '../session-client-types.js';

const catalog: TCommandCatalog = {
  commands: [
    { name: 'help', description: 'Show commands', modelInvocable: false },
    { name: 'mode', description: 'Change the permission mode', modelInvocable: false },
    { name: 'memory', description: 'Project memory', modelInvocable: true },
  ],
  skills: [
    { name: 'parity-demo', description: 'Demo', source: 'project', modelInvocable: true, userInvocable: true },
    { name: 'model-only', description: 'Hidden', source: 'project', modelInvocable: true, userInvocable: false },
  ],
};

describe('commandMenuFor (#3186)', () => {
  it('offers every command and user-invocable skill for a bare slash', () => {
    const menu = commandMenuFor(catalog, '/');
    expect(menu?.map((i) => i.name)).toEqual(['help', 'memory', 'mode', 'parity-demo']);
    expect(menu?.find((i) => i.name === 'parity-demo')?.kind).toBe('skill');
  });

  it('puts names that start with the query before names that contain it', () => {
    expect(commandMenuFor(catalog, '/m')?.map((i) => i.name)).toEqual(['memory', 'mode', 'parity-demo']);
  });

  it('closes once arguments are being typed, outside a slash, or when nothing matches', () => {
    expect(commandMenuFor(catalog, '/mode plan')).toBeNull();
    expect(commandMenuFor(catalog, 'hello')).toBeNull();
    expect(commandMenuFor(catalog, '/zzz')).toBeNull();
    expect(commandMenuFor(null, '/')).toBeNull();
  });

  it('shows at most the menu limit', () => {
    const many: TCommandCatalog = {
      commands: Array.from({ length: 20 }, (_, i) => ({ name: `c${i}`, description: '', modelInvocable: false })),
      skills: [],
    };
    expect(commandMenuFor(many, '/c')).toHaveLength(COMMAND_MENU_LIMIT);
  });
});
