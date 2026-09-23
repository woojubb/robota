import { messageToHistoryEntry } from '@robota-sdk/agent-core';

import { resolveSessionLogExternalPayloads } from './external-payload-resolver.js';
import { decodeSessionLogEntries, SessionLogDecodeError } from './session-log-codec/index.js';

import type { ISessionLogPayloadResolutionOptions } from './external-payload-resolver.js';
import type { IExternalPayloadSource, ISessionLogSource } from './session-log-sources.js';
import type { IHistoryEntry, TUniversalMessage } from '@robota-sdk/agent-core';
import type { ISessionLogEntry } from './session-log-entry-types.js';

export type { ISessionLogEntry } from './session-log-entry-types.js';

export interface ISessionReplayRecord {
  sessionId: string | undefined;
  cwd: string | undefined;
  createdAt: string | undefined;
  updatedAt: string | undefined;
  messages: TUniversalMessage[];
  history: IHistoryEntry[];
  backgroundTaskEvents: object[];
  backgroundJobGroupEvents: object[];
  memoryEvents: object[];
}

export type ISessionLogLoadOptions = Omit<ISessionLogPayloadResolutionOptions, 'source'> & {
  readonly externalPayloadSource?: IExternalPayloadSource;
};

export { validateSessionReplayLogEntries } from './session-log-validation.js';
export type {
  ISessionReplayValidationIssue,
  ISessionReplayValidationResult,
} from './session-log-validation.js';

export function loadSessionLogEntries(
  source: ISessionLogSource,
  options: ISessionLogLoadOptions = {},
): ISessionLogEntry[] {
  const text = source.readText();
  const parsedLines: { value: unknown; lineNumber: number }[] = [];
  if (text !== undefined) {
    text.split('\n').forEach((line, index) => {
      if (line.trim().length === 0) return;
      try {
        parsedLines.push({ value: JSON.parse(line) as unknown, lineNumber: index + 1 });
      } catch (cause) {
        throw new SessionLogDecodeError(
          'INVALID_JSON',
          [{ path: `line ${index + 1}`, message: 'expected valid JSON' }],
          { cause },
        );
      }
    });
  }
  const hydrated = resolveSessionLogExternalPayloads(
    parsedLines.map(({ value }) => value),
    {
      source: options.externalPayloadSource ?? source.externalPayloadSource,
      ...options,
    },
  );
  return decodeSessionLogEntries(hydrated, {
    lineNumbers: parsedLines.map(({ lineNumber }) => lineNumber),
  });
}

export function replaySessionLogEntries(
  entries: readonly ISessionLogEntry[],
): ISessionReplayRecord {
  const messages: TUniversalMessage[] = [];
  const history: IHistoryEntry[] = [];
  const auxiliaryEvents: IAuxiliaryReplayEvents = {
    backgroundTaskEvents: [],
    backgroundJobGroupEvents: [],
    memoryEvents: [],
  };
  let sessionId: string | undefined;
  let cwd: string | undefined;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;

  for (const entry of decodeSessionLogEntries(entries)) {
    sessionId = sessionId ?? entry.sessionId;
    createdAt = createdAt ?? entry.timestamp;
    updatedAt = entry.timestamp;

    if (entry.event === 'session_init') {
      cwd = typeof entry.cwd === 'string' ? entry.cwd : cwd;
    }

    if (entry.event === 'history_mutation' && entry.mutation === 'append_message') {
      messages.push(entry.message);
      history.push(messageToHistoryEntry(entry.message));
    }

    collectAuxiliaryReplayEvent(entry, auxiliaryEvents);
  }

  return {
    sessionId,
    cwd,
    createdAt,
    updatedAt,
    messages,
    history,
    backgroundTaskEvents: auxiliaryEvents.backgroundTaskEvents,
    backgroundJobGroupEvents: auxiliaryEvents.backgroundJobGroupEvents,
    memoryEvents: auxiliaryEvents.memoryEvents,
  };
}

interface IAuxiliaryReplayEvents {
  backgroundTaskEvents: object[];
  backgroundJobGroupEvents: object[];
  memoryEvents: object[];
}

function collectAuxiliaryReplayEvent(
  entry: ISessionLogEntry,
  auxiliaryEvents: IAuxiliaryReplayEvents,
): void {
  if (entry.event === 'background_task_event') {
    pushObjectPayload(auxiliaryEvents.backgroundTaskEvents, entry, 'backgroundEvent', 'data');
    return;
  }
  if (entry.event === 'background_job_group_event') {
    pushObjectPayload(
      auxiliaryEvents.backgroundJobGroupEvents,
      entry,
      'backgroundJobGroupEvent',
      'data',
    );
    return;
  }
  if (entry.event === 'memory_event') {
    pushObjectPayload(auxiliaryEvents.memoryEvents, entry, 'memoryEvent', 'data');
  }
}

function getObjectPayload(entry: ISessionLogEntry, key: string): object | undefined {
  const value = entry[key];
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value instanceof Date
  ) {
    return undefined;
  }
  return value;
}

function pushObjectPayload(
  target: object[],
  entry: ISessionLogEntry,
  primaryKey: string,
  fallbackKey: string,
): void {
  const payload = getObjectPayload(entry, primaryKey) ?? getObjectPayload(entry, fallbackKey);
  if (payload) target.push(payload);
}
