import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { runHermeticTestsInStrippedRepository } from '../harness-hermetic-runner.mjs';

// Exercise the actual stripped-image preparation, but never launch suites that create Git fixtures.
vi.mock('../harness-vitest-process.mjs', () => ({
  vitestInvocation: (stage) => {
    for (const owner of ['packages', 'apps', '.agents', '.git']) {
      expect(existsSync(path.join(stage, owner))).toBe(false);
    }
    return spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      await import('./scripts/harness/tree-prerequisites.mjs');
      await import('./scripts/harness/check-build-output-contracts.mjs');
      await import('./scripts/harness/scan-dist-freshness.mjs');
      console.log('stripped artifact consumers loaded');
    `,
      ],
      { cwd: stage, encoding: 'utf8' },
    );
  },
}));

it('includes artifact implementation dependencies while leaving live-tree owners absent', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const result = runHermeticTestsInStrippedRepository(root);
  expect(result.status, result.output).toBe(0);
  expect(result.output).toContain('stripped artifact consumers loaded');
});
