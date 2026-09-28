import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, it } from 'vitest';

import { createKoffiBunPlugin } from '../koffi-bun-plugin.mjs';

it('exposes native record layout helpers through default and named imports', () => {
  let load;
  createKoffiBunPlugin(
    `${process.platform}-${process.arch}`,
    new URL('../../../packages/agent-cli/package.json', import.meta.url),
  ).setup({
    onResolve() {},
    onLoad(_options, callback) {
      load = callback;
    },
  });
  const { contents } = load();
  const nativePath = contents.split('\n')[0].slice('import native from '.length, -1);
  const root = mkdtempSync(join(tmpdir(), 'robota-koffi-shim-'));
  try {
    const modulePath = join(root, 'shim.mjs');
    // Load the bare addon in a fresh process, before Koffi's regular wrapper can
    // attach helpers and conceal a missing helper in the standalone build shim.
    writeFileSync(
      modulePath,
      contents.replace(
        contents.split('\n')[0],
        `import { createRequire } from 'node:module';\nconst native = createRequire(import.meta.url)(${nativePath});`,
      ),
    );
    const probe = join(root, 'probe.mjs');
    writeFileSync(
      probe,
      `import assert from 'node:assert/strict';
import koffi, { sizeof, alignof, offsetof } from ${JSON.stringify(pathToFileURL(modulePath).href)};
const record = koffi.struct({ length: 'uint32_t', descriptor: 'void*', inherit: 'int' });
assert.equal(koffi.sizeof(record), 24);
assert.equal(koffi.sizeof, sizeof);
assert.equal(koffi.alignof(record), 8);
assert.equal(koffi.alignof, alignof);
assert.equal(koffi.offsetof(record, 'descriptor'), 8);
assert.equal(koffi.offsetof, offsetof);
console.log('native record layout helpers passed');
`,
    );
    expect(execFileSync(process.execPath, [probe], { encoding: 'utf8' })).toContain(
      'native record layout helpers passed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
