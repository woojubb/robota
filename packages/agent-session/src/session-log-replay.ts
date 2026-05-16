import { existsSync, readFileSync } from 'node:fs';
import { messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { IHistoryEntry, TUniversalMessage, TUniversalValue } from '@robota-sdk/agent-core';

export interface ISessionLogEntry extends Record<string, TUniversalValue> {
  timestamp: string;
  sessionId: string;
  event: string;
}

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

export { validateSessionReplayLogEntries } from './session-log-validation.js';
export type {
  ISessionReplayValidationIssue,
  ISessionReplayValidationResult,
} from './session-log-validation.js';

export function loadSessionLogEntries(logFile: string): ISessionLogEntry[] {
  if (!existsSync(logFile)) {
    return [];
  }
  return readFileSync(logFile, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as ISessionLogEntry);
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

  for (const entry of entries) {
    sessionId = sessionId ?? entry.sessionId;
    createdAt = createdAt ?? entry.timestamp;
    updatedAt = entry.timestamp;

    if (entry.event === 'session_init') {
      cwd = typeof entry.cwd === 'string' ? entry.cwd : cwd;
    }

    if (entry.event === 'history_mutation' && entry.mutation === 'append_message') {
      const message = normalizeLogMessage(entry.message);
      if (message) {
        messages.push(message);
        history.push(messageToHistoryEntry(message));
      }
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

function normalizeLogMessage(value: TUniversalValue): TUniversalMessage | undefined {
  if (!isRecord(value)) return undefined;
  const role = value.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') {
    return undefined;
  }
  const id = typeof value.id === 'string' ? value.id : `${role}-${Date.now()}`;
  const timestamp =
    value.timestamp instanceof Date
      ? value.timestamp
      : new Date(typeof value.timestamp === 'string' ? value.timestamp : Date.now());
  return {
    ...value,
    id,
    role,
    timestamp,
  } as TUniversalMessage;
}

function isRecord(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
