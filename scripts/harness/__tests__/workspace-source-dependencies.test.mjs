import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { makeTemp } from './make-temp.mjs';

import {
  extractLiteralModuleSpecifiers,
  collectWorkspaceReferenceInventory,
  extractSourceReferences,
  hasLiteralWorkspaceReference,
  readWorkspaceImportDependencies,
} from '../workspace-source-dependencies.mjs';

describe('workspace source reference evidence', () => {
  it('does not invent a package cwd for relative file reads and preserves an explicitly supplied cwd', () => {
    const source = "import { readFileSync } from 'node:fs'; readFileSync('data.json');";
    const packages = [{ name: '@fixture/consumer', directory: 'packages/consumer' }];
    const files = new Set([
      'packages/consumer/src/index.ts',
      'packages/consumer/data.json',
      'execution/data.json',
    ]);
    const inspect = (cwd) =>
      readWorkspaceImportDependencies('/fixture', packages[0], new Set(), {
        readSourceFile: () => source,
        resolutionContext: {
          files,
          packages,
          readFile: () => source,
          ...(cwd === undefined ? {} : { cwd }),
        },
      }).references.find((reference) => reference.kind === 'read-content');
    expect(inspect(undefined).resolution).toMatchObject({
      status: 'unresolved',
      reason: 'missing-cwd',
    });
    expect(inspect('execution').resolution).toMatchObject({
      status: 'resolved',
      targets: ['execution/data.json'],
    });
  });

  it('includes unstaged authored files at the collector boundary and does not parse generated or symlink targets', () => {
    const root = makeTemp('robota-source-inventory-');
    const workspacePackage = { name: '@fixture/a', directory: 'packages/a' };
    const files = [
      'packages/a/src/new.ts',
      'packages/a/out/bundle.js',
      'packages/a/.robota-artifacts/id/previous-dist/node/index.js',
    ];
    for (const file of files) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(
        path.join(root, file),
        file.endsWith('new.ts') ? "import '@fixture/owner';" : 'must not parse',
      );
    }
    symlinkSync(path.join(root, 'packages/a/out'), path.join(root, 'packages/a/linked'), 'dir');
    const calls = [];
    const inventory = collectWorkspaceReferenceInventory(
      root,
      [workspacePackage],
      (_paths, options) => {
        calls.push(options);
        return options.includeUntracked ? [...files, 'packages/a/linked/bundle.js'] : [];
      },
    );
    expect(calls).toEqual([
      { cwd: root, includeUntracked: false },
      { cwd: root, includeUntracked: true },
    ]);
    expect(inventory.population).toEqual([]);
    expect(inventory.untrackedPopulation).toContainEqual(
      expect.objectContaining({ path: 'packages/a/src/new.ts', category: 'source' }),
    );
    expect(inventory.files.has('packages/a/linked/bundle.js')).toBe(false);
    const reads = [];
    const result = readWorkspaceImportDependencies(
      root,
      workspacePackage,
      new Set(['@fixture/owner']),
      {
        sourceFiles: inventory.files,
        readSourceFile: (file) => {
          reads.push(file);
          return "import '@fixture/owner';";
        },
      },
    );
    expect(reads).toEqual([path.join(root, 'packages/a/src/new.ts')]);
    expect(result.production).toEqual(['@fixture/owner']);
  });

  it('propagates inventory failure instead of silently falling back to a filesystem scan', () => {
    expect(() =>
      collectWorkspaceReferenceInventory('/fixture', [], () => {
        throw new Error('collector unavailable');
      }),
    ).toThrow('collector unavailable');
  });

  it('keeps ambiguous aliases unresolved without inventing edges and keeps data references out of module fanout', () => {
    const contents = new Map([
      [
        'packages/consumer/src/index.ts',
        "import '@mapped/value'; import {readFileSync} from 'node:fs'; readFileSync(new URL('../../owner/data.json', import.meta.url));",
      ],
      [
        'packages/consumer/tsconfig.json',
        JSON.stringify({
          compilerOptions: { paths: { '@mapped/*': ['../owner/src/*', '../other/src/*'] } },
        }),
      ],
      ['packages/owner/src/value.ts', 'export const value = 1;'],
      ['packages/other/src/value.ts', 'export const value = 2;'],
      ['packages/owner/data.json', '{}'],
    ]);
    const packages = ['consumer', 'owner', 'other'].map((name) => ({
      name: `@fixture/${name}`,
      directory: `packages/${name}`,
    }));
    const context = {
      files: new Set(contents.keys()),
      packages,
      readFile: (file) => contents.get(file),
    };
    const result = readWorkspaceImportDependencies(
      '/fixture',
      packages[0],
      new Set(packages.map((entry) => entry.name)),
      {
        resolutionContext: context,
        readSourceFile: (file) => contents.get(file.slice('/fixture/'.length)),
      },
    );
    expect(result.production).toEqual([]);
    expect(result.verification).toEqual([]);
    expect(result.references).toMatchObject([
      { resolution: { status: 'unresolved', reason: 'ambiguous-alias' } },
      { resolution: { status: 'builtin' } },
      {
        kind: 'read-content',
        resolution: { status: 'resolved', targets: ['packages/owner/data.json'] },
      },
    ]);
  });

  it('projects relative and alias module targets through the shared resolver, retaining unresolved evidence', () => {
    const contents = new Map([
      [
        'packages/consumer/src/index.ts',
        "import '../../owner/src/value.js'; import '@owned/value'; await import(selected);",
      ],
      [
        'packages/consumer/tsconfig.json',
        JSON.stringify({ compilerOptions: { paths: { '@owned/*': ['../owner/src/*'] } } }),
      ],
      ['packages/owner/src/value.ts', 'export const value = 1;'],
    ]);
    const packages = [
      { name: '@fixture/consumer', directory: 'packages/consumer' },
      { name: '@fixture/owner', directory: 'packages/owner' },
    ];
    const result = readWorkspaceImportDependencies(
      '/fixture',
      packages[0],
      new Set(packages.map((entry) => entry.name)),
      {
        listSourceFiles: () => ['src/index.ts'],
        readSourceFile: (file) => contents.get(file.slice('/fixture/'.length)),
        resolutionContext: {
          files: new Set(contents.keys()),
          packages,
          readFile: (file) => contents.get(file),
        },
      },
    );
    expect(result.production).toEqual(['@fixture/owner']);
    expect(result.verification).toEqual(['@fixture/owner']);
    expect(result.references).toMatchObject([
      { resolution: { status: 'resolved', targets: ['packages/owner/src/value.ts'] } },
      {
        resolution: {
          status: 'resolved',
          targets: ['packages/owner/src/value.ts'],
          evidenceInputs: ['packages/consumer/tsconfig.json'],
        },
      },
      { resolution: { status: 'unresolved', reason: 'nonliteral-reference' } },
    ]);
  });

  it('does not turn comments or generated source strings into module dependencies', () => {
    const source = [
      "// import { ignored } from '@fixture/comment';",
      'const generated = "import { ignored } from \'@fixture/generated\';";',
      "import { actual } from '@fixture/actual';",
      "export * from '@fixture/exported';",
    ].join('\n');

    expect(extractLiteralModuleSpecifiers(source)).toEqual([
      '@fixture/actual',
      '@fixture/exported',
    ]);
  });

  it('preserves type-only and unresolved dynamic module references with source spans', () => {
    const source = "import type { Value } from './types.js';\nawait import(selectedPlugin);";
    const references = extractSourceReferences(source, 'packages/example/src/index.ts');

    expect(references).toHaveLength(2);
    expect(references[0]).toMatchObject({
      source: 'packages/example/src/index.ts',
      kind: 'module',
      specifier: './types.js',
      typeOnly: true,
    });
    expect(references[1]).toMatchObject({
      kind: 'module',
      expression: 'selectedPlugin',
      typeOnly: false,
    });
    expect(references[1].specifier).toBeUndefined();
    for (const reference of references) {
      expect(source.slice(reference.span.start, reference.span.end).trim()).toBe(
        reference.expression,
      );
    }
  });

  it('records an actual aliased file read using an import-meta URL, not a path-shaped string', () => {
    const source = [
      "import { readFileSync as read } from 'node:fs';",
      "const text = read(new URL('./fixture.json', import.meta.url), 'utf8');",
      "const unrelated = './not-an-input.json';",
    ].join('\n');
    const references = extractSourceReferences(source, 'packages/example/src/read.ts');

    expect(references.filter((reference) => reference.kind !== 'module')).toMatchObject([
      { kind: 'read-content', specifier: './fixture.json', anchor: 'source' },
    ]);
  });

  it('does not interpret a shadowing function parameter as the imported filesystem function', () => {
    const references = extractSourceReferences(
      "import { readFileSync as read } from 'node:fs'; function sample(read) { return read('./data.json'); }",
    );
    expect(references.filter((reference) => reference.kind !== 'module')).toEqual([]);
  });

  it('uses the same parsed evidence when checking integration-test consumers', () => {
    expect(
      hasLiteralWorkspaceReference({
        root: '/fixture',
        workspacePackage: { directory: 'packages/consumer' },
        packageName: '@fixture/owner',
        listCandidateFiles: () => ['src/example.test.ts'],
        readCandidateFile: () => "// import { ignored } from '@fixture/owner';",
      }),
    ).toBe(false);
  });

  it('distinguishes namespace filesystem content reads from directory-name enumeration', () => {
    const references = extractSourceReferences(
      [
        "import * as fs from 'node:fs';",
        "fs.readFileSync(new URL('./data.json', import.meta.url));",
        "fs.readdirSync(new URL('./fixtures/', import.meta.url));",
      ].join('\n'),
    );
    expect(references.filter((reference) => reference.kind !== 'module')).toMatchObject([
      { kind: 'read-content', specifier: './data.json', anchor: 'source' },
      { kind: 'list-names', specifier: './fixtures/', anchor: 'source' },
    ]);
  });

  it('does not mistake a local require callback for the CommonJS loader', () => {
    expect(
      extractLiteralModuleSpecifiers(
        "function invoke(require) { return require('@fixture/not-a-module'); }",
      ),
    ).toEqual([]);
  });

  it('retains unresolved expressions and source context alongside package dependency projections', () => {
    const result = readWorkspaceImportDependencies(
      '/fixture',
      { directory: 'packages/example' },
      new Set(['@fixture/owner']),
      {
        listSourceFiles: () => ['src/index.ts', 'examples/replay.mts'],
        readSourceFile: (file) =>
          file.endsWith('index.ts')
            ? "import type { Value } from '@fixture/owner'; await import(selected);"
            : "import '@fixture/owner';",
      },
    );
    expect(result.production).toEqual(['@fixture/owner']);
    expect(result.verification).toEqual(['@fixture/owner']);
    expect(result.references).toMatchObject([
      { source: 'packages/example/examples/replay.mts', context: 'tooling' },
      { source: 'packages/example/src/index.ts', context: 'production', typeOnly: true },
      { source: 'packages/example/src/index.ts', context: 'production', expression: 'selected' },
    ]);
  });

  it('excludes workspace-root static export output from source parsing', () => {
    const result = readWorkspaceImportDependencies(
      '/fixture',
      { directory: 'apps/site' },
      new Set(),
      {
        listSourceFiles: (_pattern, options) =>
          options.ignore.includes('out/**') ? [] : ['out/bundle.js'],
        readSourceFile: () => {
          throw new Error('generated export must not be parsed');
        },
      },
    );
    expect(result.references).toEqual([]);
  });

  it('excludes artifact transaction backups rather than treating built bundles as source', () => {
    const result = readWorkspaceImportDependencies(
      '/fixture',
      { directory: 'packages/a' },
      new Set(),
      {
        listSourceFiles: (_pattern, options) =>
          options.ignore.includes('**/.robota-artifacts/**')
            ? []
            : ['.robota-artifacts/transaction/previous-dist/bundle.js'],
        readSourceFile: () => {
          throw new Error('artifact backup must not be parsed');
        },
      },
    );
    expect(result.references).toEqual([]);
  });
});
