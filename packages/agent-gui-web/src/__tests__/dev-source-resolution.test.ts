/**
 * `pnpm gui:dev` serves the page from source: the dev server resolves the workspace UI library through its
 * `source` export condition, so a fresh checkout needs no build and edits to the library hot-reload
 * instead of going stale behind its `dist`. `vite build` keeps resolving the built `dist`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const uiWebSource = path.resolve(packageRoot, '..', 'agent-ui-web', 'src', 'index.ts');

describe('the GUI dev server', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    server = await createServer({
      root: packageRoot,
      configFile: path.join(packageRoot, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: false },
      logLevel: 'silent',
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('resolves the workspace UI library to its TypeScript source', async () => {
    const resolved = await server.pluginContainer.resolveId(
      '@robota-sdk/agent-ui-web/client',
      path.join(packageRoot, 'src', 'main.tsx'),
    );

    expect(resolved?.id).toBe(uiWebSource);
  });
});
