/**
 * GUI-002 — Electron preload (runs in an isolated context). Exposes ONLY the loopback endpoint + lifecycle
 * signals to the renderer via `contextBridge` — no Node APIs leak into the agent-transport-gui renderer, and the endpoint
 * (which carries the auth nonce) is never placed on `window` as a plain value that page script could read
 * off a global before the bridge is set up.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { TSidecarState } from './sidecar.js';

const api = {
  /** Resolve the loopback WS URL (with the token) the renderer connects to. */
  getEndpoint: (): Promise<string | null> => ipcRenderer.invoke('agent-gui:endpoint'),
  /** Tell the main process the session is live (drives the supervisor's `ready`). */
  signalReady: (): void => ipcRenderer.send('agent-gui:ready'),
  /** Subscribe to sidecar lifecycle state (`starting`/`ready`/`fatal`). Returns an unsubscribe fn. */
  onState: (cb: (state: TSidecarState) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: TSidecarState): void => cb(state);
    ipcRenderer.on('agent-gui:state', listener);
    return () => ipcRenderer.removeListener('agent-gui:state', listener);
  },
};

export type TAgentGuiBridge = typeof api;

contextBridge.exposeInMainWorld('agentGui', api);
