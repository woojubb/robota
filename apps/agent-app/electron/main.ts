/**
 * GUI-002 — Electron main process (Node). Thin shell: mint a loopback endpoint, spawn the `robota` sidecar,
 * load the agent-transport-gui renderer in a hardened BrowserWindow, and supervise the child. NO session/command/
 * permission logic lives here — all of that is in the sidecar, reached over the loopback WS (OWNER PRINCIPLE).
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { app, BrowserWindow, ipcMain, session, shell } from 'electron';

import {
  buildSidecarSpawn,
  endpointUrl,
  mintToken,
  resolveSidecarCommand,
  SidecarSupervisor,
  type ISidecarEndpoint,
  type TSidecarState,
} from './sidecar.js';

/** Ask the OS for a free loopback port (bind :0, read the assigned port, release). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('could not determine a free port')));
      }
    });
  });
}

let endpoint: ISidecarEndpoint | null = null;
let supervisor: SidecarSupervisor | null = null;

/** Inject a strict CSP pinning the renderer's only reachable socket to its own loopback sidecar. */
function installCsp(port: number): void {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; connect-src ws://127.0.0.1:${port}; img-src 'self' data:; ` +
            `style-src 'self' 'unsafe-inline'; script-src 'self'`,
        ],
      },
    });
  });
}

/** Deny all navigation + new-window: a redirected renderer must not carry the nonce/session to another origin. */
function lockNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

async function createWindow(): Promise<void> {
  const port = await findFreePort();
  endpoint = { port, token: mintToken() };

  // GUI-003: packaged → the bundled runtime under process.resourcesPath; dev/e2e → $ROBOTA_GUI_SIDECAR_CMD / PATH.
  const sidecar = buildSidecarSpawn(endpoint, {
    baseEnv: process.env,
    command: resolveSidecarCommand({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      platform: process.platform,
      env: process.env,
    }),
  });
  const child = spawn(sidecar.command, [...sidecar.args], { env: sidecar.env, stdio: 'inherit' });

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

  installCsp(port);
  lockNavigation(win);

  supervisor = new SidecarSupervisor(child, (state: TSidecarState) => {
    if (!win.isDestroyed()) win.webContents.send('agent-gui:state', state);
  });

  win.once('ready-to-show', () => win.show());
  await win.loadFile(join(__dirname, '../renderer/index.html'));

  win.on('close', () => supervisor?.shutdown());
}

// The renderer asks (via preload) for its loopback endpoint once, after the DOM is ready.
ipcMain.handle('agent-gui:endpoint', () => (endpoint ? endpointUrl(endpoint) : null));
ipcMain.on('agent-gui:ready', () => supervisor?.markReady());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  supervisor?.shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => supervisor?.shutdown());

// Never open external URLs inside the app.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});
