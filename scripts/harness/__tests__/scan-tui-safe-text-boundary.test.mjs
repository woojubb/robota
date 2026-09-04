import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  BOUNDARY_MODULE,
  findBoundaryViolations,
  offendingImportForms,
} from '../scan-tui-safe-text-boundary.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-tui-safe-text-boundary.mjs', import.meta.url));
const WORKSPACE_ROOT = path.resolve(path.dirname(SCAN_SCRIPT), '../..');
const PACKAGE_SRC = 'packages/agent-transport-tui/src';

/** A tracked scratch checkout: the finder reads `git ls-files`, so the fixture must be committed. */
function trackedFixture(files) {
  const root = makeTemp('robota-tui-safe-text-boundary-');
  for (const [relative, source] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, source);
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['commit', '-q', '-m', 'fixture'],
  ]) {
    const result = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return root;
}

describe('offendingImportForms', () => {
  it('names every way Text becomes reachable from one clause', () => {
    expect(offendingImportForms('{ Text }')).toEqual(['plain']);
    expect(offendingImportForms('{ Box, Text as T }')).toEqual(['aliased']);
    expect(offendingImportForms('* as ink')).toEqual(['namespace']);
    expect(offendingImportForms('{ Box, useInput }')).toEqual([]);
    expect(offendingImportForms('{ type Text }')).toEqual(['plain']);
  });
});

describe('findBoundaryViolations (#2222)', () => {
  it('reports a render site importing Text from ink, and exempts the boundary and its tests', () => {
    const root = trackedFixture({
      [BOUNDARY_MODULE]: "import { Text } from 'ink';\n",
      [`${PACKAGE_SRC}/Leak.tsx`]: "import { Box } from 'ink';\nimport { Text as T } from 'ink';\n",
      [`${PACKAGE_SRC}/Clean.tsx`]:
        "import { Box } from 'ink';\nimport { Text } from './SafeText.js';\n",
      [`${PACKAGE_SRC}/Types.ts`]: "import type { Text } from 'ink';\n",
      [`${PACKAGE_SRC}/__tests__/Leak.test.tsx`]: "import { Text } from 'ink';\n",
    });
    const { examined, violations } = findBoundaryViolations(root);
    expect(examined).toBe(3);
    expect(violations).toEqual([{ file: `${PACKAGE_SRC}/Leak.tsx`, line: 2, form: 'aliased' }]);
  });

  it('counts the same modules on a SECOND run rather than accumulating', () => {
    const root = trackedFixture({
      [`${PACKAGE_SRC}/A.tsx`]: "import { Box } from 'ink';\n",
      [`${PACKAGE_SRC}/B.tsx`]: "import * as ink from 'ink';\n",
    });
    findBoundaryViolations(root);
    const { examined, violations } = findBoundaryViolations(root);
    expect(examined).toBe(2);
    expect(violations).toEqual([{ file: `${PACKAGE_SRC}/B.tsx`, line: 1, form: 'namespace' }]);
  });

  it('exits 0 on the live repository and says what it examined', () => {
    const output = execFileSync(process.execPath, [SCAN_SCRIPT], {
      cwd: WORKSPACE_ROOT,
      encoding: 'utf8',
    });
    expect(output).toMatch(/::examined:: [1-9]\d* agent-transport-tui production module\(s\)/);
    expect(output).toContain('tui-safe-text-boundary: only SafeText.tsx imports Text from ink');
  });
});
