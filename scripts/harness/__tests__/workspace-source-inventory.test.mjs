import { expect, it } from 'vitest';

import { collectWorkspaceSourceInventory } from '../workspace-source-inventory.mjs';

it('collects an explicit filesystem population without Git or following excluded directories', () => {
  const directories = new Map([
    [
      '/fixture',
      [
        '.git',
        'node_modules',
        '.next',
        '.turbo',
        'coverage',
        'dist',
        'out',
        'packages',
        'README.md',
      ],
    ],
    ['/fixture/packages', ['a']],
    [
      '/fixture/packages/a',
      [
        'package.json',
        'src',
        'dist',
        'dist-bun',
        'out',
        '.next',
        '.turbo',
        'coverage',
        '.robota-artifacts',
        'linked',
      ],
    ],
    ['/fixture/packages/a/src', ['index.ts']],
  ]);
  const inspected = [];
  const read = [];
  const result = collectWorkspaceSourceInventory('/fixture', {
    mode: 'filesystem',
    packages: [
      {
        name: '@fixture/a',
        directory: 'packages/a',
        artifact: { builder: 'tsdown', variants: { bun: { output: 'dist-bun' } } },
      },
    ],
    collect: () => {
      throw new Error('Git collection must not run');
    },
    readDirectory: (file) => {
      read.push(file);
      if (!directories.has(file)) throw new Error(`unexpected traversal: ${file}`);
      return directories.get(file);
    },
    stat: (file) => {
      inspected.push(file);
      return {
        isSymbolicLink: () => file.endsWith('/linked'),
        isDirectory: () => directories.has(file),
        isFile: () => !directories.has(file) && !file.endsWith('/linked'),
      };
    },
  });
  expect(result.mode).toBe('filesystem');
  expect(result).not.toHaveProperty('population');
  expect(result).not.toHaveProperty('untrackedPopulation');
  expect([...result.files]).toEqual([
    'README.md',
    'packages/a/package.json',
    'packages/a/src/index.ts',
  ]);
  expect(
    result.filesystemPopulation.find((entry) => entry.path === 'packages/a/linked'),
  ).toMatchObject({ category: 'symlink', reason: 'not-followed' });
  expect(
    result.filesystemPopulation.find((entry) => entry.path.endsWith('index.ts')),
  ).toMatchObject({
    owner: '@fixture/a',
    category: 'source',
    contractEvidence: ['packages/a/package.json'],
  });
  expect(read).toEqual([...directories.keys()]);
  expect(
    inspected.some((file) =>
      /\/(?:\.git|node_modules|dist|dist-bun|out|\.next|\.turbo|coverage|\.robota-artifacts)(?:\/|$)/u.test(
        file,
      ),
    ),
  ).toBe(false);
});

it('propagates filesystem read errors and rejects unknown inventory modes', () => {
  expect(() =>
    collectWorkspaceSourceInventory('/fixture', {
      mode: 'filesystem',
      packages: [],
      collect: () => {
        throw new Error('unexpected Git');
      },
      stat: () => ({ isSymbolicLink: () => false, isDirectory: () => true }),
      readDirectory: () => {
        throw new Error('filesystem denied');
      },
    }),
  ).toThrow('filesystem denied');
  expect(() =>
    collectWorkspaceSourceInventory('/fixture', {
      mode: 'automatic',
      packages: [],
      collect: () => [],
    }),
  ).toThrow('inventory mode');
});

it('reports out-of-root population entries without inspecting them', () => {
  const inspected = [];
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [],
    collect: () => ['../outside.ts', '/outside.ts'],
    stat: (file) => {
      inspected.push(file);
      return { isSymbolicLink: () => false, isFile: () => true };
    },
  });
  expect(inspected).toEqual([]);
  expect(result.files.size).toBe(0);
  expect(result.population).toHaveLength(2);
  expect(
    result.population.every(
      (entry) => entry.category === 'unknown' && entry.reason === 'path-outside-repository',
    ),
  ).toBe(true);
});

it('attributes generated outputs only to the existing graph artifact declaration', () => {
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [
      {
        name: '@fixture/a',
        directory: 'packages/a',
        artifact: {
          builder: 'tsdown',
          variants: { bun: { output: 'dist-bun' } },
        },
      },
      { name: '@fixture/web', directory: 'packages/web', artifact: { builder: 'vite' } },
      { name: '@fixture/plain', directory: 'packages/plain' },
    ],
    collect: () => [
      'packages/a/package.json',
      'packages/web/package.json',
      'packages/a/dist/index.js',
      'packages/a/dist-bun/runner',
      'packages/web/dist/index.html',
      'packages/plain/dist/index.js',
      'packages/a/nested/dist/example.js',
      'packages/a/vendor/example.js',
    ],
    stat: () => ({ isSymbolicLink: () => false, isFile: () => true }),
  });
  for (const file of [
    'packages/a/dist/index.js',
    'packages/a/dist-bun/runner',
    'packages/web/dist/index.html',
  ]) {
    expect(result.population.find((entry) => entry.path === file)).toMatchObject({
      category: 'generated',
      reason: 'declared-workspace-artifact-output',
      contractEvidence: expect.arrayContaining([
        `${file.split('/').slice(0, 2).join('/')}/package.json#robota.artifact`,
      ]),
    });
    expect(result.files.has(file)).toBe(true);
  }
  for (const file of [
    'packages/plain/dist/index.js',
    'packages/a/nested/dist/example.js',
    'packages/a/vendor/example.js',
  ]) {
    expect(result.population.find((entry) => entry.path === file).category).toBe('source');
  }
});

