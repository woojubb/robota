import { describe, expect, it, vi } from 'vitest';

import { resolveSourceReference } from '../workspace-source-reference-resolution.mjs';
import * as sourceAst from '../lib/ts-ast.mjs';

function fixtureContext(
  entries,
  packages = [{ name: '@fixture/owner', directory: 'packages/owner' }],
) {
  return {
    files: new Set(Object.keys(entries)),
    packages,
    readFile: (file) => {
      if (!Object.hasOwn(entries, file)) throw new Error(`not a regular input: ${file}`);
      return typeof entries[file] === 'string' ? entries[file] : JSON.stringify(entries[file]);
    },
  };
}

describe('workspace source reference resolution', () => {
  it('resolves dotted extensionless basenames while retaining exact and ambiguous candidates', () => {
    const reference = {
      source: 'packages/a/vitest.config.ts',
      kind: 'module',
      specifier: '../../vitest.shared',
    };
    const files = new Set(['vitest.shared.ts']);
    expect(resolveSourceReference(reference, { files }).resolution.targets).toEqual([
      'vitest.shared.ts',
    ]);
    files.add('vitest.shared.mjs');
    expect(resolveSourceReference(reference, { files }).resolution.reason).toBe('ambiguous-target');
    files.delete('vitest.shared.mjs');
    files.add('vitest.shared');
    expect(resolveSourceReference(reference, { files }).resolution.reason).toBe('ambiguous-target');
  });

  it('does not append source extensions after recognized JS, TS or JSON extensions or data reads', () => {
    for (const extension of [
      '.js',
      '.jsx',
      '.mjs',
      '.cjs',
      '.ts',
      '.tsx',
      '.mts',
      '.cts',
      '.json',
    ]) {
      const reference = { source: 'src/main.ts', kind: 'module', specifier: `./value${extension}` };
      const files = new Set([`src/value${extension}.ts`]);
      expect(resolveSourceReference(reference, { files }).resolution.reason).toBe('missing-target');
      files.add(`src/value${extension}`);
      expect(resolveSourceReference(reference, { files }).resolution.targets).toEqual([
        `src/value${extension}`,
      ]);
    }
    expect(
      resolveSourceReference(
        {
          source: 'src/main.ts',
          kind: 'read-content',
          anchor: 'source',
          specifier: './vitest.shared',
        },
        { files: new Set(['src/vitest.shared.ts']) },
      ).resolution.reason,
    ).toBe('missing-target');
  });

  it('binds execution cwd to explicit caller context without guessing or reading metadata', () => {
    const files = new Set(['scripts/runner.mjs', 'scripts/child/runner.mjs', 'runner.mjs']);
    const context = {
      files,
      cwd: 'scripts',
      readFile: () => {
        throw new Error('unexpected metadata read');
      },
    };
    const reference = {
      source: 'packages/unrelated/test.ts',
      kind: 'execute',
      anchor: 'cwd',
      specifier: './runner.mjs',
      executionCwd: { specifier: 'child', expression: "'child'", span: { start: 1, end: 8 } },
    };
    expect(resolveSourceReference(reference, context)).toEqual({
      ...reference,
      resolution: { status: 'resolved', targets: ['scripts/child/runner.mjs'], evidenceInputs: [] },
    });
    expect(context.cwd).toBe('scripts');
    expect(resolveSourceReference(reference, { files }).resolution.reason).toBe('missing-cwd');
    expect(
      resolveSourceReference({ ...reference, executionCwd: { specifier: '..' } }, context)
        .resolution.targets,
    ).toEqual(['runner.mjs']);
  });

  it.each(['/outside', 'C:/outside', 'C:outside'])(
    'rejects non-relative execution cwd before joining: %s',
    (cwd) => {
      const files = new Set([
        'scripts/outside/runner.mjs',
        'scripts/C:/outside/runner.mjs',
        'scripts/C:outside/runner.mjs',
      ]);
      expect(
        resolveSourceReference(
          {
            source: 'test.mjs',
            kind: 'execute',
            anchor: 'cwd',
            specifier: './runner.mjs',
            executionCwd: { specifier: cwd },
          },
          { files, cwd: 'scripts' },
        ).resolution,
      ).toMatchObject({
        status: 'unresolved',
        reason: 'reference-escapes-repository',
      });
    },
  );

  it('invalidates cached config and manifest contents without losing resolution evidence', () => {
    const entries = {
      'packages/consumer/tsconfig.json': { extends: '../../tsconfig.base.json' },
      'tsconfig.base.json': {
        compilerOptions: { paths: { '@alias': ['packages/owner/src/a.ts'] } },
      },
      'packages/owner/package.json': { exports: { '.': { source: './src/a.ts' } } },
      'packages/owner/src/a.ts': '',
      'packages/owner/src/b.ts': '',
    };
    const context = { ...fixtureContext(entries), parsedInputs: new Map() };
    const resolve = (specifier) =>
      resolveSourceReference(
        { source: 'packages/consumer/src/main.ts', kind: 'module', specifier },
        context,
      ).resolution;
    expect(resolve('@alias').targets).toEqual(['packages/owner/src/a.ts']);
    expect(resolve('@fixture/owner').targets).toEqual(['packages/owner/src/a.ts']);
    entries['tsconfig.base.json'] = {
      compilerOptions: { paths: { '@alias': ['packages/owner/src/b.ts'] } },
    };
    entries['packages/owner/package.json'] = { exports: { '.': { source: './src/b.ts' } } };
    expect(resolve('@alias')).toEqual({
      status: 'resolved',
      targets: ['packages/owner/src/b.ts'],
      evidenceInputs: ['packages/consumer/tsconfig.json', 'tsconfig.base.json'],
    });
    expect(resolve('@fixture/owner')).toEqual({
      status: 'resolved',
      targets: ['packages/owner/src/b.ts'],
      evidenceInputs: [
        'packages/consumer/tsconfig.json',
        'packages/owner/package.json',
        'tsconfig.base.json',
      ],
    });
    entries['tsconfig.base.json'] = '{broken';
    expect(resolve('@alias')).toMatchObject({
      status: 'unresolved',
      evidenceInputs: ['packages/consumer/tsconfig.json', 'tsconfig.base.json'],
    });
    entries['tsconfig.base.json'] = {
      compilerOptions: { paths: { '@alias': ['packages/owner/src/a.ts'] } },
    };
    expect(resolve('@alias').targets).toEqual(['packages/owner/src/a.ts']);
    entries['packages/owner/package.json'] = '{broken';
    expect(resolve('@fixture/owner').reason).toBe('invalid-manifest');
    entries['packages/owner/package.json'] = { exports: { '.': { source: './src/a.ts' } } };
    expect(resolve('@fixture/owner').targets).toEqual(['packages/owner/src/a.ts']);
    context.files.delete('packages/owner/src/a.ts');
    expect(resolve('@fixture/owner').reason).toBe('missing-target');
  });

  it('does not share parsed inputs between independent analyses', () => {
    const entries = {
      'packages/owner/tsconfig.json': { compilerOptions: { paths: { '@alias': ['./src/a.ts'] } } },
      'packages/owner/src/a.ts': '',
    };
    const scoped = vi.spyOn(sourceAst, 'withSourceFile');
    try {
      for (let index = 0; index < 2; index++) {
        const context = { ...fixtureContext(entries), parsedInputs: new Map() };
        const reference = {
          source: 'packages/owner/src/main.ts',
          kind: 'module',
          specifier: '@alias',
        };
        expect(resolveSourceReference(reference, context).resolution.status).toBe('resolved');
        expect(resolveSourceReference(reference, context).resolution.status).toBe('resolved');
      }
      expect(scoped).toHaveBeenCalledTimes(2);
    } finally {
      scoped.mockRestore();
    }
  });

  it('bounds repeated-reference parse workload to distinct config and manifest contents per analysis', () => {
    const context = fixtureContext({
      'packages/consumer/tsconfig.json': { extends: '../../tsconfig.base.json' },
      'tsconfig.base.json': { compilerOptions: { strict: true } },
      'packages/owner/package.json': { exports: { '.': { source: './src/value.ts' } } },
      'packages/owner/src/value.ts': '',
    });
    context.parsedInputs = new Map();
    const read = vi.fn(context.readFile);
    context.readFile = read;
    const scoped = vi.spyOn(sourceAst, 'withSourceFile');
    const json = vi.spyOn(JSON, 'parse');
    const manifestText = JSON.stringify({ exports: { '.': { source: './src/value.ts' } } });
    try {
      for (let index = 0; index < 20; index++) {
        const result = resolveSourceReference(
          {
            source: `packages/consumer/src/file-${index}.ts`,
            kind: 'module',
            specifier: '@fixture/owner',
          },
          context,
        );
        expect(result.resolution).toEqual({
          status: 'resolved',
          targets: ['packages/owner/src/value.ts'],
          evidenceInputs: [
            'packages/consumer/tsconfig.json',
            'packages/owner/package.json',
            'tsconfig.base.json',
          ],
        });
      }
      const workload = {
        reads: read.mock.calls.length,
        configParses: scoped.mock.calls.length,
        manifestParses: json.mock.calls.filter(([text]) => text === manifestText).length,
      };
      expect(workload).toEqual({ reads: 60, configParses: 2, manifestParses: 1 });
    } finally {
      json.mockRestore();
      scoped.mockRestore();
    }
  });

  it('parses configuration through the scoped AST owner and returns detached results', () => {
    const scoped = vi.spyOn(sourceAst, 'withSourceFile');
    try {
      const context = fixtureContext({
        'packages/owner/tsconfig.json':
          '{ /* config */ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
        'packages/owner/src/value.ts': '',
      });
      const result = resolveSourceReference(
        { source: 'packages/owner/src/main.ts', kind: 'module', specifier: '@/value' },
        context,
      );
      expect(result.resolution.targets).toEqual(['packages/owner/src/value.ts']);
      expect(scoped).toHaveBeenCalled();
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    } finally {
      scoped.mockRestore();
    }
  });
  it('rejects forbidden export path segments even when those literal paths occur in the inventory', () => {
    for (const target of [
      './src/../private.ts',
      './node_modules/dep/index.js',
      './src/%2e%2e/private.ts',
      './src/%2fprivate.ts',
    ]) {
      const context = fixtureContext({
        'packages/owner/package.json': { exports: { source: target } },
        'packages/owner/private.ts': '',
        [`packages/owner/${target.slice(2)}`]: '',
      });
      expect(
        resolveSourceReference(
          { source: 'src/main.ts', kind: 'module', specifier: '@fixture/owner' },
          context,
        ).resolution,
      ).toMatchObject({
        status: 'unresolved',
        reason: 'invalid-export-target',
        evidenceInputs: ['packages/owner/package.json'],
      });
    }
  });
  it('preserves dynamic diagnostics and refuses unproven directory membership or unknown anchors', () => {
    const context = {
      files: new Set(['src/items']),
      cwd: 'src',
      readFile: () => {
        throw new Error('must not read');
      },
    };
    const reference = {
      source: 'src/main.ts',
      kind: 'list-names',
      anchor: 'source',
      specifier: './items',
      span: { start: 1, end: 8 },
    };
    expect(resolveSourceReference(reference, context)).toEqual({
      ...reference,
      resolution: {
        status: 'unresolved',
        reason: 'directory-membership-unavailable',
        evidenceInputs: [],
      },
    });
    expect(
      resolveSourceReference({ ...reference, kind: 'read-content', anchor: 'guessed' }, context)
        .resolution.reason,
    ).toBe('unknown-reference-anchor');
    const dynamic = {
      source: 'src/main.ts',
      kind: 'module',
      expression: 'moduleUrl',
      span: { start: 3, end: 12 },
    };
    expect(resolveSourceReference(dynamic, context)).toEqual({
      ...dynamic,
      resolution: {
        status: 'unresolved',
        reason: 'nonliteral-reference',
        evidenceInputs: [],
      },
    });
  });
  it('anchors inherited baseUrl to its declaration and allows only repository-contained parent paths', () => {
    const entries = {
      'packages/owner/tsconfig.json': { extends: '../../config/base.json' },
      'config/base.json':
        '{ "note": "https://example.test/a/,}", "compilerOptions": { "baseUrl": "../shared", "paths": { "@/*": ["./*"] } } }',
      'shared/value.ts': '',
    };
    const context = fixtureContext(entries);
    const reference = {
      source: 'packages/owner/src/main.ts',
      kind: 'module',
      specifier: '@/value',
    };
    expect(resolveSourceReference(reference, context).resolution.targets).toEqual([
      'shared/value.ts',
    ]);
    entries['config/base.json'] = {
      compilerOptions: { baseUrl: '../../outside', paths: { '@/*': ['./*'] } },
    };
    expect(resolveSourceReference(reference, context).resolution.status).toBe('unresolved');
  });
  it('does not classify local dependency protocols or invalid module URLs as external', () => {
    const context = fixtureContext({
      'packages/owner/package.json': {
        dependencies: {
          local: 'file:../local',
          linked: 'link:../linked',
          'node:invented': '^1',
        },
      },
    });
    const resolve = (specifier) =>
      resolveSourceReference(
        { source: 'packages/owner/src/main.ts', kind: 'module', specifier },
        context,
      ).resolution;
    for (const name of ['local', 'linked'])
      expect(resolve(name)).toMatchObject({
        status: 'unresolved',
        reason: 'local-dependency-protocol',
      });
    expect(resolve('node:invented').status).toBe('unresolved');
    expect(resolve('/outside.js').reason).toBe('reference-escapes-repository');
    expect(resolve('./%2foutside.js').reason).toBe('invalid-reference-url');
  });
  it('retains config evidence for exports and rejects unsupported or ambiguous export maps', () => {
    const entries = {
      'packages/owner/tsconfig.json': { compilerOptions: {} },
      'packages/owner/package.json': { exports: { source: './src/index.ts' } },
      'packages/owner/src/index.ts': '',
      'packages/owner/src/other.ts': '',
    };
    const context = fixtureContext(entries);
    const reference = {
      source: 'packages/owner/src/main.ts',
      kind: 'module',
      specifier: '@fixture/owner',
    };
    expect(resolveSourceReference(reference, context).resolution.evidenceInputs).toEqual([
      'packages/owner/package.json',
      'packages/owner/tsconfig.json',
    ]);
    for (const exports of [
      { '.': './src/index.ts', source: './src/other.ts' },
      { custom: './src/index.ts' },
      { source: ['./src/index.ts', './src/other.ts'] },
      { source: null, default: './src/index.ts' },
    ]) {
      entries['packages/owner/package.json'] = { exports };
      expect(resolveSourceReference(reference, context).resolution.status).toBe('unresolved');
    }
  });
  it('resolves literal config-family references but does not guess unavailable external config contents', () => {
    const context = fixtureContext(
      {
        'apps/blog/tsconfig.json': { extends: 'astro/tsconfigs/strict' },
        'apps/blog/package.json': { devDependencies: { astro: '^5' } },
        'tsconfig.base.json': { compilerOptions: { strict: true } },
      },
      [],
    );
    const reference = {
      source: 'apps/blog/tsconfig.json',
      kind: 'config',
      anchor: 'source',
      specifier: '../../tsconfig.base',
    };
    expect(resolveSourceReference(reference, context).resolution).toMatchObject({
      status: 'resolved',
      targets: ['tsconfig.base.json'],
    });
    expect(
      resolveSourceReference({ ...reference, specifier: 'astro/tsconfigs/strict' }, context)
        .resolution,
    ).toEqual({
      status: 'external',
      evidenceInputs: ['apps/blog/package.json', 'apps/blog/tsconfig.json'],
    });
    const result = resolveSourceReference(
      { source: 'apps/blog/src/index.ts', kind: 'module', specifier: '@/value' },
      context,
    ).resolution;
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('package-config-unavailable');
    expect(result.evidenceInputs).toContain('apps/blog/package.json');
  });
  it('resolves config extends arrays in order and exposes missing or cyclic inheritance', () => {
    const entries = {
      'packages/owner/tsconfig.json': { extends: ['../../first.json', '../../second.json'] },
      'first.json': { compilerOptions: { paths: { '@/*': ['./first/*'] } } },
      'second.json': { compilerOptions: { paths: { '@/*': ['./second/*'] } } },
      'first/value.ts': '',
      'second/value.ts': '',
    };
    const context = fixtureContext(entries);
    const reference = {
      source: 'packages/owner/src/main.ts',
      kind: 'module',
      specifier: '@/value',
    };
    expect(resolveSourceReference(reference, context).resolution).toEqual({
      status: 'resolved',
      targets: ['second/value.ts'],
      evidenceInputs: ['first.json', 'packages/owner/tsconfig.json', 'second.json'],
    });
    entries['second.json'] = { extends: './first.json' };
    entries['first.json'] = { extends: './second.json' };
    expect(resolveSourceReference(reference, context).resolution.reason).toContain('cyclic-config');
    entries['first.json'] = { extends: './absent.json' };
    expect(resolveSourceReference(reference, context).resolution.evidenceInputs).toContain(
      'absent.json',
    );
  });
  it('fails closed on malformed metadata and escaping config paths without reading excluded files', () => {
    const reference = {
      source: 'packages/owner/src/index.ts',
      kind: 'module',
      specifier: '@fixture/owner',
    };
    expect(
      resolveSourceReference(reference, fixtureContext({ 'packages/owner/package.json': '{bad' }))
        .resolution,
    ).toEqual({
      status: 'unresolved',
      reason: 'invalid-manifest',
      evidenceInputs: ['packages/owner/package.json'],
    });
    for (const compilerOptions of [
      { paths: { '@/*': 5 } },
      { baseUrl: '/outside' },
      { paths: { '@/*': ['/outside/*'] } },
    ]) {
      const context = fixtureContext({ 'packages/owner/tsconfig.json': { compilerOptions } });
      expect(
        resolveSourceReference({ ...reference, specifier: '@/value' }, context).resolution.status,
      ).toBe('unresolved');
    }
    const reads = [];
    const context = {
      files: new Set(['tsconfig.json', '../outside.json']),
      readFile: (file) => {
        reads.push(file);
        return '{ "extends": "../outside.json" }';
      },
    };
    expect(
      resolveSourceReference({ ...reference, source: 'src/main.ts' }, context).resolution.status,
    ).toBe('unresolved');
    expect(reads).toEqual(['tsconfig.json']);
  });
  it('classifies builtins and declared third parties without hiding missing workspace-family modules', () => {
    const context = fixtureContext({
      'packages/owner/package.json': {
        dependencies: {
          react: '^19',
          '@fixture/missing': '^1',
          'missing-workspace': 'workspace:*',
        },
        devDependencies: { astro: '^5' },
      },
    });
    const resolve = (specifier) =>
      resolveSourceReference(
        { source: 'packages/owner/src/index.ts', kind: 'module', specifier },
        context,
      ).resolution;
    for (const specifier of ['node:fs', 'fs/promises'])
      expect(resolve(specifier).status).toBe('builtin');
    for (const specifier of ['react/jsx-runtime', 'astro/tsconfigs/strict']) {
      expect(resolve(specifier)).toEqual({
        status: 'external',
        evidenceInputs: ['packages/owner/package.json'],
      });
    }
    for (const specifier of [
      '@fixture/missing',
      'missing-workspace',
      'undeclared',
      'node:invented',
    ]) {
      expect(resolve(specifier).status).toBe('unresolved');
    }
    expect(resolve('@fixture/missing').evidenceInputs).toContain('packages/owner/package.json');
  });
  it('honors baseUrl and child paths replacement without merging inherited aliases', () => {
    const entries = {
      'packages/owner/tsconfig.json': {
        extends: '../../tsconfig.base.json',
        compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
      },
      'tsconfig.base.json': {
        compilerOptions: {
          baseUrl: './shared',
          paths: { '@/*': ['./*'], '@docs/*': ['./docs/*'] },
        },
      },
      'packages/owner/src/view.tsx': '',
      'packages/owner/plain.ts': '',
      'shared/docs/topic.ts': '',
    };
    const context = fixtureContext(entries);
    const resolve = (specifier) =>
      resolveSourceReference(
        { source: 'packages/owner/src/index.ts', kind: 'module', specifier },
        context,
      ).resolution;
    expect(resolve('@/view').targets).toEqual(['packages/owner/src/view.tsx']);
    expect(resolve('plain').targets).toEqual(['packages/owner/plain.ts']);
    expect(resolve('@docs/topic').status).toBe('unresolved');
    entries['packages/owner/tsconfig.json'].compilerOptions.paths = {
      '@/*': ['./src/*', './other/*'],
    };
    context.files.add('packages/owner/other/view.ts');
    expect(resolve('@/view')).toMatchObject({ status: 'unresolved', reason: 'ambiguous-alias' });
  });
  it('resolves inherited JSONC paths relative to their declaring config and records the chain', () => {
    const context = fixtureContext({
      'packages/owner/tsconfig.json': '{ "extends": "../../tsconfig.base", }',
      'tsconfig.base.json':
        '{ /* shared */ "compilerOptions": { "paths": { "@docs/*": ["./content/*"], }, }, }',
      'content/guide.ts': '',
    });
    expect(
      resolveSourceReference(
        { source: 'packages/owner/src/index.ts', kind: 'module', specifier: '@docs/guide' },
        context,
      ).resolution,
    ).toEqual({
      status: 'resolved',
      targets: ['content/guide.ts'],
      evidenceInputs: ['packages/owner/tsconfig.json', 'tsconfig.base.json'],
    });
  });
  it('resolves source export patterns with exact subpath precedence and blocked evidence', () => {
    const context = fixtureContext({
      'packages/owner/package.json': {
        exports: {
          './*': { source: './src/*.ts', import: './dist/*.js' },
          './testing/*': { source: './test-support/*.ts' },
          './private': null,
        },
      },
      'packages/owner/src/value.ts': '',
      'packages/owner/src/private.ts': '',
      'packages/owner/test-support/helper.ts': '',
    });
    const resolve = (subpath) =>
      resolveSourceReference(
        { source: 'src/main.ts', kind: 'module', specifier: `@fixture/owner/${subpath}` },
        context,
      ).resolution;
    expect(resolve('value').targets).toEqual(['packages/owner/src/value.ts']);
    expect(resolve('testing/helper').targets).toEqual(['packages/owner/test-support/helper.ts']);
    expect(resolve('private')).toEqual({
      status: 'unresolved',
      reason: 'unexported-subpath',
      evidenceInputs: ['packages/owner/package.json'],
    });
    expect(resolve('testing/../../other')).toMatchObject({ status: 'unresolved' });
  });
  it('uses explicit I/O anchors without inferring cwd or translating data extensions', () => {
    const files = new Set(['packages/a/data.json', 'fixtures/data.json', 'packages/a/data.ts']);
    const base = { source: 'packages/a/main.ts', kind: 'read-content', specifier: './data.json' };
    expect(
      resolveSourceReference({ ...base, anchor: 'source' }, { files }).resolution.targets,
    ).toEqual(['packages/a/data.json']);
    expect(resolveSourceReference({ ...base, anchor: 'cwd' }, { files }).resolution).toEqual({
      status: 'unresolved',
      reason: 'missing-cwd',
      evidenceInputs: [],
    });
    expect(
      resolveSourceReference({ ...base, anchor: 'cwd' }, { files, cwd: 'fixtures' }).resolution
        .targets,
    ).toEqual(['fixtures/data.json']);
    expect(
      resolveSourceReference({ ...base, specifier: './data.js', anchor: 'source' }, { files })
        .resolution.status,
    ).toBe('unresolved');
    expect(
      resolveSourceReference({ ...base, anchor: 'cwd' }, { files, cwd: '/private/repo' }).resolution
        .status,
    ).toBe('unresolved');
  });
  it('resolves literal file URL components without reading outside the regular inventory', () => {
    const files = new Set(['src/data file.json', '../outside.ts', 'src/data.ts']);
    const context = {
      files,
      readFile: () => {
        throw new Error('unexpected file read');
      },
    };
    expect(
      resolveSourceReference(
        { source: 'src/main.ts', kind: 'module', specifier: './data%20file.json?raw#part' },
        context,
      ).resolution.targets,
    ).toEqual(['src/data file.json']);
    expect(
      resolveSourceReference(
        { source: 'src/main.ts', kind: 'read-content', specifier: './data' },
        context,
      ).resolution.status,
    ).toBe('unresolved');
    expect(
      resolveSourceReference({ source: 'src/main.ts', specifier: '../../outside.ts' }, context)
        .resolution,
    ).toMatchObject({
      status: 'unresolved',
      reason: 'reference-escapes-repository',
      evidenceInputs: [],
    });
    expect(
      resolveSourceReference({ source: 'src/main.ts', specifier: './symlink.ts' }, context)
        .resolution.status,
    ).toBe('unresolved');
    expect(
      resolveSourceReference(
        { source: 'src/main.ts', specifier: 'file:///private/project/src/data.ts' },
        context,
      ).resolution,
    ).toMatchObject({ status: 'unresolved', reason: 'absolute-file-url', evidenceInputs: [] });
  });
  it.each([
    ['.js', '.ts'],
    ['.mjs', '.mts'],
    ['.cjs', '.cts'],
  ])('maps %s to %s and refuses competing tracked implementations', (emitted, source) => {
    const reference = { source: 'src/main.ts', kind: 'module', specifier: `./helper${emitted}` };
    const files = new Set([`src/helper${source}`]);
    expect(resolveSourceReference(reference, { files }).resolution.targets).toEqual([
      `src/helper${source}`,
    ]);
    files.add(`src/helper${emitted}`);
    expect(resolveSourceReference(reference, { files }).resolution).toMatchObject({
      status: 'unresolved',
      reason: 'ambiguous-target',
      evidenceInputs: [],
    });
  });
  it('resolves extensionless modules only when the source candidate is unique', () => {
    const reference = { source: 'packages/a/src/main.ts', kind: 'module', specifier: './helper' };
    const files = new Set(['packages/a/src/helper/index.ts']);
    expect(resolveSourceReference(reference, { files }).resolution).toEqual({
      status: 'resolved',
      targets: ['packages/a/src/helper/index.ts'],
      evidenceInputs: [],
    });
    files.add('packages/a/src/helper.ts');
    expect(resolveSourceReference(reference, { files }).resolution).toMatchObject({
      status: 'unresolved',
      reason: 'ambiguous-target',
    });
  });
  it('resolves an emitted relative import to the tracked source in its actual owner', () => {
    const reference = {
      source: 'packages/consumer/src/index.ts',
      kind: 'module',
      specifier: '../../owner/src/helper.js',
      span: { start: 0, end: 30 },
    };
    const result = resolveSourceReference(reference, {
      files: new Set(['packages/owner/src/helper.ts']),
      packages: [
        { name: '@fixture/owner', directory: 'packages/owner' },
        { name: '@fixture/consumer', directory: 'packages/consumer' },
      ],
    });

    expect(result).toMatchObject({
      ...reference,
      resolution: {
        status: 'resolved',
        targets: ['packages/owner/src/helper.ts'],
        evidenceInputs: [],
      },
    });
  });

  it('uses the exported source subpath and records its manifest as a resolution input', () => {
    const manifestPath = 'packages/owner/package.json';
    const result = resolveSourceReference(
      {
        source: 'packages/consumer/src/index.ts',
        kind: 'module',
        specifier: '@fixture/owner/testing',
      },
      {
        files: new Set([manifestPath, 'packages/owner/src/testing/index.ts']),
        packages: [{ name: '@fixture/owner', directory: 'packages/owner' }],
        readFile: (file) => {
          expect(file).toBe(manifestPath);
          return JSON.stringify({
            exports: {
              './testing': {
                types: './dist/node/testing/index.d.ts',
                source: './src/testing/index.ts',
                import: './dist/node/testing/index.js',
              },
            },
          });
        },
      },
    );

    expect(result.resolution).toEqual({
      status: 'resolved',
      targets: ['packages/owner/src/testing/index.ts'],
      evidenceInputs: [manifestPath],
    });
  });

  it('does not let a package export resolve into a different owner', () => {
    const result = resolveSourceReference(
      { source: 'packages/consumer/src/index.ts', kind: 'module', specifier: '@fixture/owner' },
      {
        files: new Set(['packages/owner/package.json', 'packages/other/src/private.ts']),
        packages: [{ name: '@fixture/owner', directory: 'packages/owner' }],
        readFile: () => JSON.stringify({ exports: { source: '../other/src/private.ts' } }),
      },
    );
    expect(result.resolution).toMatchObject({
      status: 'unresolved',
      reason: 'export-escapes-owner',
    });
  });
});
