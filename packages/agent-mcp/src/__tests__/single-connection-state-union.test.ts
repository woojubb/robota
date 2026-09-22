/**
 * TC-24: exactly ONE exported type alias under `packages/agent-mcp/src/**` (excluding `__tests__`) may
 * be a union whose every member is an object type with a literal `kind` property drawn from a set that
 * includes `'connected'` — i.e. models connection state. This is the "no second status model" half of
 * MCP-003 condition 8.
 *
 * The claim is a negative existential over every type the package declares, which only an AST walk can
 * enumerate — but PERF-005 forbids a first-party file (this one included) from importing `typescript`
 * directly. So the parse lives in `scripts/harness/scan-single-connection-state-union.mjs`, behind the
 * sanctioned native-AST adapter (`scripts/harness/lib/ts-ast.mjs`), and this file is a thin runner:
 * spawn the scan, assert it exits 0 and names `TMCPConnectionState`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
// packages/agent-mcp/src/__tests__ -> repo root, four levels up.
const REPO_ROOT = join(TESTS_DIR, '..', '..', '..', '..');
const SCAN_SCRIPT = join(REPO_ROOT, 'scripts/harness/scan-single-connection-state-union.mjs');

describe('package-scope invariant — exactly one connection-state union (TC-24)', () => {
  it('declares exactly one exported connection-state union under src/** (excluding __tests__)', () => {
    const result = spawnSync(process.execPath, [SCAN_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('TMCPConnectionState');
  });
});
