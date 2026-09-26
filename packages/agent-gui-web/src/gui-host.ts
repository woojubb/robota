/**
 * #3186 — the seam between the GUI web app and whatever hosts it.
 *
 * The same build runs in the desktop app, in a browser tab the CLI serves (`robota --serve --open`),
 * and in the Vite dev server. The desktop app supervises a sidecar and hands the page its address
 * through the Electron preload bridge; a browser page finds the address in the page itself. Nothing
 * else in the app knows which host it is in.
 */

import { readInjectedWsUrl, resolveWsUrl } from './ws-url.js';

/** Sidecar lifecycle as the desktop host reports it. A browser host has no process to report. */
export type TGuiHostState = 'starting' | 'ready' | 'fatal';

/** What the Electron preload exposes as `window.agentGui` (apps/agent-app/electron/preload.ts). */
export interface IDesktopBridge {
  getEndpoint(): Promise<string | null>;
  signalReady(): void;
  onState(listener: (state: TGuiHostState) => void): () => void;
}

export interface IGuiHost {
  readonly kind: 'desktop' | 'browser';
  /** The sidecar WebSocket URL, token included. */
  getEndpoint(): Promise<string | null>;
  /** The session is live — the desktop host marks its sidecar ready. */
  signalReady(): void;
  onState(listener: (state: TGuiHostState) => void): () => void;
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
    };
  }
  const endpoint = browserEndpoint(environment);
  return {
    kind: 'browser',
    getEndpoint: async () => endpoint,
    signalReady: () => {},
    onState: () => () => {},
  };
}
