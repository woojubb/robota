import { createTestBinaryEnvironment } from './helpers/product-runtime.js';
/**
 * `scripts/dev/agent` is the one executable that runs the repo's CLI from source: `pnpm cli:dev` runs it,
 * the browser GUI starts its sidecar with it, and the desktop app gets it as `PRODUCT_GUI_SIDECAR_CMD`,
 * which is spawned as a bare command (no shell, no interpreter). It must therefore be directly executable
 * and answer as this checkout's CLI, not as some `the product` on PATH.
 */

import { spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const home = mkdtempSync(path.join(tmpdir(), 'test-product-launcher-'));

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe('scripts/dev/agent', () => {
  it('is executable as a bare command', () => {
    expect(() => accessSync(launcher, constants.X_OK)).not.toThrow();
  });

  it("runs this checkout's CLI", () => {
    const { version } = JSON.parse(
      readFileSync(path.join(repoRoot, 'packages', 'agent-cli', 'package.json'), 'utf8'),
    ) as { version: string };
    const result = spawnSync(launcher, ['--version'], {
      cwd: home,
      env: createTestBinaryEnvironment(home),
      encoding: 'utf8',
      timeout: 60_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`test-product ${version}`);
  }, 70_000);
});
