import { join } from 'node:path';
import { app, BrowserWindow, ipcMain } from 'electron';
import secretWindow from '../../dist/electron/secret-window.js';

const { openSecretWindow } = secretWindow;

app.setPath('userData', join(process.env.HOME, 'electron-user-data'));
let parent;
let pending;
app.whenReady().then(async () => {
  parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  globalThis.secretWindowFixture = {
    start() { pending = openSecretWindow(parent); },
    result() { return pending; },
    spoof() {
      ipcMain.emit('desktop-secret:submit', { sender: parent.webContents, senderFrame: parent.webContents.mainFrame },
        { type: 'passphrase', value: 'forged-parent' });
    },
  };
  await parent.loadURL('data:text/html,<html><body>Test parent</body></html>');
});
