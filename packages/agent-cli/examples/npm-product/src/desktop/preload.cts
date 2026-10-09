import { contextBridge, ipcRenderer } from 'electron';

import type { IClientRuntimeBridge, TClientRuntimeState } from '@robota-sdk/agent-ui-web/client';

/** The preload exposes only the browser-safe client contract, never Node or raw IPC. */
const bridge: IClientRuntimeBridge = {
  runtimeMode: 'local',
  getEndpoint: () => ipcRenderer.invoke('fixture:endpoint'),
  signalReady: () => { ipcRenderer.send('fixture:ready'); },
  onState: (listener) => {
    const event = (_event: Electron.IpcRendererEvent, state: TClientRuntimeState, detail?: string): void =>
      listener(state, detail);
    ipcRenderer.on('fixture:state', event);
    const current = ipcRenderer.sendSync('fixture:state-now') as { state: TClientRuntimeState; detail?: string };
    queueMicrotask(() => listener(current.state, current.detail));
    return () => ipcRenderer.removeListener('fixture:state', event);
  },
  restartRuntime: () => ipcRenderer.invoke('fixture:restart'),
  trustQuestion: async () => null, // Native dialog runs before the daemon starts.
  answerTrust: async () => ({ error: 'The native host owns the trust decision.' }),
};

contextBridge.exposeInMainWorld('fixtureBridge', bridge);
