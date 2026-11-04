import { posix, win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  basenamePath,
  dirnamePath,
  isAbsolutePath,
  isRootedPath,
  joinPath,
  relativePath,
  relativeSegments,
  resolvePath,
  separatorOf,
} from './portable-path';

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
    ['C:\\repo', '//server/share/a'],
    ['C:\\repo', 'C:a'],
    ['C:\\repo', 'c:..\\b'],
    ['C:\\repo', 'c:a'],
    ['c:\\repo', 'C:a'],
    ['C:\\repo', 'C:'],
    ['C:\\repo', 'C:\\'],
    ['C:\\repo', ''],
  ] as const;

  it.each(win32Cases)('matches path.win32.resolve(%j, %j)', (base, relative) => {
    expect(resolvePath(base, relative)).toBe(win32.resolve(base, relative));
  });

  it('leaves a path relative to another drive as given, since only a process knows its directory', () => {
    expect(resolvePath('C:\\repo', 'D:a')).toBe('D:a');
    expect(resolvePath('\\\\server\\share', 'D:a')).toBe('D:a');
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

/** The platform `node:path` would be asked, mirroring how the helpers read it from the text. */
const nodePathFor = (path: string) =>
  /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? win32 : posix;

/** A small deterministic generator, so the fuzz cases are the same on every run. */
function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SEGMENTS = ['a', 'B', 'b', 'A', 'ab', '..', '.', '', 'x y', 'a.md', '.md', 'md', '..a', 'é'];

function randomPath(next: () => number, roots: readonly string[], separators: readonly string[]) {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const count = Math.floor(next() * 5);
  let path = pick(roots);
  for (let index = 0; index < count; index += 1) {
    path += (path === '' || /[\\/]$/.test(path) ? '' : pick(separators)) + pick(SEGMENTS);
  }
  return next() < 0.15 ? path + pick(separators) : path;
}

const ALL_TABLE_PATHS = [...POSIX_PATHS, ...WINDOWS_PATHS];

describe('isRootedPath', () => {
  it.each([...ALL_TABLE_PATHS, '\\x', 'C:\\x', 'c:/x', '/x\\y', 'C:x', '1:\\x', 'é:\\x'])(
    'is posix.isAbsolute || win32.isAbsolute for %j',
    (path) => {
      expect(isRootedPath(path)).toBe(posix.isAbsolute(path) || win32.isAbsolute(path));
    },
  );

  it('counts the bare backslash root that isAbsolutePath leaves out', () => {
    expect(isRootedPath('\\x')).toBe(true);
    expect(isAbsolutePath('\\x')).toBe(false);
  });
});

describe('separatorOf', () => {
  it.each([
    ['/repo', '/'],
    ['C:\\repo', '\\'],
    ['C:/repo', '\\'],
    ['\\\\server\\share\\dir', '\\'],
  ])('is the separator %j is spelled with', (path, expected) => {
    expect(separatorOf(path)).toBe(expected);
  });
});

describe('dirnamePath', () => {
  const cases = [
    ...ALL_TABLE_PATHS,
    '/a/b/c',
    '/a/b/c/',
    '/a//b',
    '//',
    '///',
    '//a/b',
    'a/',
    'a//',
    'C:\\a\\b',
    'C:\\a\\b\\',
    'C:\\a',
    'C:/a/b',
    'C:\\a\\\\b',
    '\\\\server\\share\\',
    '\\\\server\\share\\a',
    '\\\\server\\share\\a\\b',
    '\\\\server\\share\\\\\\a',
    '\\\\server\\',
    '\\\\server',
    '\\\\\\a',
    'C:\\repo\\.claude\\settings.json',
    '/home/user/.robota/plugins/installed_plugins.json',
  ];

  it.each(cases)('matches the Node dirname of %j on its platform', (path) => {
    expect(dirnamePath(path)).toBe(nodePathFor(path).dirname(path));
  });

  it('matches Node on generated paths of both platforms', () => {
    const next = sequence(11);
    for (let index = 0; index < 4000; index += 1) {
      const path =
        index % 2 === 0
          ? randomPath(next, ['/', '//', ''], ['/', '//'])
          : randomPath(next, ['C:\\', 'c:/', '\\\\s\\h\\'], ['\\', '/', '\\\\']);
      expect(dirnamePath(path), JSON.stringify(path)).toBe(nodePathFor(path).dirname(path));
    }
  });
});

describe('basenamePath', () => {
  const cases = [
    ...ALL_TABLE_PATHS,
    '/a/b.md',
    '/a/b.md/',
    'b.md',
    '.md',
    'a/.md',
    'a/b/.md',
    '/a/.md/',
    'x.md.md',
    'md',
    '/',
    '//',
    'C:\\a\\b.md',
    'C:\\a\\b.md\\',
    'C:\\.md',
    'C:\\a\\.md',
    'C:/a/b.md',
    '\\\\server\\share\\a.md',
    '\\\\server\\share\\',
    'C:\\',
    'C:\\a',
  ];
  const suffixes = [undefined, '', '.md', 'md', '.mdx', 'b.md', '/a/b.md', 'C:\\a\\b.md', 'a', 'x'];

  it.each(cases.flatMap((path) => suffixes.map((suffix) => [path, suffix] as const)))(
    'matches the Node basename of %j with suffix %j on its platform',
    (path, suffix) => {
      expect(basenamePath(path, suffix)).toBe(nodePathFor(path).basename(path, suffix));
    },
  );

  it('matches Node on generated paths and suffixes of both platforms', () => {
    const next = sequence(23);
    for (let index = 0; index < 6000; index += 1) {
      const path =
        index % 2 === 0
          ? randomPath(next, ['/', ''], ['/', '//'])
          : randomPath(next, ['C:\\', 'c:/', '\\\\s\\h\\'], ['\\', '/']);
      const suffix = suffixes[Math.floor(next() * suffixes.length)];
      expect(basenamePath(path, suffix), `${JSON.stringify(path)} ${suffix}`).toBe(
        nodePathFor(path).basename(path, suffix),
      );
    }
  });
});

describe('relativePath and relativeSegments', () => {
  const posixPairs = [
    ['/repo', '/repo'],
    ['/repo', '/repo/src/a.ts'],
    ['/repo/src', '/repo'],
    ['/repo/src', '/repo/test'],
    ['/repo/a/b', '/other/c'],
    ['/', '/a'],
    ['/a', '/'],
    ['/', '/'],
    ['/repo/', '/repo//src/'],
    ['/repo/a/../b', '/repo/./b/c'],
    ['/repo', '/repo-two'],
    ['/repo/a', '/REPO/a'],
    ['/a/b', '/a/b/..'],
    ['//a', '/a/b'],
    ['/a\\b', '/a\\b/c'],
  ] as const;

  it.each(posixPairs)('matches path.posix.relative(%j, %j)', (from, to) => {
    expect(relativePath(from, to)).toBe(posix.relative(from, to));
    expect((relativeSegments(from, to) ?? []).join('/')).toBe(posix.relative(from, to));
  });

  const win32Pairs = [
    ['C:\\repo', 'C:\\repo'],
    ['C:\\repo', 'C:\\repo\\src\\a.ts'],
    ['C:\\repo\\src', 'C:\\repo'],
    ['C:\\repo\\src', 'C:\\repo\\test'],
    ['C:\\repo\\a\\b', 'C:\\other\\c'],
    ['C:\\', 'C:\\a'],
    ['C:\\a', 'C:\\'],
    ['C:\\', 'C:\\'],
    ['C:\\repo', 'c:\\REPO\\Src'],
    ['c:/repo/', 'C:\\repo\\src\\'],
    ['C:\\repo\\a\\..\\b', 'C:\\repo\\.\\b\\c'],
    ['C:\\repo', 'C:\\repo-two'],
    ['C:\\repo', 'D:\\repo\\a'],
    ['C:\\repo', 'D:/repo/a/'],
    ['C:\\repo', '\\\\server\\share\\a'],
    ['\\\\server\\share\\dir', '\\\\server\\share\\dir\\a\\b'],
    ['\\\\server\\share\\dir', '\\\\SERVER\\Share\\x'],
    ['\\\\server\\share', '\\\\server\\share'],
    ['\\\\server\\share\\a', 'C:\\a'],
    ['C:\\repo', '//server/share/a'],
  ] as const;

  it.each(win32Pairs)('matches path.win32.relative(%j, %j)', (from, to) => {
    expect(relativePath(from, to)).toBe(win32.relative(from, to));
    const segments = relativeSegments(from, to);
    if (segments !== undefined) expect(segments.join('\\')).toBe(win32.relative(from, to));
    else expect(win32.isAbsolute(win32.relative(from, to))).toBe(true);
  });

  it('matches Node on generated absolute paths of both platforms', () => {
    const next = sequence(37);
    for (let index = 0; index < 6000; index += 1) {
      const posixRun = index % 2 === 0;
      const roots = posixRun ? ['/'] : ['C:\\', 'c:/', 'D:\\', '\\\\s\\h\\'];
      const separators = posixRun ? ['/'] : ['\\', '/'];
      const from = randomPath(next, roots, separators);
      const to = randomPath(next, roots, separators);
      const node = posixRun ? posix : win32;
      expect(relativePath(from, to), `${JSON.stringify(from)} -> ${JSON.stringify(to)}`).toBe(
        node.relative(from, to),
      );
    }
  });

  it('reads two shares of one server as two roots, where Node sees sibling directories', () => {
    const from = '\\\\server\\share\\dir';
    const to = '\\\\server\\other\\x';
    expect(win32.relative(from, to)).toBe('..\\..\\other\\x');
    expect(relativeSegments(from, to)).toBeUndefined();
    expect(relativePath(from, to)).toBe(to);
  });

  it('answers a target on another platform with that target, normalised, and no segments', () => {
    expect(relativeSegments('/repo', 'C:\\a\\..\\b')).toBeUndefined();
    expect(relativePath('/repo', 'C:\\a\\..\\b')).toBe('C:\\b');
  });

  it.each([
    ['repo', '/repo'],
    ['/repo', 'src'],
    ['C:\\repo', 'src'],
    ['C:\\repo', '\\src'],
    ['C:repo', 'C:\\repo'],
    ['', '/repo'],
  ])('refuses %j to %j, which only the process directory could anchor', (from, to) => {
    expect(() => relativePath(from, to)).toThrow(TypeError);
    expect(() => relativeSegments(from, to)).toThrow(TypeError);
  });

  it('is empty for one path given twice, even relative, as Node answers', () => {
    expect(relativePath('src', 'src')).toBe(posix.relative('src', 'src'));
  });
});
