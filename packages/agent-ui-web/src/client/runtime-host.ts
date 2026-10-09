import type { IPickedFile } from '../components/Composer.js';

/** Runtime events delivered by a native host. Browser pages have no process to supervise. */
export type TClientRuntimeState = 'starting' | 'ready' | 'fatal';

/** A folder decision must be shown before requesting the runtime endpoint. */
export interface IClientTrustQuestion {
  readonly folder: string;
  readonly loads: readonly string[];
}

export type TClientTrustChoice = 'trust' | 'restricted' | 'quit';

/**
 * Browser-safe shape for a narrow native preload bridge. The native host implements validation,
 * trust, process lifecycle, and endpoint ownership; the renderer receives only these operations.
 */
export interface IClientRuntimeBridge {
  readonly runtimeMode?: 'local' | 'remote';
  getEndpoint(): Promise<string | null>;
  signalReady(): void;
  onState(listener: (state: TClientRuntimeState, detail?: string) => void): () => void;
  restartRuntime(): Promise<void>;
  trustQuestion(): Promise<IClientTrustQuestion | null>;
  answerTrust(choice: TClientTrustChoice): Promise<{ error?: string }>;
  pickFiles?(): Promise<readonly IPickedFile[]>;
  getPathForFile?(file: File): string;
  onOpenSettings?(listener: () => void): () => void;
  openPath?(path: string): Promise<{ error?: string }>;
}

/** A React renderer can use this contract with either a desktop bridge or a browser endpoint. */
export interface IClientRuntimeHost {
  readonly kind: 'desktop' | 'browser';
  getEndpoint(): Promise<string | null>;
  signalReady(): void;
  onState(listener: (state: TClientRuntimeState, detail?: string) => void): () => void;
  readonly restartRuntime?: () => Promise<void>;
  readonly trustQuestion?: () => Promise<IClientTrustQuestion | null>;
  readonly answerTrust?: (choice: TClientTrustChoice) => Promise<{ error?: string }>;
  readonly pickFiles?: () => Promise<readonly IPickedFile[]>;
  readonly getPathForFile?: (file: File) => string;
  onOpenSettings(listener: () => void): () => void;
  readonly openMemoryInEditor?: (path: string) => void;
}

export interface IClientRuntimeEnvironment {
  readonly bridge?: IClientRuntimeBridge;
  readonly document: Pick<Document, 'querySelector'>;
  readonly location: Pick<Location, 'search' | 'host' | 'protocol'>;
}

/** Resolve host capabilities without importing Electron or a Node CLI into the browser graph. */
export function resolveClientRuntimeHost(environment: IClientRuntimeEnvironment): IClientRuntimeHost {
  const { bridge } = environment;
  if (bridge) {
    const local = bridge.runtimeMode !== 'remote';
    return {
      kind: 'desktop',
      getEndpoint: () => bridge.getEndpoint(),
      signalReady: () => bridge.signalReady(),
      onState: (listener) => bridge.onState(listener),
      restartRuntime: () => bridge.restartRuntime(),
      trustQuestion: local ? () => bridge.trustQuestion() : undefined,
      answerTrust: local ? (choice) => bridge.answerTrust(choice) : undefined,
      pickFiles: local && bridge.pickFiles ? () => bridge.pickFiles!() : undefined,
      getPathForFile: local && bridge.getPathForFile ? (file) => bridge.getPathForFile!(file) : undefined,
      onOpenSettings: (listener) => bridge.onOpenSettings?.(listener) ?? (() => {}),
      openMemoryInEditor: local && bridge.openPath ? (path) => { void bridge.openPath!(path); } : undefined,
    };
  }

  const injected = environment.document.querySelector('meta[name="ws-url"]')?.getAttribute('content')?.trim();
  const query = new URLSearchParams(environment.location.search).get('ws')?.trim();
  const protocol = environment.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const endpoint = injected || query || `${protocol}//${environment.location.host}`;
  return {
    kind: 'browser',
    getEndpoint: async () => endpoint,
    signalReady: () => {},
    onState: () => () => {},
    onOpenSettings: () => () => {},
  };
}
