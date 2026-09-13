import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const example = new URL('../examples/deepseek-provider-demo.mjs', import.meta.url);

it('verifies real offline definitions/composition and reports a catalog mismatch as failure', () => {
  const success = spawnSync(process.execPath, [fileURLToPath(example)], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 30_000,
  });
  expect(success.error).toBeUndefined();
  expect(success.status, success.stderr || success.stdout).toBe(0);
  expect(success.stdout.match(/YES ✓/g)).toHaveLength(14);
  expect(success.stdout).toContain(
    'PASS — DeepSeek definition and built-in default composition verified offline.',
  );
  expect(success.stdout).not.toContain('CLI integration');

  // Only the child's in-memory catalog changes. No provider instance, keys, files or network.
  const failure = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { createDeepSeekProviderDefinition } from '@robota-sdk/agent-provider-openai-compatible';
    const catalog = createDeepSeekProviderDefinition().modelCatalog;
    const entry = catalog.entries.find((value) => value.id === 'deepseek-v4-flash');
    entry.lifecycle = 'deprecated';
    await import(${JSON.stringify(example.href)});
  `,
    ],
    { cwd: packageRoot, encoding: 'utf8', timeout: 30_000 },
  );
  expect(failure.error).toBeUndefined();
  expect(failure.status, failure.stderr || failure.stdout).toBe(1);
  expect(failure.stdout).toContain('model catalog has active deepseek-v4-flash: NO ✗');
  expect(failure.stdout).toContain('FAIL — one or more scenarios did not pass.');
});
