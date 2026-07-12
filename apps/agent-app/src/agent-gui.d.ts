import type { TSidecarState } from '../electron/sidecar.js';

/** The preload `contextBridge` surface (see electron/preload.ts). */
export interface IAgentGuiBridge {
  getEndpoint(): Promise<string | null>;
  signalReady(): void;
  onState(cb: (state: TSidecarState) => void): () => void;
}

declare global {
  interface Window {
    readonly agentGui: IAgentGuiBridge;
  }
}
