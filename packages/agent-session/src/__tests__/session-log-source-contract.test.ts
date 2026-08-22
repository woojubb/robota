import { describe, expect, it } from 'vitest';

import { loadSessionLogEntries } from '../session-log-replay.js';

import type { IExternalPayloadSource, ISessionLogSource } from '../session-log-sources.js';

describe('session log source contract', () => {
  it('loads and hydrates through explicit neutral sources', () => {
    const externalPayloadSource: IExternalPayloadSource = {
      readBytes: (relativePath) =>
        relativePath === 'payloads/answer.json'
          ? Buffer.from(JSON.stringify({ role: 'assistant', content: 'from source' }))
          : undefined,
    };
    const source: ISessionLogSource = {
      readText: () =>
        JSON.stringify({
          timestamp: '2026-08-22T00:00:00.000Z',
          sessionId: 'source-contract',
          event: 'provider_response_normalized',
          response: {
            kind: 'external-payload',
            encoding: 'json',
            sha256: 'ebff62f10232104a22efc341778c7526eaa5f3e708b0f6e8b48e02bf00e897e4',
            byteLength: 44,
            relativePath: 'payloads/answer.json',
          },
        }),
      externalPayloadSource,
    };

    expect(loadSessionLogEntries(source)).toHaveLength(1);
  });

  it('does not accept a bare file path as project authority', () => {
    const invokeWithBarePath = (): void => {
      // @ts-expect-error ARCH-042: callers must inject an explicit session-log source.
      loadSessionLogEntries('/tmp/ambient-session.jsonl');
    };

    expect(invokeWithBarePath).toBeTypeOf('function');
  });
});
