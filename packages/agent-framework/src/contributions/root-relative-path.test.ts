import { describe, expect, it } from 'vitest';

import { assertRootRelative } from './root-relative-path.js';

describe('assertRootRelative', () => {
  it.each(['a', 'a/b', 'a\\b', '.claude/skills/x', '.claude\\skills/x', 'a..b', '..a'])(
    'admits the root-relative path %j',
    (path) => {
      expect(() => assertRootRelative(path)).not.toThrow();
    },
  );

  // A Windows spelling is refused on every platform: the check cannot know which one will read it.
  it.each([
    '/x',
    '//server/share',
    '\\x',
    '\\\\server\\share',
    'C:\\x',
    'c:/x',
    '../x',
    'a/../b',
    'a\\..\\b',
    '..',
  ])('refuses the path %j, which names a root or leaves it', (path) => {
    expect(() => assertRootRelative(path)).toThrow(/Not a root-relative path/);
  });
});
