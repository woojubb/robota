import { describe, expect, it } from 'vitest';

import { commandMenuFor, COMMAND_MENU_VISIBLE_ROWS } from '../command-menu.js';

import type { TCommandCatalog } from '../session-client-types.js';

const catalog: TCommandCatalog = {
  commands: [
    { name: 'help', description: 'Show commands', modelInvocable: false, runner: 'runtime' },
    { name: 'mode', description: 'Change the permission mode', modelInvocable: false, runner: 'runtime' },
    { name: 'memory', description: 'Project memory', modelInvocable: true, runner: 'runtime' },
    { name: 'shell', description: 'Open a shell', modelInvocable: false, runner: 'client', surfaces: ['terminal'] },
    { name: 'theme', description: 'Change the theme', modelInvocable: false, runner: 'client', surfaces: ['terminal'] },
  ],
  skills: [
    { name: 'parity-demo', description: 'Demo', source: 'project', modelInvocable: true, userInvocable: true },
    { name: 'model-only', description: 'Hidden', source: 'project', modelInvocable: true, userInvocable: false },
  ],
};

describe('commandMenuFor (#3186, #3282 §4e)', () => {
  it('offers every runnable command and user-invocable skill for a bare slash, excluding what the GUI cannot run', () => {
    const menu = commandMenuFor(catalog, '/');
    expect(menu?.map((i) => i.name)).toEqual(['help', 'memory', 'mode', 'parity-demo']);
    expect(menu?.find((i) => i.name === 'parity-demo')?.kind).toBe('skill');
  });

  it('leaves an excluded command out of the menu entirely — no badge, no row', () => {
    const menu = commandMenuFor(catalog, '/');
    expect(menu?.some((i) => i.name === 'shell')).toBe(false);
    expect(menu?.some((i) => i.name === 'theme')).toBe(false);
    // A query that matches only an excluded command finds nothing — not the excluded row itself.
    expect(commandMenuFor(catalog, '/she')).toBeNull();
  });

  it('puts names that start with the query before names that contain it, within a group', () => {
    expect(commandMenuFor(catalog, '/m')?.map((i) => i.name)).toEqual(['memory', 'mode', 'parity-demo']);
  });

  it('closes once arguments are being typed, outside a slash, or when nothing matches', () => {
    expect(commandMenuFor(catalog, '/mode plan')).toBeNull();
    expect(commandMenuFor(catalog, 'hello')).toBeNull();
    expect(commandMenuFor(catalog, '/zzz')).toBeNull();
    expect(commandMenuFor(null, '/')).toBeNull();
  });

  it('puts every command before every skill, even when a skill would outrank a command alphabetically', () => {
    const mixed: TCommandCatalog = {
      commands: [{ name: 'zzz-command', description: '', modelInvocable: false, runner: 'runtime' }],
      skills: [
        { name: 'aaa-skill', description: '', source: 'project', modelInvocable: true, userInvocable: true },
      ],
    };
    expect(commandMenuFor(mixed, '/')?.map((i) => `${i.kind}:${i.name}`)).toEqual([
      'command:zzz-command',
      'skill:aaa-skill',
    ]);
  });

  it('scrolls beyond the visible rows instead of truncating the match list', () => {
    const many: TCommandCatalog = {
      commands: Array.from({ length: 20 }, (_, i) => ({
        name: `c${i}`,
        description: '',
        modelInvocable: false,
        runner: 'runtime' as const,
      })),
      skills: [],
    };
    const menu = commandMenuFor(many, '/c');
    expect(menu).toHaveLength(20);
    expect(menu!.length).toBeGreaterThan(COMMAND_MENU_VISIBLE_ROWS);
  });
});
