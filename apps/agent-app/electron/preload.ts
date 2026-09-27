/**
 * GUI-002 — Electron preload (runs in an isolated context). Exposes ONLY the loopback endpoint + lifecycle
 * signals to the renderer via `contextBridge` — no Node APIs leak into the GUI web app (agent-gui-web), and the endpoint
 * (which carries the auth nonce) is never placed on `window` as a plain value that page script could read
 * off a global before the bridge is set up.
 */

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

import type { IPickedFile, ITrustQuestion, TSidecarState, TTrustChoice } from './sidecar.js';

const api = {
  /** Resolve the loopback WS URL (with the token) the renderer connects to. */
  getEndpoint: (): Promise<string | null> => ipcRenderer.invoke('agent-gui:endpoint'),
  /**
   * The connection to the daemon is gone for good: ask the shell to start (or reuse) a daemon again. The
   * shell then reloads the page, which attaches to whatever the CLI answered.
   */
  restartRuntime: (): Promise<void> => ipcRenderer.invoke('agent-gui:restart'),
  /** Asked before anything starts in a folder not trusted yet; `null` when there is nothing to ask. */
  trustQuestion: (): Promise<ITrustQuestion | null> =>
    ipcRenderer.invoke('agent-gui:trust-question'),
  /** The person's answer. The shell reloads the page once a daemon is asked for; `error` keeps the question up. */
  answerTrust: (choice: TTrustChoice): Promise<{ error?: string }> =>
    ipcRenderer.invoke('agent-gui:trust-answer', choice),
  /** Tell the main process the session is live. The daemon is the CLI's to supervise, so nothing acts on it yet. */
  signalReady: (): void => ipcRenderer.send('agent-gui:ready'),
  /** The composer's attach button (#3282 §4d): a native multi-file dialog with real paths. */
  pickFiles: (): Promise<IPickedFile[]> => ipcRenderer.invoke('agent-gui:pick-files'),
  /**
   * The real filesystem path a dropped or picked `File` represents (#3282 §4d) — empty when the
   * object is not backed by one. A plain browser page has no equivalent; only this bridge does.
   */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  /** Subscribe to lifecycle state (`starting`/`ready`/`fatal`). Returns an unsubscribe fn. */
  /** `detail` accompanies `fatal`: what the CLI said when the daemon could not be started. */
  onState: (cb: (state: TSidecarState, detail?: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: TSidecarState, detail?: string): void =>
      cb(state, detail);
    ipcRenderer.on('agent-gui:state', listener);
    return () => ipcRenderer.removeListener('agent-gui:state', listener);
  },
};

// The page reads this as `IDesktopBridge` (packages/agent-gui-web/src/gui-host.ts); keep the two in step.
export type TAgentGuiBridge = typeof api;

contextBridge.exposeInMainWorld('agentGui', api);
