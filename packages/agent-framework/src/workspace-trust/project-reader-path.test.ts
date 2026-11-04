import { describe, expect, it } from 'vitest';

import {
  isWorkspacePathContained,
  workspaceContributionKind,
  workspacePathSegments,
} from './project-reader-path.js';

describe('isWorkspacePathContained', () => {
  it.each([
    ['/repo', '/repo'],
    ['/repo', '/repo/src/a.ts'],
    ['/repo/', '/repo//src/./a.ts'],
    ['/repo', '/repo/..a/b'],
    ['C:\\repo', 'C:\\repo'],
    ['C:\\repo', 'C:\\repo\\src\\a.ts'],
    ['C:\\repo', 'c:\\REPO\\src'],
    ['C:/repo', 'C:\\repo\\a\\..\\b'],
    ['\\\\server\\share\\repo', '\\\\server\\share\\repo\\a'],
  ])('holds %j to contain %j', (root, candidate) => {
    expect(isWorkspacePathContained(root, candidate)).toBe(true);
  });

  it.each([
    ['/repo', '/'],
    ['/repo', '/repo-two'],
    ['/repo', '/repo/../other'],
    ['/repo/src', '/repo'],
    ['C:\\repo', 'C:\\repo-two'],
    ['C:\\repo', 'C:\\repo\\..\\other'],
    ['C:\\repo', 'D:\\repo\\a'],
    ['C:\\repo', '\\\\server\\share\\repo'],
    ['\\\\server\\share\\repo', '\\\\server\\other\\repo'],
    ['/repo', 'C:\\repo'],
  ])('does not hold %j to contain %j', (root, candidate) => {
    expect(isWorkspacePathContained(root, candidate)).toBe(false);
  });

  it.each([
    ['/repo', 'src'],
    ['/repo', ''],
    ['repo', '/repo'],
    ['C:\\repo', '\\repo\\a'],
    ['C:\\repo', 'repo'],
  ])('does not hold %j to contain %j, which only the process directory could place', (root, candidate) => {
    expect(isWorkspacePathContained(root, candidate)).toBe(false);
  });
});

describe('workspacePathSegments', () => {
  it('splits on either separator', () => {
    expect(workspacePathSegments('a/b\\c')).toEqual(['a', 'b', 'c']);
  });

  it.each(['/x', '\\x', 'C:\\x', 'c:/x', '//server/share', '\\\\server\\share', 'a\0b', ''])(
    'refuses %j as a path that is not root-relative',
    (value) => {
      expect(() => workspacePathSegments(value)).toThrow(/root-relative path/);
    },
  );

  it('reads an empty path as the root only when asked', () => {
    expect(workspacePathSegments('', true)).toEqual([]);
  });
});

describe('workspaceContributionKind', () => {
  const metadata = (kind: 'link' | 'file' | 'directory' | 'other') => ({
    isSymbolicLink: () => kind === 'link',
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'directory',
  });

  it.each(['link', 'file', 'directory', 'other'] as const)('classifies a %s', (kind) => {
    expect(workspaceContributionKind(metadata(kind))).toBe(kind);
  });
});
