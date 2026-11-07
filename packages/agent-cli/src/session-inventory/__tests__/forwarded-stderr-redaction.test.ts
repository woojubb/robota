import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { expect, it } from 'vitest';

import { createTestBinaryEnvironment } from '../../__tests__/helpers/product-runtime.js';

it('redacts forwarded reference values from a failing child startup message', async () => {
  const root = realpathSync(mkdtempSync(join(process.platform === 'win32' ? tmpdir() : realpathSync('/tmp'), 'stderr-')));
  try {
    const fixture = fileURLToPath(new URL('../../testing/forwarded-stderr-launch.ts', import.meta.url));
    const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    const child = spawn(process.execPath, ['--import', tsx, '--conditions=source', fixture], { cwd: root, env: createTestBinaryEnvironment(root), stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe'] });
    const [message] = await once(child, 'message');
    expect(message).toHaveProperty('error', expect.stringContaining('startup failure'));
    expect(JSON.stringify(message)).not.toContain('synthetic-sensitive-reference-value');
    expect(JSON.stringify(message)).not.toContain('xY');
    await once(child, 'exit');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
