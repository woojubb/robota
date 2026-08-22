import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { ADVISORY_MARKER, extractAdvisories } from '../run-all-scans.mjs';
import {
  collectInstalledCopies,
  findBelowMinimumDeclarations,
  findBelowMinimumInstalled,
  findLegacyDependencies,
  findLegacyImportsInSource,
  gitTrackedFiles,
  formatNotices,
  installedMajor,
  lowestMajorAdmitted,
} from '../scan-legacy-typescript.mjs';

const FILE = 'scripts/probe.mjs';

/** Whether this host permits creating a directory symlink (Windows needs Developer Mode or admin). */
const CAN_SYMLINK = (() => {
  const probe = makeTemp('legacy-ts-symlink-probe-');
  try {
    mkdirSync(path.join(probe, 'target'));
    symlinkSync(path.join(probe, 'target'), path.join(probe, 'link'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

describe('scan-legacy-typescript — import edge FAIL cases', () => {
  it('flags a default import of the legacy compiler', () => {
    const hits = findLegacyImportsInSource("import ts from 'typescript';\n", FILE);
    expect(hits).toEqual([{ line: 1, specifier: 'typescript' }]);
  });

  it('flags a namespace import', () => {
    const hits = findLegacyImportsInSource("import * as ts from 'typescript';\n", FILE);
    expect(hits).toHaveLength(1);
  });

  it('flags a named import', () => {
    const hits = findLegacyImportsInSource(
      "import { createSourceFile } from 'typescript';\n",
      FILE,
    );
    expect(hits).toHaveLength(1);
  });

  it('flags a deep import', () => {
    const hits = findLegacyImportsInSource(
      "import x from 'typescript/lib/tsserverlibrary';\n",
      FILE,
    );
    expect(hits[0].specifier).toBe('typescript/lib/tsserverlibrary');
  });

  it('flags a re-export', () => {
    const hits = findLegacyImportsInSource("export { SyntaxKind } from 'typescript';\n", FILE);
    expect(hits).toHaveLength(1);
  });

  it('flags a dynamic import', () => {
    const hits = findLegacyImportsInSource("const ts = await import('typescript');\n", FILE);
    expect(hits).toHaveLength(1);
  });

  it('flags a require call', () => {
    const hits = findLegacyImportsInSource("const ts = require('typescript');\n", FILE);
    expect(hits).toHaveLength(1);
  });

  it('reports the correct line for an import below other code', () => {
    const source = [
      '// header',
      "import path from 'node:path';",
      '',
      "import ts from 'typescript';",
      '',
    ].join('\n');
    expect(findLegacyImportsInSource(source, FILE)[0].line).toBe(4);
  });
});

describe('scan-legacy-typescript — import edge PASS cases (no false positives)', () => {
  it('does not flag the ESLint toolchain, whose name merely starts with the package name', () => {
    const source = "import { parser } from '@typescript-eslint/parser';\n";
    expect(findLegacyImportsInSource(source, FILE)).toEqual([]);
  });

  it('does not flag the native compiler the adapter uses', () => {
    const source = "import { SyntaxKind } from '@typescript/native-preview/unstable/ast';\n";
    expect(findLegacyImportsInSource(source, FILE)).toEqual([]);
  });

  it('does not flag the adapter itself', () => {
    const source = "import * as ts from './lib/ts-ast.mjs';\n";
    expect(findLegacyImportsInSource(source, FILE)).toEqual([]);
  });

  it('does not flag the word in prose or a string literal', () => {
    const source = [
      '// we no longer depend on typescript, the legacy compiler',
      "const label = 'typescript';",
      "const nested = { note: 'migrated off typescript' };",
      '',
    ].join('\n');
    expect(findLegacyImportsInSource(source, FILE)).toEqual([]);
  });

  it('does not flag a local module whose path merely contains the word', () => {
    const source = "import x from './typescript-helpers.mjs';\n";
    expect(findLegacyImportsInSource(source, FILE)).toEqual([]);
  });
});

describe('scan-legacy-typescript — dependency edge', () => {
  it('finds the dependency in each manifest section', () => {
    expect(findLegacyDependencies({ dependencies: { typescript: '^5.9.3' } })).toEqual([
      'dependencies',
    ]);
    expect(findLegacyDependencies({ devDependencies: { typescript: '^5.9.3' } })).toEqual([
      'devDependencies',
    ]);
    expect(findLegacyDependencies({ peerDependencies: { typescript: '^5.9.3' } })).toEqual([
      'peerDependencies',
    ]);
  });

  it('reports every section that declares it', () => {
    const manifest = {
      dependencies: { typescript: '^5.9.3' },
      devDependencies: { typescript: '^5.9.3' },
    };
    expect(findLegacyDependencies(manifest)).toEqual(['dependencies', 'devDependencies']);
  });

  it('does not confuse the native compiler or the ESLint toolchain for the legacy package', () => {
    const manifest = {
      devDependencies: {
        '@typescript/native-preview': '7.0.0-dev.20260707.2',
        '@typescript-eslint/parser': '^7.18.0',
      },
    };
    expect(findLegacyDependencies(manifest)).toEqual([]);
  });

  it('is clean for a manifest with no dependency sections at all', () => {
    expect(findLegacyDependencies({})).toEqual([]);
  });
});

describe('scan-legacy-typescript — PERF-006 version floor (lowestMajorAdmitted)', () => {
  it('reads the floor off every lower-bound operator', () => {
    expect(lowestMajorAdmitted('^6.0.3')).toBe(6);
    expect(lowestMajorAdmitted('~6.0.0')).toBe(6);
    expect(lowestMajorAdmitted('>=6.0.3')).toBe(6);
    expect(lowestMajorAdmitted('>6.0.0')).toBe(6);
    expect(lowestMajorAdmitted('=6.0.3')).toBe(6);
    expect(lowestMajorAdmitted('6.0.3')).toBe(6);
    expect(lowestMajorAdmitted('v6.0.3')).toBe(6);
    expect(lowestMajorAdmitted('6')).toBe(6);
  });

  it('reads the floor off the 5.x ranges this repo actually carried before the bump', () => {
    // The five distinct ranges the 97 manifests declared, measured before PERF-006 edited them.
    expect(lowestMajorAdmitted('^5.9.3')).toBe(5);
    expect(lowestMajorAdmitted('^5.3.3')).toBe(5);
    expect(lowestMajorAdmitted('^5.5.0')).toBe(5);
    expect(lowestMajorAdmitted('^5.7.3')).toBe(5);
    expect(lowestMajorAdmitted('^5.7.2')).toBe(5);
  });

  it('takes the LOWEST alternative of a union, because either side can be resolved', () => {
    expect(lowestMajorAdmitted('^5.0.0 || ^6.0.0 || ^7.0.0')).toBe(5);
    expect(lowestMajorAdmitted('^6.0.0 || ^7.0.0')).toBe(6);
  });

  it('treats a comparator set with no lower bound as admitting anything', () => {
    expect(lowestMajorAdmitted('*')).toBe(0);
    expect(lowestMajorAdmitted('x')).toBe(0);
    expect(lowestMajorAdmitted('<7.0.0')).toBe(0);
    expect(lowestMajorAdmitted('<=6.9.9')).toBe(0);
  });

  it('uses the tightest lower bound within one comparator set', () => {
    // typescript-eslint v8's published peer range — its floor is 4, not 6.
    expect(lowestMajorAdmitted('>=4.8.4 <6.1.0')).toBe(4);
    expect(lowestMajorAdmitted('>=6.0.0 <7.0.0')).toBe(6);
  });

  it('reads a hyphen range from its left side', () => {
    expect(lowestMajorAdmitted('5.0.0 - 6.0.0')).toBe(5);
    expect(lowestMajorAdmitted('6.0.0 - 6.9.9')).toBe(6);
  });

  it('reads an x-range from its major', () => {
    expect(lowestMajorAdmitted('5.x')).toBe(5);
    expect(lowestMajorAdmitted('6.x')).toBe(6);
  });

  it('refuses to guess at a form it cannot prove, rather than passing it', () => {
    expect(lowestMajorAdmitted('')).toBeUndefined();
    expect(lowestMajorAdmitted('   ')).toBeUndefined();
    expect(lowestMajorAdmitted('latest')).toBeUndefined();
    expect(lowestMajorAdmitted('npm:@typescript/typescript6@^6.0.3')).toBeUndefined();
    expect(lowestMajorAdmitted('workspace:*')).toBeUndefined();
    expect(lowestMajorAdmitted(undefined)).toBeUndefined();
  });
});

describe('scan-legacy-typescript — PERF-006 version edge (findBelowMinimumDeclarations)', () => {
  it('is clean for a 6.x declaration', () => {
    expect(findBelowMinimumDeclarations({ devDependencies: { typescript: '^6.0.3' } })).toEqual([]);
  });

  it('flags a 5.x declaration — the creep this edge exists to stop', () => {
    const found = findBelowMinimumDeclarations({ devDependencies: { typescript: '^5.9.3' } });
    expect(found).toHaveLength(1);
    expect(found[0].section).toBe('devDependencies');
    expect(found[0].range).toBe('^5.9.3');
  });

  it('flags every section independently', () => {
    const manifest = {
      dependencies: { typescript: '^5.9.3' },
      devDependencies: { typescript: '^6.0.3' },
      peerDependencies: { typescript: '*' },
    };
    expect(findBelowMinimumDeclarations(manifest).map((f) => f.section)).toEqual([
      'dependencies',
      'peerDependencies',
    ]);
  });

  it('flags a range it cannot prove, with a distinct reason', () => {
    const found = findBelowMinimumDeclarations({ devDependencies: { typescript: 'latest' } });
    expect(found).toHaveLength(1);
    expect(found[0].reason).toMatch(/cannot be proven/);
  });

  it('ignores the native compiler and the ESLint toolchain', () => {
    const manifest = {
      devDependencies: {
        '@typescript/native-preview': '7.0.0-dev.20260707.2',
        '@typescript-eslint/parser': '^7.18.0',
      },
    };
    expect(findBelowMinimumDeclarations(manifest)).toEqual([]);
  });

  it('is clean for a manifest declaring nothing', () => {
    expect(findBelowMinimumDeclarations({})).toEqual([]);
  });

  it('honours an explicit minimum, so the floor can be raised when 7.1 lands', () => {
    const manifest = { devDependencies: { typescript: '^6.0.3' } };
    expect(findBelowMinimumDeclarations(manifest, 6)).toEqual([]);
    expect(findBelowMinimumDeclarations(manifest, 7)).toHaveLength(1);
  });
});

describe('scan-legacy-typescript — store edge (installedMajor)', () => {
  it('reads the major off a plain version', () => {
    expect(installedMajor('5.9.3')).toBe(5);
    expect(installedMajor('6.0.3')).toBe(6);
    expect(installedMajor('7.0.0')).toBe(7);
  });

  it('reads the major off a prerelease and a v-prefixed version', () => {
    expect(installedMajor('7.1.0-dev.20260725.1')).toBe(7);
    expect(installedMajor('v6.0.3')).toBe(6);
  });

  it('reports rather than guesses at a version it cannot read', () => {
    for (const bad of ['', 'next', undefined, null, 6, '6']) {
      expect(installedMajor(bad)).toBeUndefined();
    }
  });
});

describe('scan-legacy-typescript — store edge (findBelowMinimumInstalled)', () => {
  it('is clean when the only installed copy is at the floor', () => {
    expect(findBelowMinimumInstalled([{ dir: 'a', version: '6.0.3' }])).toEqual([]);
  });

  it('flags the 5.x copy — the exact thing the manifest edges could not see', () => {
    const copies = [
      { dir: 'node_modules/.pnpm/typescript@6.0.3/node_modules/typescript', version: '6.0.3' },
      {
        dir: 'node_modules/.pnpm/config-file-ts@0.2.8-rc1/node_modules/typescript',
        version: '5.9.3',
      },
    ];
    const below = findBelowMinimumInstalled(copies);
    expect(below).toHaveLength(1);
    expect(below[0].version).toBe('5.9.3');
    expect(below[0].reason).toBe('resolves below');
  });

  it('flags an unreadable version with a distinct reason rather than passing it', () => {
    const below = findBelowMinimumInstalled([{ dir: 'a', version: 'garbage' }]);
    expect(below).toHaveLength(1);
    expect(below[0].reason).toContain('cannot prove');
  });

  it('honours an explicit minimum, so the floor can be raised alongside the declaration edge', () => {
    const copies = [{ dir: 'a', version: '6.0.3' }];
    expect(findBelowMinimumInstalled(copies, 6)).toEqual([]);
    expect(findBelowMinimumInstalled(copies, 7)).toHaveLength(1);
  });

  it('is clean for an empty tree', () => {
    expect(findBelowMinimumInstalled([])).toEqual([]);
  });
});

describe('scan-legacy-typescript — store edge (collectInstalledCopies)', () => {
  let root;

  /** Materialise a package at `relDir`, exactly as an installer would. */
  const install = (relDir, manifest) => {
    const dir = path.join(root, relDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest), 'utf8');
    return dir;
  };

  beforeEach(() => {
    root = makeTemp('legacy-ts-store-');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns undefined — NOT an empty list — when nothing is installed', () => {
    // The distinction is the whole point: "no node_modules" must never read as "tree is clean".
    expect(collectInstalledCopies(root)).toBeUndefined();
  });

  it('finds a copy in the pnpm virtual store, where every real copy actually lives', () => {
    install('node_modules/.pnpm/typescript@5.9.3/node_modules/typescript', {
      name: 'typescript',
      version: '5.9.3',
    });
    expect(collectInstalledCopies(root)).toEqual([
      {
        dir: path.join('node_modules', '.pnpm', 'typescript@5.9.3', 'node_modules', 'typescript'),
        version: '5.9.3',
      },
    ]);
  });

  it('finds every copy when several majors coexist', () => {
    install('node_modules/.pnpm/typescript@5.9.3/node_modules/typescript', {
      name: 'typescript',
      version: '5.9.3',
    });
    install('node_modules/.pnpm/typescript@6.0.3/node_modules/typescript', {
      name: 'typescript',
      version: '6.0.3',
    });
    expect(
      collectInstalledCopies(root)
        .map((c) => c.version)
        .sort(),
    ).toEqual(['5.9.3', '6.0.3']);
  });

  it('does not mistake the ESLint toolchain or the native compiler for the legacy package', () => {
    // Both spell the package name; neither IS it. This is the same false-positive class the
    // import edge defends against, and the directory name alone cannot tell them apart.
    install('node_modules/.pnpm/x/node_modules/@typescript-eslint/parser', {
      name: '@typescript-eslint/parser',
      version: '7.18.0',
    });
    install('node_modules/.pnpm/y/node_modules/@typescript/native-preview', {
      name: '@typescript/native-preview',
      version: '7.0.0-dev.20260707.2',
    });
    expect(collectInstalledCopies(root)).toEqual([]);
  });

  it('does not mistake a scoped package that merely SITS in a `typescript` directory', () => {
    install('node_modules/.pnpm/z/node_modules/@someone/typescript', {
      name: '@someone/typescript',
      version: '1.0.0',
    });
    expect(collectInstalledCopies(root)).toEqual([]);
  });

  it('finds a nested copy, which is how npm-style layouts hide a second major', () => {
    install('node_modules/some-tool/node_modules/typescript', {
      name: 'typescript',
      version: '5.4.3',
    });
    expect(collectInstalledCopies(root)).toEqual([
      {
        dir: path.join('node_modules', 'some-tool', 'node_modules', 'typescript'),
        version: '5.4.3',
      },
    ]);
  });

  // Creating a directory symlink needs Developer Mode or elevation on Windows. Skip rather than
  // fail there: this asserts a pnpm-layout property, and pnpm's store IS symlinks, so the check is
  // only meaningful where symlinks exist at all.
  it.skipIf(!CAN_SYMLINK)(
    'counts a copy ONCE even though pnpm symlinks it into the top level',
    () => {
      const real = install('node_modules/.pnpm/typescript@6.0.3/node_modules/typescript', {
        name: 'typescript',
        version: '6.0.3',
      });
      symlinkSync(real, path.join(root, 'node_modules', 'typescript'), 'dir');
      expect(collectInstalledCopies(root)).toHaveLength(1);
    },
  );

  it('ignores a directory with no manifest at all', () => {
    mkdirSync(path.join(root, 'node_modules', 'typescript'), { recursive: true });
    expect(collectInstalledCopies(root)).toEqual([]);
  });
});

// ── notice VISIBILITY ────────────────────────────────────────────────────────

/**
 * HARNESS-052, reachability axis. This scan's own comment calls its uninstalled-tree notice "Loud
 * rather than silent", and it was MEASURED silent on the only path anyone runs it on: `run-all-scans`
 * discards a passing scan's stdout, so `pnpm harness:scan` printed `✓ legacy-typescript` and nothing
 * else — byte-identical to a run where the installed-copy edge DID execute. Notices now carry
 * `ADVISORY_MARKER`, the one channel that survives a 0 exit (HARNESS-053).
 */
describe('formatNotices', () => {
  it('emits nothing when there is nothing to say', () => {
    expect(formatNotices([])).toEqual([]);
  });

  it('marks every notice so a PASSING run still surfaces it', () => {
    const lines = formatNotices(['no node_modules at /x', 'y/package.json no longer declares it']);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toContain(ADVISORY_MARKER);
    expect(extractAdvisories(lines.join('\n'))).toEqual([
      'no node_modules at /x',
      'y/package.json no longer declares it',
    ]);
  });
});

describe('gitTrackedFiles', () => {
  /**
   * `git ls-files` reports what the index knows, which is not always what is on disk. A change that
   * DELETES a source file — or a materialised tree built from HEAD plus working changes — leaves
   * entries naming files that are gone, and the caller hands each straight to `readFileSync`.
   *
   * Before this guard that was an ENOENT stack instead of a verdict, so any commit removing a `.ts`
   * file failed the scan for a reason unrelated to what it checks. A gate that blocks correct work is
   * one people route around.
   */
  it('skips a tracked path that is absent from disk, and says how many', () => {
    const root = makeTemp('tracked-files-');
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      writeFileSync(path.join(root, 'kept.ts'), 'export const a = 1;\n');
      writeFileSync(path.join(root, 'removed.ts'), 'export const b = 2;\n');
      execFileSync('git', ['add', '.'], { cwd: root });
      unlinkSync(path.join(root, 'removed.ts'));

      const notices = [];
      const files = gitTrackedFiles(root, notices);

      expect(files).toEqual(['kept.ts']);
      expect(notices.join('\n')).toMatch(/1 tracked path\(s\) are absent from disk/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports nothing when every tracked path is present', () => {
    const root = makeTemp('tracked-files-');
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      writeFileSync(path.join(root, 'kept.ts'), 'export const a = 1;\n');
      execFileSync('git', ['add', '.'], { cwd: root });

      const notices = [];
      expect(gitTrackedFiles(root, notices)).toEqual(['kept.ts']);
      // A scan that narrows its scope must say so; one that does not must stay quiet.
      expect(notices).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
