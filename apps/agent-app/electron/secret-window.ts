import { join } from 'node:path';

import { BrowserWindow, ipcMain, type IpcMainEvent } from 'electron';

/** The credential a person enters in the product's isolated secret window. */
export type TDesktopSecret =
  | { readonly type: 'passphrase'; readonly value: string }
  | { readonly type: 'recovery'; readonly value: string };

const SUBMIT = 'desktop-secret:submit';
const CANCEL = 'desktop-secret:cancel';
let activePrompt: object | undefined;

function readSecret(value: unknown): TDesktopSecret | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value) || !('value' in value)) {
    return undefined;
  }
  if (
    (value.type !== 'passphrase' && value.type !== 'recovery') ||
    typeof value.value !== 'string' ||
    value.value.length === 0
  ) {
    return undefined;
  }
  return { type: value.type, value: value.value };
}

/** Open one isolated, product-owned credential prompt. Closing it is a cancellation. */
export async function openSecretWindow(parent: BrowserWindow, signal?: AbortSignal): Promise<TDesktopSecret | undefined> {
  if (signal?.aborted) return undefined;
  if (activePrompt) throw new Error('A secret window is already open.');
  if (parent.isDestroyed()) throw new Error('The parent window is closed.');
  const reservation = {};
  activePrompt = reservation;
  return new Promise((resolve, reject) => {
    let window: BrowserWindow | undefined;
    let settled = false;
    const cleanup = (): void => {
      ipcMain.removeListener(SUBMIT, onSubmit);
      ipcMain.removeListener(CANCEL, onCancel);
      parent.removeListener('closed', onParentClosed);
      signal?.removeEventListener('abort', onAbort);
      if (activePrompt === reservation) activePrompt = undefined;
    };
    const finish = (secret: TDesktopSecret | undefined): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (window && !window.isDestroyed()) window.destroy();
      resolve(secret);
    };
    const onParentClosed = (): void => finish(undefined);
    const onAbort = (): void => finish(undefined);
    const isOwnFrame = (event: IpcMainEvent): boolean =>
      window !== undefined && !window.isDestroyed() &&
      event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    const onSubmit = (event: IpcMainEvent, value: unknown): void => {
      if (!isOwnFrame(event)) return;
      const secret = readSecret(value);
      if (secret !== undefined) finish(secret);
    };
    const onCancel = (event: IpcMainEvent): void => {
      if (isOwnFrame(event)) finish(undefined);
    };
    try {
      window = new BrowserWindow({
        parent,
        modal: true,
        show: false,
        width: 460,
        height: 280,
        resizable: false,
        minimizable: false,
        maximizable: false,
        webPreferences: {
          preload: join(__dirname, 'secret-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          devTools: false,
        },
      });
      const prompt = window;
      if (prompt.isDestroyed() || signal?.aborted || parent.isDestroyed()) { finish(undefined); return; }
      prompt.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      prompt.webContents.on('will-navigate', (event) => event.preventDefault());
      prompt.webContents.on('will-redirect', (event) => event.preventDefault());
      prompt.once('ready-to-show', () => { if (!prompt.isDestroyed()) prompt.show(); });
      prompt.once('closed', () => finish(undefined));
      parent.once('closed', onParentClosed);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (prompt.isDestroyed() || signal?.aborted || parent.isDestroyed()) { finish(undefined); return; }
      ipcMain.on(SUBMIT, onSubmit);
      if (settled) { cleanup(); return; }
      ipcMain.on(CANCEL, onCancel);
      if (settled) { cleanup(); return; }
      void prompt.loadFile(join(__dirname, 'secret', 'index.html')).catch((error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!prompt.isDestroyed()) prompt.destroy();
        reject(error);
      });
    } catch (error) {
      settled = true;
      cleanup();
      if (window && !window.isDestroyed()) window.destroy();
      reject(error);
    }
  });
}
