import { contextBridge, ipcRenderer } from 'electron';

// This preload belongs only to the product's isolated credential window.
contextBridge.exposeInMainWorld('desktopSecret', {
  submit: (type: string, value: string): void => {
    ipcRenderer.send('desktop-secret:submit', { type, value });
  },
  cancel: (): void => { ipcRenderer.send('desktop-secret:cancel'); },
});
