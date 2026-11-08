import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
import { type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stopSupervisedSession } from '../supervised-session-control.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

const fixture = fileURLToPath(new URL('./fixtures/supervised-serve-fixture.ts', import.meta.url));

/**
 * A supervised runtime launched under Node must disable the SIGUSR1 inspector so a same-user
 * process cannot open the debugger on the long-lived daemon and read or drive the session. The flag
 * is a Node capability; the test runs only where this Node accepts it (it is a no-op under Bun).
 */
describe('supervised runtime inspector hardening', () => {
  const supported =
    process.versions.bun === undefined &&
    process.allowedNodeEnvironmentFlags.has('--disable-sigusr1');

  it.skipIf(process.platform === 'win32' || !supported)(
    'passes --disable-sigusr1 to the Node child',
    async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'rs-harden-'));
      const root = join(scratch, 'supervised');
      let child: ChildProcess | undefined;
      let id: string | undefined;
      try {
        id = await launchSupervisedSession(process.cwd(), {
          productRuntime: createTestProductRuntime(),
          entrypoint: fixture,
          execArgs: ['--import', 'tsx', '--conditions=product-source'],
          env: { PRODUCT_TEST_SUPERVISED_ROOT: root },
          onSpawn: (spawned) => { child = spawned; },
        });
        expect(child?.spawnargs).toContain('--disable-sigusr1');
      } finally {
        if (id) {
          try { await stopSupervisedSession(id, root); } catch { /* already stopped */ }
        }
        rmSync(scratch, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
