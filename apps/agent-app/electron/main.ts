/**
 * GUI-002 — Electron main process (Node). Thin shell: ask the `robota` CLI to start this workspace's daemon
 * (or reuse the live one), load the GUI web app (agent-gui-web) in a hardened BrowserWindow, and hand the
 * page the daemon's loopback address. The daemon belongs to the CLI and outlives the window. NO session/
 * command/permission logic lives here — all of that is in the daemon, reached over the loopback WS.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, session, shell, type WebContents } from 'electron';

import {
  appendOutputTail,
  buildDaemonStartSpawn,
  describeDaemonStartFailure,
  parseDaemonStartOutput,
  resolveSidecarCommand,
  type IDaemonEndpoint,
} from './sidecar.js';

/** Where the daemon is, or why the shell could not get one. */
type TDaemonStart = { ok: true; endpoint: IDaemonEndpoint } | { ok: false; detail: string };

/** Run `robota daemon start --json` in this process's cwd and env, and read its answer. */
function startDaemon(): Promise<TDaemonStart> {
  const invocation = buildDaemonStartSpawn(
    // GUI-003: packaged → the bundled runtime under process.resourcesPath; dev/e2e → $ROBOTA_GUI_SIDECAR_CMD / PATH.
    resolveSidecarCommand({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      env: process.env,
    }),
    process.env,
  );
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(invocation.command, [...invocation.args], {
      env: invocation.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendOutputTail(stdout, chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderr = appendOutputTail(stderr, chunk.toString('utf8'));
    });
    child.once('error', (error) => {
      resolve({ ok: false, detail: `Could not run ${invocation.command}: ${error.message}` });
    });
    // `close` (not `exit`) fires after both output streams have drained.
    child.once('close', (exitCode) => {
      const endpoint = exitCode === 0 ? parseDaemonStartOutput(stdout) : undefined;
      resolve(
        endpoint
          ? { ok: true, endpoint }
          : { ok: false, detail: describeDaemonStartFailure({ exitCode, stderr, stdout }) },
      );
    });
  });
}

/** Started once the app is ready; the endpoint IPC awaits it, so the renderer never races the start. */
let daemonStart: Promise<TDaemonStart> | null = null;

/**
 * Inject a strict CSP pinning the renderer's only reachable socket to the daemon's loopback port — or to
 * nothing, when there is no daemon and the page only shows why.
 */
function installCsp(port: number | undefined): void {
  const connectSrc = port === undefined ? `'none'` : `ws://127.0.0.1:${port}`;
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; connect-src ${connectSrc}; img-src 'self' data:; ` +
            `style-src 'self' 'unsafe-inline'; script-src 'self'`,
        ],
      },
    });
  });
}

/** Deny all navigation + new-window: a redirected renderer must not carry the token/session to another origin. */
function lockNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

async function createWindow(): Promise<void> {
  daemonStart = startDaemon();

  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  lockNavigation(win);
  win.once('ready-to-show', () => win.show());

  // The CSP is fixed when the page loads, so the page loads once the daemon's port is known. A failed
  // start still loads the page: it shows the fatal screen with the CLI's reason.
  const started = await daemonStart;
  installCsp(started.ok ? started.endpoint.port : undefined);
  await win.loadFile(join(__dirname, '../renderer/index.html'));
}

/**
 * The renderer asks (via preload) for its endpoint once, after the DOM is ready and after it has
 * subscribed to state. A failed start answers `null` and reports `fatal` with the reason to that page.
 */
ipcMain.handle('agent-gui:endpoint', async (event): Promise<string | null> => {
  const started = daemonStart ? await daemonStart : null;
  if (started?.ok) return started.endpoint.url;
  reportFatal(event.sender, started?.detail);
  return null;
});

function reportFatal(sender: WebContents, detail: string | undefined): void {
  if (!sender.isDestroyed()) sender.send('agent-gui:state', 'fatal', detail);
}

// INFRA-040: the rejection is ROUTED. `createWindow` starts the daemon and loads the renderer; if that
// fails the app has no window and, before this, no message either — the process just sat there. `.catch`
// after `.then`, not `.then(fn, onRejected)`, because the second argument handles a rejection of
// `whenReady()` alone and would let a `createWindow` failure float on unchanged.
app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    console.error('[agent-app] failed to create the main window:', error);
    app.quit();
  });

// Closing the window leaves the daemon running: it is the workspace's, and the next launch reattaches.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Never open external URLs inside the app.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
