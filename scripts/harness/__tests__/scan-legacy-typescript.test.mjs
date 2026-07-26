import { describe, expect, it } from 'vitest';

import { findLegacyDependencies, findLegacyImportsInSource } from '../scan-legacy-typescript.mjs';

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
