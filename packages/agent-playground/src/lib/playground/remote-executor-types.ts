/**
 * Leaf type module for {@link IRemoteExecutor}.
 *
 * Split out of `remote-injection.ts` so `remote-injection-sandbox.ts` can depend on this type
 * without importing back from `remote-injection.ts` (which re-exports `createPlaygroundSandbox`
 * from `remote-injection-sandbox.ts`) — that previously created an import cycle between the two.
 */
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IPlaygroundConfig } from './config-validation';

export interface IRemoteExecutor {
  readonly name: string;
  readonly version: string;
  executeChat(request: Record<string, TUniversalValue>): Promise<TUniversalValue>;
  executeChatStream?(request: Record<string, TUniversalValue>): AsyncIterable<TUniversalValue>;
  supportsTools(): boolean;
  validateConfig(): boolean;
  dispose?(): Promise<void>;
}

declare global {
  interface Window {
    __ROBOTA_PLAYGROUND_EXECUTOR__?: IRemoteExecutor;
    __ROBOTA_PLAYGROUND_CONFIG__?: IPlaygroundConfig;
  }
}
