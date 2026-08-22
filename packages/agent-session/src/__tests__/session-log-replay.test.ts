import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSessionLogger } from '../session-logger.js';
import { NodeSessionLogSink } from '../session-log-sinks.js';
import { NodeSessionLogSource } from '../session-log-sources.js';
import {
  loadSessionLogEntries,
  replaySessionLogEntries,
  validateSessionReplayLogEntries,
  type ISessionLogEntry,
} from '../session-log-replay.js';

describe('session log replay support', () => {
  it('ARCH-042: rejects an empty Node session-log path before deriving sidecar authority', () => {
    expect(() => new NodeSessionLogSource('')).toThrow(/log-file path/i);
    expect(() => new NodeSessionLogSource('   ')).toThrow(/log-file path/i);
  });

  it('redacts sensitive fields and stores large payloads by content-addressed reference', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'robota-log-'));
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir), {
      externalPayloadThresholdBytes: 32,
    });

    logger.log('session_replay_test', 'tool_execution_result', {
      apiKey: 'secret-key',
      nested: { authorization: 'Bearer secret' },
      result: 'x'.repeat(128),
    });

    const logLine = readFileSync(join(logDir, 'session_replay_test.jsonl'), 'utf-8').trim();
    const entry = JSON.parse(logLine) as {
      apiKey: string;
      nested: { authorization: string };
      result: { kind: string; relativePath: string; sha256: string; byteLength: number };
    };

    expect(entry.apiKey).toBe('[REDACTED]');
    expect(entry.nested.authorization).toBe('[REDACTED]');
    expect(entry.result).toEqual(
      expect.objectContaining({
        kind: 'external-payload',
        relativePath: expect.stringContaining('session_replay_test.payloads/'),
        sha256: expect.any(String),
        byteLength: expect.any(Number),
      }),
    );

    const payloadFiles = readdirSync(join(logDir, 'session_replay_test.payloads'));
    expect(payloadFiles).toHaveLength(1);
    const payload = readFileSync(join(logDir, entry.result.relativePath), 'utf-8');
    expect(JSON.parse(payload)).toBe('x'.repeat(128));
  });

  it('ARCH-014: loadSessionLogEntries hydrates externalized values before replay', () => {
    const logDir = mkdtempSync(join(tmpdir(), 'robota-log-hydration-'));
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir), {
      externalPayloadThresholdBytes: 32,
    });

    logger.log('hydrated_session', 'history_mutation', {
      mutation: 'append_message',
      message: {
        id: 'a1',
        role: 'assistant',
        content: 'x'.repeat(128),
        state: 'complete',
        timestamp: '2026-08-15T00:00:00.000Z',
      },
    });

    const [entry] = loadSessionLogEntries(
      new NodeSessionLogSource(join(logDir, 'hydrated_session.jsonl')),
    );

    expect(entry?.message).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'x'.repeat(128) }),
    );
  });

  it('replays append-only history mutation events into messages and chat history', () => {
    const entries: ISessionLogEntry[] = [
      {
        timestamp: '2026-05-05T00:00:00.000Z',
        sessionId: 's1',
        event: 'history_mutation',
        mutation: 'append_message',
        message: {
          id: 'u1',
          role: 'user',
          content: 'hello',
          state: 'complete',
          timestamp: '2026-05-05T00:00:00.000Z',
        },
      },
      {
        timestamp: '2026-05-05T00:00:01.000Z',
        sessionId: 's1',
        event: 'history_mutation',
        mutation: 'append_message',
        message: {
          id: 'a1',
          role: 'assistant',
          content: 'hi',
          state: 'complete',
          timestamp: '2026-05-05T00:00:01.000Z',
        },
      },
    ];

    const replay = replaySessionLogEntries(entries);

    expect(replay.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(replay.history.map((entry) => entry.type)).toEqual(['user', 'assistant']);
  });

  it('validates provider/tool replay event completeness', () => {
    const entries: ISessionLogEntry[] = [
      {
        timestamp: '2026-05-05T00:00:00.000Z',
        sessionId: 's1',
        event: 'provider_request',
        executionId: 'exec-1',
        round: 1,
      },
      {
        timestamp: '2026-05-05T00:00:01.000Z',
        sessionId: 's1',
        event: 'tool_execution_request',
        executionId: 'exec-1',
        toolCallId: 'tool-1',
        toolName: 'Read',
      },
    ];

    const result = validateSessionReplayLogEntries(entries);

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PROVIDER_NATIVE_RAW_PAYLOAD_MISSING',
        'PROVIDER_RESPONSE_RAW_MISSING',
        'TOOL_RESULT_MISSING',
      ]),
    );
  });

  it('accepts provider-native raw response or stream payloads for replay validation', () => {
    const baseProviderRequest: ISessionLogEntry = {
      timestamp: '2026-05-05T00:00:00.000Z',
      sessionId: 's1',
      event: 'provider_request',
      executionId: 'exec-1',
      round: 1,
    };

    const result = validateSessionReplayLogEntries([
      baseProviderRequest,
      {
        timestamp: '2026-05-05T00:00:01.000Z',
        sessionId: 's1',
        event: 'provider_native_raw_payload',
        executionId: 'exec-1',
        round: 1,
        provider: 'openai',
        payloadKind: 'stream_event',
        sequence: 0,
        payload: { id: 'chunk-1' },
      },
      {
        timestamp: '2026-05-05T00:00:02.000Z',
        sessionId: 's1',
        event: 'provider_response_raw',
        executionId: 'exec-1',
        round: 1,
      },
      {
        timestamp: '2026-05-05T00:00:03.000Z',
        sessionId: 's1',
        event: 'provider_response_normalized',
        executionId: 'exec-1',
        round: 1,
      },
    ]);

    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('ARCH-014: rejects an unresolved normalized response as replay-incomplete', () => {
    const shared = {
      timestamp: '2026-08-15T00:00:00.000Z',
      sessionId: 's1',
      executionId: 'exec-1',
      round: 1,
    };
    const result = validateSessionReplayLogEntries([
      { ...shared, event: 'provider_request' },
      {
        ...shared,
        event: 'provider_native_raw_payload',
        payloadKind: 'response',
      },
      { ...shared, event: 'provider_response_raw' },
      {
        ...shared,
        event: 'provider_response_normalized',
        response: {
          kind: 'external-payload',
          encoding: 'json',
          sha256: 'a'.repeat(64),
          byteLength: 10,
          relativePath: 's1.payloads/payload.json',
        },
      },
    ]);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['UNRESOLVED_REPLAY_PAYLOAD', 'PROVIDER_RESPONSE_NORMALIZED_MISSING']),
    );
  });

  it('ARCH-014: validator applies the resolver reference-shape contract', () => {
    const result = validateSessionReplayLogEntries([
      {
        timestamp: '2026-08-15T00:00:00.000Z',
        sessionId: 's1',
        event: 'history_mutation',
        mutation: 'append_message',
        message: {
          kind: 'external-payload',
          encoding: 'json',
          sha256: 'too-short',
          byteLength: -1,
          relativePath: '',
          unexpected: true,
        },
      },
    ]);

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['PAYLOAD_REFERENCE_INVALID', 'UNRESOLVED_REPLAY_PAYLOAD']),
    );
  });
});
