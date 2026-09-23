import { describe, expect, it } from 'vitest';

import { FileSessionLogger } from '../session-logger.js';

describe('session logger envelope ownership', () => {
  it('writes the supported version and prevents payload data from replacing the envelope', () => {
    const lines: string[] = [];
    const logger = new FileSessionLogger({ append: (_sessionId, text) => lines.push(text) });

    logger.log('envelope-session', 'session_shutdown', {
      reason: 'other',
      schemaVersion: 999,
      sessionId: 'payload-session',
      event: 'unknown_payload_event',
      timestamp: 'not-a-date',
    });

    expect(lines).toHaveLength(1);
    const entry: unknown = JSON.parse(lines[0] ?? '');
    expect(entry).toEqual({
      schemaVersion: 1,
      sessionId: 'envelope-session',
      event: 'session_shutdown',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      reason: 'other',
    });
  });
});
