import { expect, it } from 'vitest';

import { extractSourceReferences } from '../workspace-source-reference-extraction.mjs';

it('tracks default filesystem bindings with their actual content and directory operations', () => {
  for (const module of ['node:fs', 'fs', 'node:fs/promises', 'fs/promises']) {
    const references = extractSourceReferences(
      [
        `import filesystem from '${module}';`,
        "filesystem.readFile(new URL('./owned.json', import.meta.url));",
        "filesystem.readdir(new URL('./fixtures/', import.meta.url));",
      ].join('\n'),
    );
    expect(references.filter((reference) => reference.kind !== 'module')).toMatchObject([
      { kind: 'read-content', specifier: './owned.json', anchor: 'source' },
      { kind: 'list-names', specifier: './fixtures/', anchor: 'source' },
    ]);
  }
});

it('preserves module references inside JSX expressions', () => {
  const references = extractSourceReferences(
    "const el = <div>{import('./owned.js')}</div>;",
    'fixture.jsx',
  );
  expect(references).toMatchObject([
    { kind: 'module', specifier: './owned.js', source: 'fixture.jsx' },
  ]);
});

it('ignores a block-local filesystem callback but retains the imported read outside that block', () => {
  const references = extractSourceReferences(
    [
      "import { readFileSync as read } from 'node:fs';",
      "{ const read = x => x; read('./not-input.json'); }",
      "read(new URL('./owned.json', import.meta.url));",
    ].join('\n'),
  );
  expect(references.filter((reference) => reference.kind !== 'module')).toMatchObject([
    { kind: 'read-content', specifier: './owned.json', anchor: 'source' },
  ]);
});

it.each([
  "{ const { callback: read } = callbacks; read('./not-input.json'); }",
  "{ let [, read] = callbacks; read('./not-input.json'); }",
  "{ function read(x) { return x; } read('./not-input.json'); }",
  "{ class read {} read('./not-input.json'); }",
  "function sample({ callback: read }) { read('./not-input.json'); }",
  "try {} catch (read) { read('./not-input.json'); }",
  "for (const read of callbacks) { read('./not-input.json'); }",
])('limits lexical binding to its scope: %s', (local) => {
  const references = extractSourceReferences(
    ["import { readFileSync as read } from 'node:fs';", local, "read('./owned.json');"].join('\n'),
  );
  expect(
    references.filter((reference) => reference.kind !== 'module'),
    local,
  ).toMatchObject([{ kind: 'read-content', specifier: './owned.json' }]);
});
