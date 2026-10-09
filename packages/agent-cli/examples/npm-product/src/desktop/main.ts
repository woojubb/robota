import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDesktopCliController } from '@robota-sdk/agent-cli/desktop-host';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';

import { productArtifact, type TFixtureProduct } from '../shared/product.js';

type TState = 'starting' | 'ready' | 'fatal';

/** Consumer-owned Electron shell. The public helper owns trust/daemon attachment decisions. */
export async function startDesktop(product: TFixtureProduct): Promise<void> {
  const executable = `${product}-runtime${process.platform === 'win32' ? '.exe' : ''}`;
  const nativeRoot = app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : resolve(fileURLToPath(new URL('../../native/', import.meta.url)));
  const binary = join(nativeRoot, executable);
  const controller = createDesktopCliController({
    artifact: productArtifact(product, 'native'),
    environment: process.env,
    execute: (args, environment) => new Promise((done) => {
      execFile(binary, [...args], {
        env: { ...environment },
        maxBuffer: 1_000_000,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        done({
          exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          stdout,
          stderr: stderr || (error?.message ?? ''),
        });
      });
    }),
    chooseTrust: async (question) => {
      const result = await dialog.showMessageBox({
        type: 'question',
        title: `Trust ${product} workspace?`,
        message: `Trust ${question.folder}?`,
        detail: question.loads.join('\n'),
        buttons: ['Trust', 'Restricted', 'Quit'],
        defaultId: 1,
        cancelId: 2,
      });
      return (['trust', 'restricted', 'quit'] as const)[result.response] ?? 'quit';
    },
  });

  mkdirSync(controller.userDataPath, { recursive: true });
  app.setPath('userData', controller.userDataPath);
  await app.whenReady();

  let window: BrowserWindow | null = null;
  let state: TState = 'starting';
  let detail: string | undefined;
  let endpoint: string | null = null;
  const report = (next: TState, reason?: string): void => {
    state = next;
    detail = reason;
    window?.webContents.send('fixture:state', state, detail);
  };
  const attach = async (reconnect: boolean): Promise<void> => {
    report('starting');
    const result = reconnect ? await controller.reconnect() : await controller.start();
    if (result.ok) {
      endpoint = result.endpoint.url;
      report('ready');
      if (reconnect) window?.reload();
    } else {
      endpoint = null;
      report('fatal', result.detail);
    }
  };

  ipcMain.handle('fixture:endpoint', () => endpoint);
  ipcMain.handle('fixture:restart', async () => { await attach(true); });
  ipcMain.on('fixture:state-now', (event) => { event.returnValue = { state, detail }; });
  ipcMain.on('fixture:ready', () => report('ready'));

  await attach(false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [controller.csp()],
    } });
  });
  window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
    },
  });
  const renderer = app.isPackaged
    ? join(process.resourcesPath, 'renderer', 'index.html')
    : resolve(fileURLToPath(new URL(`../../renderer/${product}/index.html`, import.meta.url)));
  await window.loadFile(renderer);
  app.on('window-all-closed', () => app.quit());
}
