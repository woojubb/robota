// Sandboxed Electron preload scripts use CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron');
if (!process.isMainFrame) {
  ipcRenderer.on('fixture:child-request', () => ipcRenderer.send('desktop-session:request'));
}
