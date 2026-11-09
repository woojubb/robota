import { productEnvironment } from '../../../product-config/src/__tests__/product-environment.js';
/**
 * `pnpm gui:dev` serves the product from source and resolves its SDK UI library from the pinned artifact.
 */

import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const installedUi = realpathSync(path.join(packageRoot, 'node_modules/@robota-sdk/agent-ui-web'));

describe('the GUI dev server', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(productEnvironment('cedar'))) vi.stubEnv(key, value);
    server = await createServer({
      root: packageRoot,
      configFile: path.join(packageRoot, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    });
  });

  afterAll(async () => {
    await server?.close();
    vi.unstubAllEnvs();
  });

  it('resolves the UI library to the installed SDK artifact', async () => {
    const resolved = await server.pluginContainer.resolveId(
      '@robota-sdk/agent-ui-web/client',
      path.join(packageRoot, 'src', 'main.tsx'),
    );

    expect(resolved).toBeDefined();
    expect(realpathSync(resolved!.id.split('?')[0]!).startsWith(`${installedUi}${path.sep}`)).toBe(true);
  });
});
