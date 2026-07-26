import { describe, expect, it } from 'vitest';

import {
  findBelowMinimumDeclarations,
  findLegacyDependencies,
  findLegacyImportsInSource,
  lowestMajorAdmitted,
} from '../scan-legacy-typescript.mjs';

const FILE = 'scripts/probe.mjs';

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
