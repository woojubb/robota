/**
 * @robota-sdk/agent-provider-replay — deterministic provider that replays a recorded session log.
 *
 * Run a real conversation offline with no network/model key by
 * replaying the `provider_response_normalized` responses captured in a session log.
 */
import { isArtifactLockedError } from '@robota-sdk/agent-core';
import { loadSessionLogEntries } from '@robota-sdk/agent-session';
import { NodeSessionLogSource } from '@robota-sdk/agent-session/node';

import { ReplayProvider } from './replay-provider.js';

import type { IReplayProviderOptions } from './replay-provider.js';
import type { ISessionLogSource } from '@robota-sdk/agent-session';

export { ReplayProvider } from './replay-provider.js';
export type { IReplayProviderOptions } from './replay-provider.js';

export type TReplayProviderFromSourceOptions = Omit<
  IReplayProviderOptions,
  'entries' | 'externalPayloadSource'
>;

/** Fixed text, so a refused log carries nothing of what it holds. */
const SEALED_LOG_REFUSAL =
  'The session log is sealed, and the replay provider replays plain logs only.';

/**
 * Build a {@link ReplayProvider} from an explicit session-log source. A log the source cannot open
 * because it is sealed is refused with fixed text: the replay harness holds no keys.
 */
export function createReplayProviderFromSource(
  source: ISessionLogSource,
  options: TReplayProviderFromSourceOptions = {},
): ReplayProvider {
  const { maxExternalPayloadDepth, maxExternalPayloadTotalBytes, ...providerOptions } = options;
  let entries: ReturnType<typeof loadSessionLogEntries>;
  try {
    entries = loadSessionLogEntries(source, {
      maxDepth: maxExternalPayloadDepth,
      maxTotalBytes: maxExternalPayloadTotalBytes,
    });
  } catch (error) {
    if (isArtifactLockedError(error)) throw new Error(SEALED_LOG_REFUSAL);
    throw error;
  }
  return new ReplayProvider({
    entries,
    externalPayloadSource: source.externalPayloadSource,
    ...providerOptions,
  });
}

/**
 * Explicit Node-host adapter; unlike the neutral parser this conspicuously enters ambient I/O. The
 * replay harness holds no keys, so it reads the log `'plain'`: a sealed log is refused with fixed
 * text rather than opened.
 */
export function createReplayProviderFromNodeLogFile(
  logFile: string,
  options: TReplayProviderFromSourceOptions = {},
): ReplayProvider {
  return createReplayProviderFromSource(
    new NodeSessionLogSource(logFile, { sealing: 'plain' }),
    options,
  );
}
