/**
 * Leaf type module for {@link ISessionLogEntry}.
 *
 * Split out of `session-log-replay.ts` so `session-log-codec/index.ts` and
 * `session-log-validation.ts` can depend on this type without importing back from
 * `session-log-replay.ts`, which previously created import cycles among the three files.
 */
import type { TUniversalValue } from '@robota-sdk/agent-core';

export interface ISessionLogEntry extends Record<string, TUniversalValue> {
  schemaVersion?: number;
  timestamp: string;
  sessionId: string;
  event: string;
}
