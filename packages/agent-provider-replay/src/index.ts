/**
 * @robota-sdk/agent-provider-replay — deterministic provider that replays a recorded session log.
 *
 * INFRA-017 / TEST-008 (provider axis). Run a real conversation offline with no network/model key by
 * replaying the `provider_response_normalized` responses captured in a session log.
 */
import { loadSessionLogEntries } from '@robota-sdk/agent-session';

import { ReplayProvider } from './replay-provider.js';

import type { IReplayProviderOptions } from './replay-provider.js';
import type { ISessionLogLine } from '@robota-sdk/agent-session';

export { ReplayProvider } from './replay-provider.js';
export type { IReplayProviderOptions } from './replay-provider.js';

export type TReplayProviderFromLogFileOptions = Omit<
  IReplayProviderOptions,
  'entries' | 'externalPayloadBaseDirectory'
>;

/** Convenience: build a {@link ReplayProvider} from a session-log JSONL file. */
export function createReplayProviderFromLogFile(
  logFile: string,
  options: TReplayProviderFromLogFileOptions = {},
): ReplayProvider {
  const { maxExternalPayloadDepth, maxExternalPayloadTotalBytes, ...providerOptions } = options;
  const entries = loadSessionLogEntries(logFile, {
    maxDepth: maxExternalPayloadDepth,
    maxTotalBytes: maxExternalPayloadTotalBytes,
  }) as unknown as ISessionLogLine[];
  return new ReplayProvider({ entries, ...providerOptions });
}
