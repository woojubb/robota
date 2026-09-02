import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalTemporaryDirectory } from './canonical-temporary-directory.mjs';
import { HERMETIC_TEST_FILES } from './harness-test-classification.mjs';
import { vitestInvocation } from './harness-vitest-process.mjs';

/** Execute the allowlisted tier in a repository stripped of every live-tree owner. */
export function runHermeticTestsInStrippedRepository(root) {
  const stage = mkdtempSync(path.join(canonicalTemporaryDirectory(), 'robota-harness-hermetic-'));
  try {
    cpSync(path.join(root, 'scripts', 'harness'), path.join(stage, 'scripts', 'harness'), {
      recursive: true,
    });
    writeFileSync(path.join(stage, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(
      path.join(stage, 'vitest.config.mjs'),
      "export default { test: { environment: 'node' } };\n",
    );
    symlinkSync(path.join(root, 'node_modules'), path.join(stage, 'node_modules'), 'dir');
    const result = vitestInvocation(
      stage,
      HERMETIC_TEST_FILES,
      stage,
      path.join(stage, 'vitest.config.mjs'),
    );
    return {
      status: result.status ?? 1,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
