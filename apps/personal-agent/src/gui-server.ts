/**
 * Where the personal agent finds its built web UI (`@robota-sdk/personal-gui-web`). Serving it behind
 * the access code is the shared loopback GUI server's job (`agent-local-host`), the same one the CLI
 * uses.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/** The built web UI, or `undefined` when it has not been built. */
export function resolveGuiRoot(): string | undefined {
  const require = createRequire(import.meta.url);
  try {
    const root = join(dirname(require.resolve('@robota-sdk/personal-gui-web/package.json')), 'dist');
    readFileSync(join(root, 'index.html'));
    return root;
  } catch {
    return undefined;
  }
}

/** The index markup that tells the GUI where its runtime is; the URL carries the WebSocket credential. */
export function guiHeadHtml(wsUrl: string): string {
  return `<meta name="ws-url" content="${wsUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}" />`;
}

export const GUI_LABELS = { title: 'Personal agent', prompt: 'Access code', submit: 'Open' } as const;
