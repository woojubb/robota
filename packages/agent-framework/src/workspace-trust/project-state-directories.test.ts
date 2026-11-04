import { describe, expect, it } from 'vitest';

import { snapshotProjectStateDirectories } from './project-state-directories.js';
import { WorkspaceAuthorityRequiredError } from './workspace-authority-required-error.js';

const directories = (root: string) => ({
  sessions: `${root}/sessions`,
  'session-logs': `${root}/logs`,
  memory: `${root}/memory`,
  checkpoints: `${root}/checkpoints`,
});

describe('snapshotProjectStateDirectories', () => {
  it('is undefined for no directories', () => {
    expect(snapshotProjectStateDirectories(undefined)).toBeUndefined();
  });

  // The CLI compares each storage root with the layout it built with `node:path`, string for string.
  // A Windows host's layout is `.robota\sessions`; the snapshot must hand back that spelling.
  it.each([
    ['POSIX', directories('.robota')],
    [
      'Windows',
      {
        sessions: '.robota\\sessions',
        'session-logs': '.robota\\logs',
        memory: '.robota\\memory',
        checkpoints: '.robota\\checkpoints',
      },
    ],
  ])('returns the %s-spelled directories exactly as supplied', (_platform, supplied) => {
    expect(snapshotProjectStateDirectories(supplied)).toEqual(supplied);
  });

  it('returns a spelling that mixes the separators as supplied', () => {
    const supplied = {
      sessions: '.x\\sessions',
      'session-logs': '.x/logs',
      memory: '.x\\a/memory',
      checkpoints: '.x/a\\checkpoints',
    };
    expect(snapshotProjectStateDirectories(supplied)).toEqual(supplied);
  });

  it('freezes the snapshot and does not follow later changes to the candidate', () => {
    const supplied = directories('.robota');
    const snapshot = snapshotProjectStateDirectories(supplied);
    supplied.sessions = 'elsewhere';
    expect(snapshot?.sessions).toBe('.robota/sessions');
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it.each([
    ['the same directory', { sessions: '.r/a', 'session-logs': '.r/a' }],
    ['one inside another', { sessions: '.r/a', 'session-logs': '.r/a/logs' }],
    ['one inside another the other way', { sessions: '.r/a/sessions', 'session-logs': '.r/a' }],
    ['the same directory in two spellings', { sessions: '.r\\a', 'session-logs': '.r/a' }],
    ['one inside another in two spellings', { memory: '.r/a', checkpoints: '.r\\a\\cp' }],
  ])('refuses directories that overlap: %s', (_label, overrides) => {
    expect(() =>
      snapshotProjectStateDirectories({
        sessions: '.r/s',
        'session-logs': '.r/l',
        memory: '.r/m',
        checkpoints: '.r/c',
        ...overrides,
      }),
    ).toThrow(/must not overlap/);
  });

  it('does not take a shared name prefix for an overlap', () => {
    expect(() =>
      snapshotProjectStateDirectories({
        sessions: '.r/a',
        'session-logs': '.r/ab',
        memory: '.r/m',
        checkpoints: '.r/c',
      }),
    ).not.toThrow();
  });

  it.each(['', '/abs', 'C:\\abs', '..\\up', 'a//b', 'a\\.\\b'])(
    'refuses the directory %j that is not root-relative',
    (sessions) => {
      expect(() => snapshotProjectStateDirectories({ ...directories('.r'), sessions })).toThrow(
        WorkspaceAuthorityRequiredError,
      );
    },
  );

  it('requires every namespace', () => {
    const { memory: _memory, ...partial } = directories('.r');
    expect(() =>
      snapshotProjectStateDirectories(partial as unknown as ReturnType<typeof directories>),
    ).toThrow(/required for memory/);
  });
});
