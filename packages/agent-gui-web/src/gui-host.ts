/**
 * #3186 — the seam between the GUI web app and whatever hosts it.
 *
 * The same build runs in the desktop app, in a browser tab the CLI serves (`robota --serve --open`),
 * and in the Vite dev server. The desktop app attaches to the workspace's robota daemon and hands the
 * page its address through the Electron preload bridge; a browser page finds the address in the page itself. Nothing
 * else in the app knows which host it is in.
 */

import { readInjectedWsUrl, resolveWsUrl } from './ws-url.js';

/** The runtime's state as the desktop host reports it. A browser host has no process to report. */
export type TGuiHostState = 'starting' | 'ready' | 'fatal';

/** What a person is asked before anything starts in a folder not trusted yet (issue #3268). */
export interface IGuiTrustQuestion {
  readonly folder: string;
  /** The project sources trust would load, one row each. */
  readonly loads: readonly string[];
}

/** Trust the folder and start, start it Restricted, or quit. */
export type TGuiTrustChoice = 'trust' | 'restricted' | 'quit';

/**
 * One file the desktop host's native "Attach files" dialog returned (#3282 §4d), with its real size.
 * Kept in structural sync with `IPickedFile` in `apps/agent-app/electron/sidecar.ts` — the two are not
 * imported across the Electron/browser boundary, same as `IGuiTrustQuestion`/`ITrustQuestion` above.
 */
export interface IPickedFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
}

/** What the Electron preload exposes as `window.agentGui` (apps/agent-app/electron/preload.ts). */
export interface IDesktopBridge {
  getEndpoint(): Promise<string | null>;
  signalReady(): void;
  onState(listener: (state: TGuiHostState, detail?: string) => void): () => void;
  restartRuntime(): Promise<void>;
  trustQuestion(): Promise<IGuiTrustQuestion | null>;
  answerTrust(choice: TGuiTrustChoice): Promise<{ error?: string }>;
  pickFiles(): Promise<IPickedFile[]>;
  getPathForFile(file: File): string;
  /** #3282 §4a: the App menu's "Settings…" (⌘,/Ctrl+,) asked to open the Settings screen. */
  onOpenSettings(listener: () => void): () => void;
}

export interface IGuiHost {
  readonly kind: 'desktop' | 'browser';
  /** The runtime's WebSocket URL, token included. */
  getEndpoint(): Promise<string | null>;
  /** The session is live. */
  signalReady(): void;
  /** `detail` accompanies `fatal`: why the runtime could not be reached, when it said. */
  onState(listener: (state: TGuiHostState, detail?: string) => void): () => void;
  /**
   * Present when the host can bring the runtime back after the page lost it for good (the desktop app,
   * which asks the CLI to start or reuse the daemon and then reloads the page). A browser host cannot.
   */
  readonly restartRuntime?: () => Promise<void>;
  /**
   * Present when the host starts the runtime itself and can ask about the folder first (the desktop
   * app). `null` means nothing to ask; ask before reading the endpoint.
   */
  readonly trustQuestion?: () => Promise<IGuiTrustQuestion | null>;
  /** The person's answer; the host reloads the page once the runtime is asked for. */
  readonly answerTrust?: (choice: TGuiTrustChoice) => Promise<{ error?: string }>;
  /**
   * Present when the host can open a native multi-file picker with real filesystem paths (the desktop
   * app) — #3282 §4d. Its absence means the composer's attach button falls back to a plain HTML file
   * input, whose picks a plain browser can never resolve to a path (rule 3: shown plainly, attached
   * nothing).
   */
  readonly pickFiles?: () => Promise<readonly IPickedFile[]>;
  /**
   * Present when the host can resolve a dropped or picked `File` to its real filesystem path (the
   * desktop app, via Electron's `webUtils.getPathForFile`) — #3282 §4d. Its absence means a drop's
   * files can never become `@`-references either — only the button's native dialog can, on desktop.
   */
  readonly getPathForFile?: (file: File) => string;
  /**
   * #3282 §4a: the host's own entry point for Settings, beside the gear button every surface has
   * (the desktop app's ⌘,/Ctrl+, menu item). A browser host has none — its no-op still returns an
   * unsubscribe function, so a caller never has to branch on whether this host offers one.
   */
  onOpenSettings(listener: () => void): () => void;
}

export interface IGuiHostEnvironment {
  readonly bridge: IDesktopBridge | undefined;
  readonly document: Pick<Document, 'querySelector'>;
  readonly location: Pick<Location, 'search' | 'host'>;
}

/**
 * The browser address, in order: the one the CLI injected into the page it serves, then `?ws=` on
 * the page URL (the dev server), then the page's own host (HTTP and WS on one port).
 */
function browserEndpoint(environment: IGuiHostEnvironment): string {
  const injected = readInjectedWsUrl(environment.document);
  if (injected?.trim()) return injected.trim();
  const fromQuery = new URLSearchParams(environment.location.search).get('ws');
  return resolveWsUrl(fromQuery, environment.location.host);
}

export function resolveGuiHost(environment: IGuiHostEnvironment): IGuiHost {
  const { bridge } = environment;
  if (bridge) {
    return {
      kind: 'desktop',
      getEndpoint: () => bridge.getEndpoint(),
      signalReady: () => bridge.signalReady(),
      onState: (listener) => bridge.onState(listener),
      restartRuntime: () => bridge.restartRuntime(),
      trustQuestion: () => bridge.trustQuestion(),
      answerTrust: (choice) => bridge.answerTrust(choice),
      pickFiles: () => bridge.pickFiles(),
      getPathForFile: (file) => bridge.getPathForFile(file),
      onOpenSettings: (listener) => bridge.onOpenSettings(listener),
    };
  }
  const endpoint = browserEndpoint(environment);
  return {
    kind: 'browser',
    getEndpoint: async () => endpoint,
    signalReady: () => {},
    onState: () => () => {},
    onOpenSettings: () => () => {},
  };
}
