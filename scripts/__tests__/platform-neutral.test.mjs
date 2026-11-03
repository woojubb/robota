import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkPlatformNeutral } from '../harness/check-platform-neutral.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const neutralExport = (source = './src/index.ts') => ({
  '.': { source, default: './dist/index.js' },
});
const nodeOnlyExport = (source = './src/index.ts') => ({
  '.': { source, browser: null, default: './dist/index.js' },
});

/** A workspace with the given packages (`files` keyed by path inside the package) and lists. */
function workspace({ packages, lists, thirdParty = {} }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'platform-neutral-'));
  roots.push(root);
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  for (const [name, { exports, files }] of Object.entries(packages)) {
    write(
      `packages/${name}/package.json`,
      JSON.stringify({ name: `@robota-sdk/${name}`, exports }),
    );
    for (const [file, content] of Object.entries(files)) write(`packages/${name}/${file}`, content);
  }
  for (const [name, files] of Object.entries(thirdParty)) {
    write(`node_modules/${name}/package.json`, JSON.stringify({ name, main: 'index.js' }));
    for (const [file, content] of Object.entries(files))
      write(`node_modules/${name}/${file}`, content);
  }
  const item = (label, names) =>
    `- **${label}**: ${names.map((name) => `\`${name}\``).join(', ')} — why.`;
  write(
    'ARCHITECTURE.md',
    [
      '# Architecture',
      '',
      '## Runtime platforms',
      '',
      item('Platform-neutral', lists.neutral ?? []),
      item('Browser (DOM)', lists.dom ?? []),
      item('Node host', lists.host ?? []),
      item('Not yet neutral', lists.pending ?? []),
      '',
      '## Next',
      '',
    ].join('\n'),
  );
  return root;
}

describe('platform-neutral entry check', () => {
  it('passes a neutral package that uses only web-standard globals', async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: {
            'src/index.ts': [
              'export const id = crypto.randomUUID();',
              'export const run = (process: { cwd(): string }) => process.cwd();',
              '// process.env in a comment',
              "export const label = 'process.env in a string';",
            ].join('\n'),
          },
        },
      },
      lists: { neutral: ['a'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([]);
  });

  it('reports a Node global, a lazy Node import and a type-only Node import, with the chain', async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: {
            'src/index.ts':
              "export * from './env';\nexport * from './lazy';\nexport * from './types';",
            'src/env.ts': 'export const home = process.env.HOME;',
            'src/lazy.ts': "export const spawn = () => import('node:child_process');",
            'src/types.ts':
              "import type { Readable } from 'node:stream';\nexport type T = Readable | NodeJS.Platform;",
          },
        },
      },
      lists: { neutral: ['a'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual(
      expect.arrayContaining([
        '@robota-sdk/a uses Node global process: packages/a/src/index.ts → packages/a/src/env.ts',
        '@robota-sdk/a imports node:child_process: packages/a/src/index.ts → packages/a/src/lazy.ts',
        '@robota-sdk/a imports node:stream: packages/a/src/index.ts → packages/a/src/types.ts',
        '@robota-sdk/a uses Node types (NodeJS namespace): packages/a/src/index.ts → packages/a/src/types.ts',
      ]),
    );
  });

  it("reports a neutral entry that imports another package's Node-only subpath", async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: { 'src/index.ts': "export { x } from '@robota-sdk/b/node';" },
        },
        b: {
          exports: {
            '.': { source: './src/index.ts', default: './dist/index.js' },
            './node': { source: './src/node.ts', browser: null, default: './dist/node.js' },
          },
          files: { 'src/index.ts': 'export const y = 1;', 'src/node.ts': 'export const x = 1;' },
        },
      },
      lists: { neutral: ['a', 'b'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([
      '@robota-sdk/a imports Node-only @robota-sdk/b/node: packages/a/src/index.ts',
    ]);
  });

  it('reports a static Node import in a dependency and allows its own lazy one', async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: {
            'src/index.ts': "export { read } from 'static-lib';\nexport { load } from 'lazy-lib';",
          },
        },
      },
      thirdParty: {
        'static-lib': { 'index.js': "import fs from 'fs';\nexport const read = fs.readFileSync;" },
        'lazy-lib': { 'index.js': "export const load = () => import('node:fs');" },
      },
      lists: { neutral: ['a'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([
      '@robota-sdk/a imports fs: packages/a/src/index.ts → static-lib/index.js',
    ]);
  });

  it('allows DOM globals only in a Browser (DOM) package', async () => {
    const files = { 'src/index.ts': 'export const store = () => window.localStorage;' };
    const root = workspace({
      packages: { a: { exports: neutralExport(), files }, b: { exports: neutralExport(), files } },
      lists: { neutral: ['a'], dom: ['b'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([
      '@robota-sdk/a uses DOM-only global window: packages/a/src/index.ts',
    ]);
  });

  it('does not inspect a Node-only subpath', async () => {
    const root = workspace({
      packages: {
        a: { exports: nodeOnlyExport(), files: { 'src/index.ts': "import 'node:fs';" } },
      },
      lists: { host: ['a'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([]);
  });

  it('reports lists that disagree with the manifests', async () => {
    const root = workspace({
      packages: {
        listedHost: { exports: neutralExport(), files: { 'src/index.ts': '' } },
        listedNeutral: { exports: nodeOnlyExport(), files: { 'src/index.ts': '' } },
        unlisted: { exports: neutralExport(), files: { 'src/index.ts': '' } },
        late: {
          exports: { '.': { source: './src/index.ts', import: './dist/index.js', browser: null } },
          files: { 'src/index.ts': '' },
        },
      },
      lists: { neutral: ['listedNeutral'], host: ['listedHost', 'late', 'gone'] },
    });
    expect((await checkPlatformNeutral(root)).sort()).toEqual(
      [
        'ARCHITECTURE.md lists gone, which is not a workspace package',
        '@robota-sdk/late maps browser: null after import, so a browser resolver never reaches it',
        'listedHost is listed as Node host, but its "." export does not map browser: null',
        'listedNeutral is listed as Platform-neutral, but its "." export maps browser: null',
        'unlisted is not in any ARCHITECTURE.md "Runtime platforms" list',
      ].sort(),
    );
  });
});
