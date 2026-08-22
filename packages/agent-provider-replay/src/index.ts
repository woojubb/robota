/**
 * @robota-sdk/agent-provider-replay — deterministic provider that replays a recorded session log.
 *
 * INFRA-017 / TEST-008 (provider axis). Run a real conversation offline with no network/model key by
 * replaying the `provider_response_normalized` responses captured in a session log.
 */
import { loadSessionLogEntries, NodeSessionLogSource } from '@robota-sdk/agent-session';

import { ReplayProvider } from './replay-provider.js';

import type { IReplayProviderOptions } from './replay-provider.js';
import type { ISessionLogSource } from '@robota-sdk/agent-session';

export { ReplayProvider } from './replay-provider.js';
export type { IReplayProviderOptions } from './replay-provider.js';

export type TReplayProviderFromSourceOptions = Omit<
  IReplayProviderOptions,
  'entries' | 'externalPayloadSource'
>;

/** Build a {@link ReplayProvider} from an explicit session-log source. */
export function createReplayProviderFromSource(
  source: ISessionLogSource,
  options: TReplayProviderFromSourceOptions = {},
): ReplayProvider {
  const { maxExternalPayloadDepth, maxExternalPayloadTotalBytes, ...providerOptions } = options;
  const entries = loadSessionLogEntries(source, {
    maxDepth: maxExternalPayloadDepth,
    maxTotalBytes: maxExternalPayloadTotalBytes,
  });
  return new ReplayProvider({
    entries,
    externalPayloadSource: source.externalPayloadSource,
    ...providerOptions,
  });
}

/** Explicit Node-host adapter; unlike the neutral parser this conspicuously enters ambient I/O. */
export function createReplayProviderFromNodeLogFile(
  logFile: string,
  options: TReplayProviderFromSourceOptions = {},
): ReplayProvider {
  return createReplayProviderFromSource(new NodeSessionLogSource(logFile), options);
}
