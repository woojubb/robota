import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { ISessionLogEntry } from './session-log-replay.js';

export interface ISessionReplayValidationIssue {
  code:
    | 'PROVIDER_RESPONSE_RAW_MISSING'
    | 'PROVIDER_RESPONSE_NORMALIZED_MISSING'
    | 'TOOL_RESULT_MISSING'
    | 'PAYLOAD_REFERENCE_INVALID';
  message: string;
  eventIndex?: number;
  executionId?: string;
  round?: number;
  toolCallId?: string;
}

export interface ISessionReplayValidationResult {
  ok: boolean;
  issues: ISessionReplayValidationIssue[];
}

export function validateSessionReplayLogEntries(
  entries: readonly ISessionLogEntry[],
): ISessionReplayValidationResult {
  const issues: ISessionReplayValidationIssue[] = [];
  const providerEvents = createProviderReplayEventIndex();
  const toolEvents = createToolReplayEventIndex();

  entries.forEach((entry, index) => {
    collectPayloadReferenceIssues(entry, index, issues);
    collectProviderReplayEvent(providerEvents, entry, index);
    collectToolReplayEvent(toolEvents, entry, index);
  });

  appendProviderReplayIssues(providerEvents, issues);
  appendToolReplayIssues(toolEvents, issues);

  return { ok: issues.length === 0, issues };
}

interface IProviderReplayRequest {
  executionId: string;
  round: number;
  index: number;
}

interface IProviderReplayEventIndex {
  requests: Map<string, IProviderReplayRequest>;
  rawResponses: Set<string>;
  normalizedResponses: Set<string>;
}

interface IToolReplayRequest {
  executionId: string;
  toolCallId: string;
  index: number;
}

interface IToolReplayEventIndex {
  requests: Map<string, IToolReplayRequest>;
  results: Set<string>;
}

function createProviderReplayEventIndex(): IProviderReplayEventIndex {
  return {
    requests: new Map<string, IProviderReplayRequest>(),
    rawResponses: new Set<string>(),
    normalizedResponses: new Set<string>(),
  };
}

function createToolReplayEventIndex(): IToolReplayEventIndex {
  return {
    requests: new Map<string, IToolReplayRequest>(),
    results: new Set<string>(),
  };
}

function collectProviderReplayEvent(
  events: IProviderReplayEventIndex,
  entry: ISessionLogEntry,
  index: number,
): void {
  const key = providerKey(entry);
  if (!key) return;
  if (entry.event === 'provider_request') {
    events.requests.set(key.key, {
      executionId: key.executionId,
      round: key.round,
      index,
    });
  }
  if (entry.event === 'provider_response_raw') {
    events.rawResponses.add(key.key);
  }
  if (entry.event === 'provider_response_normalized') {
    events.normalizedResponses.add(key.key);
  }
}

function collectToolReplayEvent(
  events: IToolReplayEventIndex,
  entry: ISessionLogEntry,
  index: number,
): void {
  const key = toolKey(entry);
  if (!key) return;
  if (entry.event === 'tool_execution_request') {
    events.requests.set(key.key, {
      executionId: key.executionId,
      toolCallId: key.toolCallId,
      index,
    });
  }
  if (entry.event === 'tool_execution_result') {
    events.results.add(key.key);
  }
}

function appendProviderReplayIssues(
  events: IProviderReplayEventIndex,
  issues: ISessionReplayValidationIssue[],
): void {
  for (const [key, request] of events.requests) {
    if (!events.rawResponses.has(key)) {
      issues.push({
        code: 'PROVIDER_RESPONSE_RAW_MISSING',
        message: `Provider request ${key} has no raw response event.`,
        eventIndex: request.index,
        executionId: request.executionId,
        round: request.round,
      });
    }
    if (!events.normalizedResponses.has(key)) {
      issues.push({
        code: 'PROVIDER_RESPONSE_NORMALIZED_MISSING',
        message: `Provider request ${key} has no normalized response event.`,
        eventIndex: request.index,
        executionId: request.executionId,
        round: request.round,
      });
    }
  }
}

function appendToolReplayIssues(
  events: IToolReplayEventIndex,
  issues: ISessionReplayValidationIssue[],
): void {
  for (const [key, request] of events.requests) {
    if (!events.results.has(key)) {
      issues.push({
        code: 'TOOL_RESULT_MISSING',
        message: `Tool request ${key} has no terminal result event.`,
        eventIndex: request.index,
        executionId: request.executionId,
        toolCallId: request.toolCallId,
      });
    }
  }
}

function providerKey(
  entry: ISessionLogEntry,
): { key: string; executionId: string; round: number } | undefined {
  if (typeof entry.executionId !== 'string') return undefined;
  const round = typeof entry.round === 'number' ? entry.round : Number(entry.round);
  if (!Number.isFinite(round)) return undefined;
  return { key: `${entry.executionId}:${round}`, executionId: entry.executionId, round };
}

function toolKey(
  entry: ISessionLogEntry,
): { key: string; executionId: string; toolCallId: string } | undefined {
  if (typeof entry.executionId !== 'string') return undefined;
  const toolCallId =
    typeof entry.toolCallId === 'string'
      ? entry.toolCallId
      : typeof entry.toolExecutionId === 'string'
        ? entry.toolExecutionId
        : undefined;
  if (!toolCallId) return undefined;
  return { key: `${entry.executionId}:${toolCallId}`, executionId: entry.executionId, toolCallId };
}

function collectPayloadReferenceIssues(
  value: TUniversalValue,
  eventIndex: number,
  issues: ISessionReplayValidationIssue[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectPayloadReferenceIssues(item, eventIndex, issues));
    return;
  }
  if (!isRecord(value)) return;
  if (value.kind === 'external-payload') {
    if (
      value.encoding !== 'json' ||
      typeof value.sha256 !== 'string' ||
      typeof value.relativePath !== 'string' ||
      typeof value.byteLength !== 'number'
    ) {
      issues.push({
        code: 'PAYLOAD_REFERENCE_INVALID',
        message: 'External payload reference is missing required replay fields.',
        eventIndex,
      });
    }
    return;
  }
  Object.values(value).forEach((child) => collectPayloadReferenceIssues(child, eventIndex, issues));
}

function isRecord(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
