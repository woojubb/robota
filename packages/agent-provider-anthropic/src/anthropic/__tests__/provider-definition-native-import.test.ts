import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('loads the provider definition first in native ESM with a verified capability date', () => {
  const definitionUrl = new URL('../provider-definition.ts', import.meta.url).href;
  const tableUrl = new URL('../capability-table.ts', import.meta.url).href;
  const code = `
    const definition = await import(${JSON.stringify(definitionUrl)});
    const table = await import(${JSON.stringify(tableUrl)});
    if (table.ANTHROPIC_CAPABILITY_TABLE.verifiedAt !== definition.ANTHROPIC_MODEL_LAST_VERIFIED_AT) {
      throw new Error('Anthropic capability verification date drifted');
    }
  `;
  const result = spawnSync(
    process.execPath,
    ['--conditions=source', '--import', 'tsx', '--input-type=module', '--eval', code],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      encoding: 'utf8',
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
