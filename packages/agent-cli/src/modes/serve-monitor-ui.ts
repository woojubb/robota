/**
 * Serve the GUI web app (`packages/agent-gui-web`, copied to this package's
 * `dist/web`) over a localhost-only HTTP server, injecting the live `ws-url` into `index.html`. This is the
 * CLI OWNING and SERVING its own GUI (a localhost-origin surface) — the secure replacement for a deployed
 * page reaching into `localhost`. Kept SEPARATE from the WS transport (a neutral library must not serve a UI).
 *
 * The WS URL contains the transport credential, so the index is served through the shared access-code
 * GUI server in `agent-local-host`, which every product that serves its GUI on this machine uses.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withChildSession } from '@robota-sdk/agent-core/node';
import { startLoopbackGuiServer } from '@robota-sdk/agent-local-host';
import { publicProductConfig } from '@robota-sdk/product-config';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** A running monitor-UI HTTP server: its localhost URL + a graceful close. */
export interface IMonitorUiServer {
  url: string;
  accessCode: string;
  close: () => Promise<void>;
}

/**
 * What `--serve --open` prints once the page is up. "The product", not "web monitor" — the
 * person opening it is looking at their own running session, not a separate observability tool.
 */
export function servedAtMessage(url: string, runtime: ICliRuntimeContext): string {
  return `${runtime.config.identity.displayName} is open at ${url}\n`;
}

/**
 * Resolve the built web-monitor asset root (`dist/web`, assembled from a pinned web-producer generation).
 * From the compiled module at `dist/node/…`, the assets sit at `dist/web`. Returns null if not present (a
 * dev tree without a CLI build) — the caller then skips serving the UI without failing the WS host.
 */
export function resolveWebRoot(): string | null {
  const candidate = fileURLToPath(new URL('../web', import.meta.url));
  return existsSync(join(candidate, 'index.html')) ? candidate : null;
}

/** A separate product serves only assets explicitly packaged by its own entry. */
export function resolveProductWebRoot(runtime: ICliRuntimeContext): string | null {
  return runtime.artifact === undefined ? resolveWebRoot() : (runtime.artifact.webRoot ?? null);
}

/** The CLI's index additions: the live WS URL and the public product configuration. */
function monitorHead(wsUrl: string, runtime: ICliRuntimeContext): string {
  const config = JSON.stringify(publicProductConfig(runtime.config)).replaceAll('<', '\\u003c');
  return `<meta name="ws-url" content="${wsUrl}" /><script id="product-config" type="application/json">${config}</script>`;
}

/**
 * Serve the monitor SPA at `webRoot` on loopback through the shared access-code GUI server,
 * injecting the live WS URL and the product configuration into its index.
 */
export async function startMonitorUiServer(
  webRoot: string,
  wsUrl: string,
  runtime: ICliRuntimeContext,
): Promise<IMonitorUiServer> {
  return startLoopbackGuiServer({ webRoot, headHtml: monitorHead(wsUrl, runtime) });
}

/** Best-effort open of `url` in the default browser (macOS `open`, Windows `start`, else `xdg-open`). */
export function openInBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    // Detached and unreferenced in both modes: the opener hands off to the browser and is not ended
    // with this process.
    const child = spawn(cmd, [url], withChildSession({
      stdio: 'ignore',
      detached: true,
      shell: process.platform === 'win32',
    }));
    child.on('error', () => {});
    child.unref();
  } catch {
    // allow-fallback: opening the browser is a convenience — a failure must not crash the serve host.
  }
}