it('links ownership to present declarations without inventing contracts or shared validity', () => {
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [{ name: '@fixture/a', directory: 'packages/a' }],
    collect: () => [
      'pnpm-workspace.yaml',
      '.agents/project-structure.md',
      'package.json',
      'packages/a/package.json',
      'packages/a/docs/SPEC.md',
      'packages/a/src/index.ts',
      'root-helper.ts',
      'unrecognized.blob',
    ],
    stat: () => ({ isSymbolicLink: () => false, isFile: () => true }),
  });
  const source = result.population.find((entry) => entry.path === 'packages/a/src/index.ts');
  expect(source.contractEvidence).toEqual([
    'pnpm-workspace.yaml',
    'packages/a/package.json',
    'packages/a/docs/SPEC.md',
  ]);
  const root = result.population.find((entry) => entry.path === 'root-helper.ts');
  expect(root.contractEvidence).toEqual(['package.json', '.agents/project-structure.md']);
  expect(root).not.toHaveProperty('shared');
  expect(root).not.toHaveProperty('disposition');
  expect(source.reason).toBe('source-extension:.ts');
  expect(result.population.find((entry) => entry.path === 'unrecognized.blob').reason).toBe(
    'unrecognized-file-kind:requires-classification',
  );
  const withoutDeclarations = collectWorkspaceSourceInventory('/fixture', {
    packages: [],
    collect: () => ['root-helper.ts'],
    stat: () => ({ isSymbolicLink: () => false, isFile: () => true }),
  });
  expect(withoutDeclarations.population[0].contractEvidence).toEqual([]);
});

it('reports nonignored untracked additions separately while resolving both populations', () => {
  const calls = [];
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [],
    collect: (_, options) => {
      calls.push(options.includeUntracked);
      return options.includeUntracked ? ['tracked.ts', 'new.ts', 'tracked.ts'] : ['tracked.ts'];
    },
    stat: () => ({ isSymbolicLink: () => false, isFile: () => true }),
  });
  expect(calls).toEqual([false, true]);
  expect(result.population.map((entry) => entry.path)).toEqual(['tracked.ts']);
  expect(result.untrackedPopulation.map((entry) => entry.path)).toEqual(['new.ts']);
  expect([...result.files]).toEqual(['new.ts', 'tracked.ts']);
});

it('accounts for every tracked path without reading symlinks or pending deletions', () => {
  const files = ['packages/a/src/index.ts', 'README.md', 'linked', 'deleted.json'];
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [{ name: '@fixture/a', directory: 'packages/a' }],
    collect: () => files,
    stat: (file) => {
      if (file.endsWith('/deleted.json'))
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return {
        isSymbolicLink: () => file.endsWith('/linked'),
        isFile: () => !file.endsWith('/linked'),
      };
    },
  });
  expect(result.population).toHaveLength(4);
  expect(result.population).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'packages/a/src/index.ts',
        owner: '@fixture/a',
        category: 'source',
      }),
      expect.objectContaining({
        path: 'README.md',
        owner: 'repository',
        category: 'documentation',
      }),
      expect.objectContaining({ path: 'linked', category: 'symlink', reason: 'not-followed' }),
      expect.objectContaining({
        path: 'deleted.json',
        category: 'missing',
        reason: 'pending-deletion-or-missing',
      }),
    ]),
  );
  expect([...result.files]).toEqual(['README.md', 'packages/a/src/index.ts']);
});

it('does not inspect a tracked descendant through a replaced symlink directory', () => {
  const inspected = [];
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [],
    collect: () => ['linked/secret.ts'],
    stat: (file) => {
      inspected.push(file);
      return { isSymbolicLink: () => file === '/fixture/linked', isFile: () => true };
    },
  });
  expect([...result.files]).toEqual([]);
  expect(inspected).toEqual(['/fixture/linked']);
  expect(result.population[0]).toMatchObject({ category: 'symlink', reason: 'not-followed' });
});

it('classifies known file kinds without treating arbitrary dist/vendor names as exclusions', () => {
  const result = collectWorkspaceSourceInventory('/fixture', {
    packages: [],
    collect: () => [
      'package.json',
      'tsconfig.json',
      'pnpm-workspace.yaml',
      'fixture.json',
      'logo.png',
      'dist/bundle.js',
      'vendor/library.js',
      'unrecognized.blob',
    ],
    stat: () => ({ isSymbolicLink: () => false, isFile: () => true }),
  });
  expect(
    Object.fromEntries(result.population.map((entry) => [entry.path, entry.category])),
  ).toEqual({
    'package.json': 'config',
    'tsconfig.json': 'config',
    'pnpm-workspace.yaml': 'config',
    'fixture.json': 'data',
    'logo.png': 'asset',
    'dist/bundle.js': 'source',
    'vendor/library.js': 'source',
    'unrecognized.blob': 'unknown',
  });
  expect(result.population.every((entry) => entry.reason.length > 0)).toBe(true);
});
