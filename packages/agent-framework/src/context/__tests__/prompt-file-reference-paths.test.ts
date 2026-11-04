import { describe, expect, it } from 'vitest';

import { resolveProjectPromptStart } from '../prompt-file-reference-paths.js';

describe('resolveProjectPromptStart', () => {
  it.each([
    ['/repo', '/repo', ''],
    ['/repo', '/repo/src/app', 'src/app'],
    ['/repo', '/repo/src/../lib/', 'lib'],
    ['/repo/app', '/repo', '..'],
    ['C:\\repo', 'C:\\repo', ''],
    ['C:\\repo', 'C:\\repo\\src\\app', 'src\\app'],
    ['C:\\repo', 'c:/repo/src', 'src'],
  ])('starts a project at %j from the working directory %j as %j', (root, cwd, expected) => {
    expect(resolveProjectPromptStart(root, cwd)).toBe(expected);
  });

  it.each(['src', '.', '', 'C:src', '\\src'])(
    'refuses the working directory %j, which only the process directory could place',
    (cwd) => {
      expect(() => resolveProjectPromptStart('/repo', cwd)).toThrow(/must be absolute/);
    },
  );
});
