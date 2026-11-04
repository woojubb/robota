import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runBrowserProof } from '../harness/browser-runtime-proof.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const neutralExport = (source = './src/index.ts') => ({
  '.': { source, default: './dist/index.js' },
});
const nodeExport = { source: './src/node.ts', browser: null, default: './dist/node.js' };

/**
 * A workspace with the given packages (`files` keyed by path inside the package), the packages each
 * ARCHITECTURE.md list names, the third-party modules in `node_modules`, and the scenario files.
 */
function workspace({ packages, neutral, host = [], thirdParty = {}, scenarios = {} }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'browser-proof-'));
  roots.push(root);
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  for (const [name, { exports = neutralExport(), files }] of Object.entries(packages)) {
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
  for (const [file, content] of Object.entries(scenarios)) write(`scenarios/${file}`, content);
  const item = (label, names) =>
    `- **${label}**: ${names.map((name) => `\`${name}\``).join(', ')} — why.`;
  write(
    'ARCHITECTURE.md',
    [
      '# Architecture',
      '',
      '## Runtime platforms',
      '',
      item('Platform-neutral', neutral),
      item('Browser (DOM)', []),
      item('Node host', host),
      item('Not yet neutral', []),
      '',
      '## Next',
      '',
    ].join('\n'),
  );
  return { root, scenarioDir: path.join(root, 'scenarios') };
}

const prove = ({ root, scenarioDir }, options = {}) =>
  runBrowserProof({ root, scenarioDir, ...options });

describe('browser runtime proof', () => {
  it('passes a neutral package that uses only web-standard globals, and asserts what it saw', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: {
            files: {
              'src/index.ts': [
                'export const digest = async (text: string) =>',
                "  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]",
                "    .map((byte) => byte.toString(16).padStart(2, '0')).join('');",
                'export const ask = (url: string) => fetch(url, { method: "POST", body: "hi" });',
              ].join('\n'),
            },
          },
        },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            "import { ask, digest } from '@robota-sdk/a';",
            'export default async function (t) {',
            "  t.fetch.on('/answer', () => new Response('ok'));",
            "  t.equal('a digest', await digest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');",
            "  const response = await ask('https://example.test/answer');",
            "  t.equal('the reply is read back', await response.text(), 'ok');",
            "  t.equal('the stub recorded the request', t.fetch.requests.map((r) => [r.method, r.url, r.body]), [['POST', 'https://example.test/answer', 'hi']]);",
            '}',
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual([]);
    expect(run.jobs.map((job) => [job.id, job.ok])).toEqual([
      ['load @robota-sdk/a', true],
      ['scenario a', true],
    ]);
    expect(run.jobs.find((job) => job.kind === 'scenario')).toMatchObject({
      checks: 3,
      requests: 1,
    });
  });

  it('gives the bundle no Node global, and timers that return numbers as a browser does', async () => {
    const run = await prove(
      workspace({
        packages: { a: { files: { 'src/index.ts': 'export {};' } } },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            'export default async function (t) {',
            '  for (const name of ["process", "Buffer", "global", "setImmediate", "clearImmediate", "require", "module", "exports", "__dirname", "__filename"])',
            '    t.equal(`${name} is not defined`, typeof globalThis[name], "undefined");',
            '  for (const name of ["crypto", "fetch", "TextEncoder", "URL", "ReadableStream", "AbortController", "structuredClone", "btoa"])',
            '    t.ok(`${name} is defined`, typeof globalThis[name] !== "undefined");',
            '  const handle = setTimeout(() => {}, 0);',
            '  t.equal("a timer handle is a number", typeof handle, "number");',
            '  clearTimeout(handle);',
            '}',
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual([]);
  });

  it('fails a scenario that reads `process`, naming the global and the line', async () => {
    const run = await prove(
      workspace({
        packages: { a: { files: { 'src/index.ts': 'export const id = 1;' } } },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            "import { id } from '@robota-sdk/a';",
            'export default async function (t) {',
            "  t.equal('before', id, 1);",
            '  const home = process.env.HOME;',
            "  t.ok('unreachable', home !== undefined);",
            '}',
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toHaveLength(1);
    expect(run.problems[0]).toMatch(
      /^scenario a: read the global `process`, which a browser does not define at /u,
    );
    expect(run.problems[0]).toMatch(/a\.scenario\.mjs:4$/u);
  });

  it('fails a neutral package that reads a Node global while its module loads', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: { files: { 'src/index.ts': "export const home = process.env['HOME'];" } },
        },
        neutral: ['a'],
      }),
    );
    expect(run.problems).toEqual([
      expect.stringMatching(
        /^load @robota-sdk\/a: read the global `process`, which a browser does not define at packages\/a\/src\/index\.ts:1$/u,
      ),
    ]);
  });

  it('catches what a scan of the workspace cannot: a third-party dependency that reads `process.env` when called', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: {
            files: {
              'src/index.ts':
                "import { configured } from 'cfg';\nexport const run = () => configured();",
            },
          },
        },
        thirdParty: {
          cfg: {
            'index.js': "exports.configured = () => process.env.CFG_MODE || 'default';\n",
          },
        },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            "import { run } from '@robota-sdk/a';",
            "export default async function (t) { t.equal('configured', run(), 'default'); }",
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual([
      expect.stringMatching(/^scenario a: read the global `process`.* at cfg\/index\.js:1$/u),
    ]);
  });

  it('lets a dependency probe for `process` with `typeof`, as a library that runs in a browser does', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: {
            files: {
              'src/index.ts': "import { mode } from 'cfg';\nexport const run = () => mode();",
            },
          },
        },
        thirdParty: {
          cfg: {
            'index.js':
              "exports.mode = () => (typeof process !== 'undefined' && process.env.CFG_MODE) || 'default';\n",
          },
        },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            "import { run } from '@robota-sdk/a';",
            "export default async function (t) { t.equal('mode', run(), 'default'); }",
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual([]);
  });

  it('fails a bundle that imports a Node built-in, with the importing file and the bundles that hold it', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: { files: { 'src/index.ts': 'export const a = 1;' } },
          b: { files: { 'src/index.ts': "import { join } from 'path';\nexport const j = join;" } },
        },
        neutral: ['a', 'b'],
      }),
    );
    expect(run.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^imports path: packages\/b\/src\/index\.ts \(in the bundle of load @robota-sdk\/b\)$/u,
        ),
      ]),
    );
  });

  it('fails a bundle that imports `node:fs`, however it is imported', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: {
            files: {
              'src/index.ts': [
                "import { readFileSync } from 'node:fs';",
                'export const read = (file: string) => readFileSync(file, "utf8");',
                "export const lazy = () => import('node:child_process');",
              ].join('\n'),
            },
          },
        },
        neutral: ['a'],
      }),
    );
    const named = run.problems.filter((problem) => problem.startsWith('imports '));
    expect(named).toEqual(
      expect.arrayContaining([
        'imports node:fs: packages/a/src/index.ts (in the bundle of load @robota-sdk/a)',
        'imports node:child_process: packages/a/src/index.ts (in the bundle of load @robota-sdk/a)',
      ]),
    );
    // The built-in resolves to a module that throws, as a browser build's stub would, so the load fails too.
    expect(run.problems.some((problem) => problem.startsWith('load @robota-sdk/a: '))).toBe(true);
  });

  it('allows a Node built-in only in a dynamic import inside a dependency, which does not run here', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: {
            files: {
              'src/index.ts': "import { open } from 'cfg';\nexport const run = () => open();",
            },
          },
          b: {
            files: {
              'src/index.ts': "import { eager } from 'eager';\nexport const run = () => eager();",
            },
          },
        },
        thirdParty: {
          cfg: {
            'index.js':
              "exports.open = () => (typeof window === 'undefined' ? 'worker' : import('node:fs'));\n",
          },
          eager: { 'index.js': "const fs = require('fs');\nexports.eager = () => fs;\n" },
        },
        neutral: ['a', 'b'],
      }),
    );
    expect(run.problems.filter((problem) => problem.startsWith('imports '))).toEqual([
      'imports fs: eager/index.js (in the bundle of load @robota-sdk/b)',
    ]);
  });

  it("fails a scenario that imports another package's Node-only subpath", async () => {
    const run = await prove(
      workspace({
        packages: {
          a: {
            exports: { ...neutralExport(), './node': nodeExport },
            files: {
              'src/index.ts': 'export const a = 1;',
              'src/node.ts': 'export const host = 1;',
            },
          },
        },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            "import { host } from '@robota-sdk/a/node';",
            "export default async function (t) { t.equal('host', host, 1); }",
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^imports Node-only @robota-sdk\/a\/node: .*a\.scenario\.mjs/u),
      ]),
    );
  });

  it('refuses a scenario for a package the Platform-neutral list does not name', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: { files: { 'src/index.ts': 'export const a = 1;' } },
          host: { exports: { '.': nodeExport }, files: { 'src/node.ts': 'export const h = 1;' } },
        },
        neutral: ['a'],
        host: ['host'],
        scenarios: {
          'host.scenario.mjs': 'export default async function () {}',
        },
      }),
    );
    expect(run.problems).toEqual([
      expect.stringMatching(
        /^host\.scenario\.mjs is a scenario for host, which .* does not list as Platform-neutral$/u,
      ),
    ]);
  });

  it('reports each failed check by its label, with what it expected and what it got', async () => {
    const run = await prove(
      workspace({
        packages: { a: { files: { 'src/index.ts': 'export const answer = 41;' } } },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            "import { answer } from '@robota-sdk/a';",
            'export default async function (t) {',
            "  t.equal('the answer', answer, 42);",
            "  t.match('the text', 'hello', /bye/);",
            "  await t.rejects('a refusal', async () => {}, /no/);",
            '}',
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual([
      'scenario a: "the answer" failed: expected 42, got 41',
      expect.stringMatching(/^scenario a: "the text" failed: expected \/bye\/ in "hello"$/u),
      'scenario a: "a refusal" failed: it did not throw',
    ]);
  });

  it('fails a timer callback that throws after the scenario returned, as a browser reports it', async () => {
    const run = await prove(
      workspace({
        packages: { a: { files: { 'src/index.ts': 'export {};' } } },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': [
            'export default async function () {',
            '  setTimeout(() => { process.exit(1); }, 0);',
            '  await new Promise((resolve) => setTimeout(resolve, 20));',
            '}',
          ].join('\n'),
        },
      }),
    );
    expect(run.problems).toEqual([
      expect.stringMatching(/^scenario a: uncaught exception: read the global `process`/u),
    ]);
  });

  it('stops a scenario that never settles, and names it', async () => {
    const run = await prove(
      workspace({
        packages: { a: { files: { 'src/index.ts': 'export {};' } } },
        neutral: ['a'],
        scenarios: {
          'a.scenario.mjs': 'export default function () { return new Promise(() => {}); }',
        },
      }),
      { jobTimeoutMs: 300 },
    );
    expect(run.problems).toEqual([
      expect.stringMatching(/^scenario a: Error: run\(\) did not finish within 300 ms/u),
    ]);
  });

  it('lists the neutral packages that are only loaded, so a missing scenario is visible', async () => {
    const run = await prove(
      workspace({
        packages: {
          a: { files: { 'src/index.ts': 'export const a = 1;' } },
          b: { files: { 'src/index.ts': 'export const b = 1;' } },
        },
        neutral: ['a', 'b'],
        scenarios: { 'a.scenario.mjs': 'export default async function () {}' },
      }),
    );
    expect(run.problems).toEqual([]);
    expect(run.loadOnly).toEqual(['b']);
  });
});
