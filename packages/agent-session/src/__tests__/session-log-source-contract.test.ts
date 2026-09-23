import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import * as externalPayloadReferenceValidation from '../external-payload-file-reader.js';
import { loadSessionLogEntries } from '../session-log-replay.js';

import type { IExternalPayloadSource, ISessionLogSource } from '../session-log-sources.js';

describe('session log source contract', () => {
  it('keeps the reference validator module free of pathname-opening authority', () => {
    expect(Object.keys(externalPayloadReferenceValidation).sort()).toEqual([
      'isValidSessionLogExternalPayloadReference',
      'validateExternalPayloadReference',
    ]);
  });

  it('loads and hydrates through explicit neutral sources', () => {
    const response = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'from source',
      state: 'complete',
      timestamp: '2026-08-22T00:00:00.000Z',
    };
    const bytes = Buffer.from(JSON.stringify(response));
    const readBudgets: number[] = [];
    const externalPayloadSource: IExternalPayloadSource = {
      readBytes: (relativePath, maxBytes) => {
        readBudgets.push(maxBytes);
        return relativePath === 'payloads/answer.json' && bytes.byteLength <= maxBytes
          ? bytes
          : undefined;
      },
    };
    const source: ISessionLogSource = {
      readText: () =>
        JSON.stringify({
          schemaVersion: 1,
          timestamp: '2026-08-22T00:00:00.000Z',
          sessionId: 'source-contract',
          event: 'provider_response_normalized',
          executionId: 'exec-1',
          round: 1,
          response: {
            kind: 'external-payload',
            encoding: 'json',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            byteLength: bytes.byteLength,
            relativePath: 'payloads/answer.json',
          },
        }),
      externalPayloadSource,
    };

    const entries = loadSessionLogEntries(source, { maxTotalBytes: bytes.byteLength });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.response).toMatchObject({ role: 'assistant', content: 'from source' });
    expect(readBudgets).toEqual([bytes.byteLength]);
  });

  it('does not accept a bare file path as project authority', () => {
    const invokeWithBarePath = (): void => {
      // @ts-expect-error ARCH-042: callers must inject an explicit session-log source.
      loadSessionLogEntries('ambient-session.jsonl');
    };

    expect(invokeWithBarePath).toBeTypeOf('function');
  });
});
