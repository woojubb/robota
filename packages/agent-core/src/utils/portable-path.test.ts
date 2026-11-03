import { posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isAbsolutePath, joinPath, resolvePath } from './portable-path';

const POSIX_PATHS = [
  '/',
  '/a',
  '/a/b/',
  '/a/../b',
  '//a',
  'a',
  './a',
  '../a',
  'a/b',
  '',
  '.',
  '..',
];
const WINDOWS_PATHS = [
  'C:\\',
  'C:/',
  'c:\\a\\b',
  'C:/a/b/',
  '\\\\server\\share',
  '\\\\server\\share\\dir',
  '\\\\server',
  'C:a',
  'C:',
  '\\a',
  'a\\b',
  '.\\a',
  '..\\a',
];

describe('isAbsolutePath', () => {
  it.each(POSIX_PATHS)('agrees with path.posix on the POSIX path %j', (path) => {
    expect(isAbsolutePath(path)).toBe(posix.isAbsolute(path));
  });

  it.each(['C:\\', 'C:/', 'c:\\a\\b', 'C:/a/b/', '\\\\server\\share', 'a\\b', '.\\a', 'C:a', 'C:'])(
    'agrees with path.win32 on the Windows path %j',
    (path) => {
      expect(isAbsolutePath(path)).toBe(win32.isAbsolute(path));
    },
  );

  it.each(WINDOWS_PATHS.filter((path) => path.startsWith('\\') && !path.startsWith('\\\\')))(
    'does not take a drive-less rooted path such as %j for absolute: its drive comes from elsewhere',
    (path) => {
      expect(isAbsolutePath(path)).toBe(false);
    },
  );
});

describe('resolvePath', () => {
  const posixCases = [
    ['/repo', 'src/a.ts'],
    ['/repo', './src/a.ts'],
    ['/repo', '../other/a.ts'],
    ['/repo', 'a/../../b'],
    ['/repo', '../../../x'],
    ['/repo', '/etc/hosts'],
    ['/repo/', 'src//a/'],
    ['/', 'a'],
    ['/repo', 'a b/c\\d'],
    ['/repo', ''],
    ['/repo', '.'],
  ] as const;

  it.each(posixCases)('matches path.posix.resolve(%j, %j)', (base, relative) => {
    expect(resolvePath(base, relative)).toBe(posix.resolve(base, relative));
  });

  const win32Cases = [
    ['C:\\repo', 'src\\a.ts'],
    ['C:\\repo', 'src/a.ts'],
    ['C:\\repo', '.\\src\\a.ts'],
    ['C:\\repo', '..\\other\\a.ts'],
    ['C:\\repo', '..\\..\\..\\x'],
    ['C:\\repo', 'D:\\data\\a.ts'],
    ['C:\\repo', 'D:/data/a.ts'],
    ['C:\\repo', '\\x\\a.ts'],
    ['C:\\repo', '/x/a.ts'],
    ['C:/repo/', 'src//a\\'],
    ['c:\\repo', 'a'],
    ['C:\\', 'a'],
    ['\\\\server\\share\\dir', 'a\\b'],
    ['\\\\server\\share\\dir', '..\\..\\..\\a'],
    ['\\\\server\\share\\dir', '\\x'],
    ['C:\\repo', '\\\\server\\share\\a'],
    ['C:\\repo', ''],
  ] as const;

  it.each(win32Cases)('matches path.win32.resolve(%j, %j)', (base, relative) => {
    expect(resolvePath(base, relative)).toBe(win32.resolve(base, relative));
  });

  it('takes the flavour from the base, so a POSIX process resolves a Windows workspace path', () => {
    expect(resolvePath('C:\\work', 'a/b')).toBe('C:\\work\\a\\b');
  });

  it('treats a backslash as an ordinary character under a POSIX base', () => {
    expect(resolvePath('/work', 'a\\b')).toBe('/work/a\\b');
  });

  it('never anchors a relative base to the process directory', () => {
    expect(resolvePath('work', 'a/../b')).toBe('work/b');
    expect(resolvePath('..', '..')).toBe('../..');
  });
});

describe('joinPath', () => {
  const posixCases = [
    ['/a', 'b'],
    ['/a/', '/b/'],
    ['/a', '..', 'b'],
    ['/a', '../../b'],
    ['a', 'b'],
    ['a', '..', '..'],
    ['/a', 'b/'],
    ['/'],
    ['/a', '', 'b'],
    ['/a/b', 'c\\d'],
  ] as const;

  it.each(posixCases.map((segments) => [segments] as const))(
    'matches path.posix.join(%j)',
    (segments) => {
      expect(joinPath(...segments)).toBe(posix.join(...segments));
    },
  );

  const win32Cases = [
    ['C:\\a', 'b'],
    ['C:\\a\\', '\\b\\'],
    ['C:\\a', '..', 'b'],
    ['C:\\a', '..\\..\\b'],
    ['C:/a', 'b/c'],
    ['C:\\a', 'b\\'],
    ['\\\\server\\share', 'dir', 'f'],
    ['\\\\server\\share\\dir', '..', 'f'],
  ] as const;

  it.each(win32Cases.map((segments) => [segments] as const))(
    'matches path.win32.join(%j)',
    (segments) => {
      expect(joinPath(...segments)).toBe(win32.join(...segments));
    },
  );

  it('is "." for nothing at all', () => {
    expect(joinPath()).toBe('.');
    expect(joinPath('', '')).toBe('.');
  });
});
