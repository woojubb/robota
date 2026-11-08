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
  for (const [name, { exports, source, files }] of Object.entries(packages)) {
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name: `@robota-sdk/${name}`,
        ...(exports && { exports }),
        ...(source && { source }),
      }),
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
        '@robota-sdk/a uses Node types NodeJS: packages/a/src/index.ts → packages/a/src/types.ts',
      ]),
    );
  });

  it('reads imports from the syntax tree, not from text that looks like code', async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: {
            'src/index.ts': [
              "export const glob = '**/*.ts'; export const f = () => import('node:fs'); /** doc */",
              'export const g = () => import(`node:child_process`);',
              "export type Stats = import('node:fs/promises').FileHandle;",
            ].join('\n'),
          },
        },
      },
      lists: { neutral: ['a'] },
    });
    expect((await checkPlatformNeutral(root)).sort()).toEqual(
      [
        '@robota-sdk/a imports node:child_process: packages/a/src/index.ts',
        '@robota-sdk/a imports node:fs: packages/a/src/index.ts',
        '@robota-sdk/a imports node:fs/promises: packages/a/src/index.ts',
      ].sort(),
    );
  });

  it("reports Node's global types in type positions, unless the file declares the name", async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: {
            'src/index.ts':
              "export * from './heritage';\nexport * from './typed';\nexport * from './local';",
            'src/heritage.ts': 'export interface E extends NodeJS.EventEmitter {}',
            'src/typed.ts':
              'export type T = { data: Buffer; env: typeof process.env; p: typeof globalThis.process; t: ReturnType<typeof setImmediate> };',
            'src/local.ts':
              'export type G = typeof globalThis.Buffer;\ntype Buffer = Uint8Array;\nexport const read = (process: { cwd(): string }, b: Buffer) => [process.cwd(), b];',
          },
        },
      },
      lists: { neutral: ['a'] },
    });
    expect((await checkPlatformNeutral(root)).sort()).toEqual(
      [
        '@robota-sdk/a uses Node types Buffer, process, setImmediate: packages/a/src/index.ts → packages/a/src/typed.ts',
        '@robota-sdk/a uses Node types NodeJS: packages/a/src/index.ts → packages/a/src/heritage.ts',
        '@robota-sdk/a uses Node types Buffer: packages/a/src/index.ts → packages/a/src/local.ts',
      ].sort(),
    );
  });

  it("reports Node's BufferEncoding type, but not a file's own union of that name", async () => {
    const root = workspace({
      packages: {
        a: {
          exports: neutralExport(),
          files: {
            'src/index.ts': "export * from './node-encoding';\nexport * from './own-encoding';",
            'src/node-encoding.ts':
              'export interface IPort { read(path: string, encoding: BufferEncoding): string }',
            'src/own-encoding.ts':
              "type BufferEncoding = 'utf8' | 'utf-8';\nexport const read = (encoding: BufferEncoding) => encoding;",
          },
        },
      },
      lists: { neutral: ['a'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([
      '@robota-sdk/a uses Node types BufferEncoding: packages/a/src/index.ts → packages/a/src/node-encoding.ts',
    ]);
  });

  it('checks an app shell through its source entry and refuses a listed package with none', async () => {
    const root = workspace({
      packages: {
        shell: {
          source: './src/main.tsx',
          files: { 'src/main.tsx': 'export const env = process.env;' },
        },
        bare: { files: { 'src/index.ts': '' } },
      },
      lists: { dom: ['shell', 'bare'] },
    });
    expect((await checkPlatformNeutral(root)).sort()).toEqual(
      [
        '@robota-sdk/shell uses Node global process: packages/shell/src/main.tsx',
        'bare is listed as Browser (DOM), but declares neither exports nor a source entry to check',
      ].sort(),
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

  it('reports a neutral subpath that maps a node or browser condition, at any depth', async () => {
    const root = workspace({
      packages: {
        split: {
          exports: {
            '.': {
              source: './src/index.ts',
              node: { import: './dist/node/index.js' },
              browser: { import: './dist/browser/index.js' },
              default: './dist/node/index.js',
            },
          },
          files: { 'src/index.ts': 'export const a = 1;' },
        },
        nested: {
          exports: {
            '.': { source: './src/index.ts', import: { node: './dist/index.js' } },
            './extra': { source: './src/index.ts', require: { browser: './dist/index.cjs' } },
          },
          files: { 'src/index.ts': 'export const a = 1;' },
        },
        one: {
          exports: {
            '.': {
              source: './src/index.ts',
              import: { types: './dist/index.d.ts', default: './dist/index.js' },
              require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
            },
            './node': {
              source: './src/index.ts',
              browser: null,
              node: './dist/node.js',
            },
          },
          files: { 'src/index.ts': 'export const a = 1;' },
        },
      },
      lists: { neutral: ['split', 'nested', 'one'] },
    });
    expect((await checkPlatformNeutral(root)).sort()).toEqual(
      [
        '@robota-sdk/split maps the node and browser conditions, but a platform-neutral subpath is one file for every runtime',
        '@robota-sdk/nested maps the node condition, but a platform-neutral subpath is one file for every runtime',
        '@robota-sdk/nested/extra maps the browser condition, but a platform-neutral subpath is one file for every runtime',
      ].sort(),
    );
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

  it('reports a package that is in two lists, and a list ARCHITECTURE.md lacks', async () => {
    const root = workspace({
      packages: { a: { exports: neutralExport(), files: { 'src/index.ts': '' } } },
      lists: { neutral: ['a'], dom: ['a'] },
    });
    expect(await checkPlatformNeutral(root)).toEqual([
      'a is listed as both Platform-neutral and Browser (DOM)',
    ]);
    writeFileSync(
      path.join(root, 'ARCHITECTURE.md'),
      '## Runtime platforms\n\n- **Platform-neutral**: `a`\n- **Browser (DOM)**: none\n\n## Next\n',
    );
    expect(await checkPlatformNeutral(root)).toEqual([
      'ARCHITECTURE.md "Runtime platforms" has no "Node host" list',
    ]);
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

  it('judges a package without a root export by its subpaths', async () => {
    const hostOnly = { './a': { source: './src/index.ts', browser: null, default: './dist/a.js' } };
    const mixed = { ...hostOnly, './b': { source: './src/index.ts', default: './dist/b.js' } };
    const packages = {
      host: { exports: hostOnly, files: { 'src/index.ts': '' } },
      mixed: { exports: mixed, files: { 'src/index.ts': '' } },
    };
    expect(
      await checkPlatformNeutral(
        workspace({ packages, lists: { neutral: ['mixed'], host: ['host'] } }),
      ),
    ).toEqual([]);
    expect(
      await checkPlatformNeutral(workspace({ packages, lists: { neutral: ['host', 'mixed'] } })),
    ).toEqual(['host is listed as Platform-neutral, but its subpaths map browser: null']);
  });
});
