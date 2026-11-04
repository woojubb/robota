import { describe, expect, it } from 'vitest';

import {
  assertContainedPath,
  PluginPathContainmentError,
  resolveContainedRelative,
} from '../plugin-paths.js';

import type { IFileSystem } from '@robota-sdk/agent-core';

/** A filesystem that holds the given paths and resolves no symlink, whatever platform they are for. */
function filesystemWith(...existing: string[]): IFileSystem {
  const held = new Set(existing);
  return {
    existsSync: (path: string) => held.has(path),
    realpathSync: (path: string) => path,
  } as unknown as IFileSystem;
}

describe('plugin path containment on both platforms, from the text of the paths', () => {
  it.each([
    ['/plugins', '/plugins', '/plugins'],
    ['/plugins', '/plugins/a/b', '/plugins/a/b'],
    ['/plugins', '/plugins/a/../b', '/plugins/b'],
    ['C:\\plugins', 'C:\\plugins', 'C:\\plugins'],
    ['C:\\plugins', 'C:\\plugins\\a\\b', 'C:\\plugins\\a\\b'],
    ['C:\\plugins\\', 'C:\\plugins\\a\\..\\b', 'C:\\plugins\\b'],
    ['C:/plugins', 'C:\\plugins\\x', 'C:\\plugins\\x'],
  ])('admits %j holding %j', (root, candidate) => {
    expect(() =>
      assertContainedPath(root, candidate, 'load', filesystemWith(root, candidate)),
    ).not.toThrow();
  });

  it.each([
    ['/plugins', '/plugins-evil'],
    ['/plugins', '/plugins/../other'],
    ['/plugins', '/'],
    ['C:\\plugins', 'C:\\plugins-evil'],
    ['C:\\plugins', 'C:\\plugins\\..\\other'],
    ['C:\\plugins', 'D:\\plugins\\a'],
    // The comparison stays case-sensitive: a root spelled in another case is not this root.
    ['C:\\plugins', 'c:\\PLUGINS\\a'],
  ])('refuses %j holding %j', (root, candidate) => {
    expect(() => assertContainedPath(root, candidate, 'load', filesystemWith(root))).toThrow(
      PluginPathContainmentError,
    );
  });

  it('walks up from a path that does not exist to the nearest one that does', () => {
    const fs = filesystemWith('C:\\plugins');
    expect(() =>
      assertContainedPath('C:\\plugins', 'C:\\plugins\\new\\deeper', 'copy', fs),
    ).not.toThrow();
    expect(() => assertContainedPath('C:\\plugins', 'C:\\elsewhere\\new', 'copy', fs)).toThrow(
      PluginPathContainmentError,
    );
  });

  it.each(['plugins', '.', '', 'C:plugins', '\\plugins'])(
    'refuses the path %j, which only the process directory could place, rather than walking up it',
    (path) => {
      expect(() => assertContainedPath(path, '/plugins/a', 'load', filesystemWith())).toThrow(
        PluginPathContainmentError,
      );
      expect(() => assertContainedPath('/plugins', path, 'load', filesystemWith())).toThrow(
        PluginPathContainmentError,
      );
    },
  );

  it.each([
    ['/plugins', 'a/b', '/plugins/a/b'],
    ['C:\\plugins', 'a\\b', 'C:\\plugins\\a\\b'],
    ['C:\\plugins', 'a/b', 'C:\\plugins\\a\\b'],
    ['C:\\plugins', './a', 'C:\\plugins\\a'],
  ])('resolves the relative source %j against %j', (root, relative, expected) => {
    expect(resolveContainedRelative(root, relative, 'load', filesystemWith(root))).toBe(expected);
  });

  // A source that names a root is refused on every platform, as its drive would come from elsewhere.
  it.each(['/etc', '\\etc', 'C:\\etc', 'c:/etc', '//server/share', '\\\\server\\share', '../escape'])(
    'refuses the source %j, which names a root or leaves the plugin root',
    (relative) => {
      expect(() =>
        resolveContainedRelative('/plugins', relative, 'load', filesystemWith('/plugins')),
      ).toThrow(PluginPathContainmentError);
    },
  );
});
