import { fileURLToPath } from 'node:url';

import { launchForwardedRuntime } from '../session-inventory/supervised-session-launch.js';
import { resolveCliRuntimeContext } from '../startup/product-bootstrap.js';

const runtime = resolveCliRuntimeContext({ environment: process.env });
try {
  await launchForwardedRuntime(process.cwd(), {
    productRuntime: runtime,
    entrypoint: fileURLToPath(new URL('./forwarded-stderr-child.mjs', import.meta.url)),
    env: { PATH: process.env.PATH },
    spawnerFd: 4,
    prepareEnvironment: async () => ({ environment: { REFERENCE_ONLY: 'synthetic-sensitive-reference-value', REFERENCE_TWO: 'xY' }, availableCredentialNames: [] }),
  });
} catch (error) {
  process.send?.({ error: error instanceof Error ? error.message : 'failed' });
}
