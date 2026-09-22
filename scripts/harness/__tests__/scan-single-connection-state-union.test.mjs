import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

/**
 * HARNESS-098 fixture floor. `scan-single-connection-state-union.mjs` is, by its own header
 * comment, "a thin runner that spawns this script and asserts its exit code and its stdout" —
 * so this fixture spawns the real script against a scratch `packages/agent-mcp/src` tree rather
 * than re-deriving the AST predicate. `--root` is the override `resolveWorkspaceRoot` reads when
 * the script runs as its own process entry (`scripts/harness/shared.mjs`); the module-level
 * `WORKSPACE_ROOT` in the target script is computed at import time from `process.argv`, so it
 * picks the override up before `main()` ever runs.
 */
const SCAN_SCRIPT = fileURLToPath(
  new URL('../scan-single-connection-state-union.mjs', import.meta.url),
);

const CONNECTION_STATE_UNION = `export type ConnectionState =
  | { readonly kind: 'connected'; readonly since: number }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'disconnected' };
`;

const OTHER_CONNECTION_STATE_UNION = `export type TransportStatus =
  | { readonly kind: 'connected' }
  | { readonly kind: 'closed' };
`;

function fixture(files) {
  const root = makeTemp('robota-single-connection-state-union-');
  for (const [relativePath, contents] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, contents, 'utf8');
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [SCAN_SCRIPT, '--root', root], { encoding: 'utf8' });
}

describe('scan-single-connection-state-union (HARNESS-098 fixture)', () => {
  it('passes (exit 0) on exactly one exported connection-state union, and names it and its file', () => {
    const root = fixture({
      'packages/agent-mcp/src/connection.ts': CONNECTION_STATE_UNION,
    });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('single-connection-state-union scan passed');
    expect(result.stdout).toContain('ConnectionState');
    expect(result.stdout).toContain('packages/agent-mcp/src/connection.ts');
  });

  it('fails (exit 1) on a SECOND exported connection-state union elsewhere under src/, listing both', () => {
    const root = fixture({
      'packages/agent-mcp/src/connection.ts': CONNECTION_STATE_UNION,
      'packages/agent-mcp/src/transport-status.ts': OTHER_CONNECTION_STATE_UNION,
    });

    const result = run(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('single-connection-state-union scan FAILED');
    expect(result.stderr).toContain('ConnectionState (packages/agent-mcp/src/connection.ts)');
    expect(result.stderr).toContain('TransportStatus (packages/agent-mcp/src/transport-status.ts)');
  });

  it('ignores a second connection-state union declared under src/__tests__/ (still exit 0)', () => {
    const root = fixture({
      'packages/agent-mcp/src/connection.ts': CONNECTION_STATE_UNION,
      'packages/agent-mcp/src/__tests__/transport-status.ts': OTHER_CONNECTION_STATE_UNION,
    });

    const result = run(root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('single-connection-state-union scan passed');
    expect(result.stdout).toContain('ConnectionState');
    expect(result.stdout).not.toContain('TransportStatus');
  });
});
