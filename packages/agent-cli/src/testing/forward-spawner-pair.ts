import { fstatSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

import { launchForwardedRuntime } from '../session-inventory/supervised-session-launch.js';
import { resolveCliRuntimeContext } from '../startup/product-bootstrap.js';

const runtime = resolveCliRuntimeContext({ environment: process.env });
const fixture = fileURLToPath(new URL('./secure-runtime-entry.ts', import.meta.url));
try {
  const id = await launchForwardedRuntime(process.cwd(), {
    productRuntime: runtime,
    entrypoint: fixture,
    execArgs: ['--import', pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href, '--conditions=source'],
    env: process.env,
    restricted: true,
    spawnerFd: 4,
  });
  let pairClosed = false;
  try { fstatSync(4, { bigint: true }); } catch { pairClosed = true; }
  process.send?.({ id, pairClosed });
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : 'failed' });
  process.exitCode = 1;
}
