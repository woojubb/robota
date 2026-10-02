/**
 * GUI-002 — Electron preload (runs in an isolated context). Exposes a narrow, named surface to the
 * renderer via `contextBridge`, never a raw Node API: the loopback endpoint and lifecycle signals, the
 * trust question/answer, and (#3282 §4d) the composer's native "Attach files" dialog and resolving a
 * dropped/picked `File` to its real path. The endpoint (which carries the auth nonce) is never placed
 * on `window` as a plain value that page script could read off a global before the bridge is set up.
 */

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';

import type { IPickedFile, ITrustQuestion, TSidecarState, TTrustChoice } from './sidecar.js';

const remoteMode = ipcRenderer.sendSync('agent-gui:runtime-mode') === 'remote';
const api = {
  runtimeMode: remoteMode ? ('remote' as const) : ('local' as const),
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
  getPathForFile: (file: File): string => (remoteMode ? '' : webUtils.getPathForFile(file)),
  /** The Project panel's Memory "Open in editor" (#3282 §4c): open a project-relative path in the OS
   *  default app for it. */
  openPath: (path: string): Promise<{ error?: string }> =>
    ipcRenderer.invoke('agent-gui:open-path', path),
  /** Subscribe to lifecycle state (`starting`/`ready`/`fatal`). Returns an unsubscribe fn. */
  /** `detail` accompanies `fatal`: what the CLI said when the daemon could not be started. */
  onState: (cb: (state: TSidecarState, detail?: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, state: TSidecarState, detail?: string): void =>
      cb(state, detail);
    ipcRenderer.on('agent-gui:state', listener);
    return () => ipcRenderer.removeListener('agent-gui:state', listener);
  },
  /** #3282 §4a: the App menu's "Settings…" (⌘,/Ctrl+,) asked the page to open the Settings screen. */
  onOpenSettings: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on('agent-gui:open-settings', listener);
    return () => ipcRenderer.removeListener('agent-gui:open-settings', listener);
  },
};

// The page reads this as `IDesktopBridge` (packages/agent-gui-web/src/gui-host.ts); keep the two in step.
export type TAgentGuiBridge = typeof api;

contextBridge.exposeInMainWorld('agentGui', api);
