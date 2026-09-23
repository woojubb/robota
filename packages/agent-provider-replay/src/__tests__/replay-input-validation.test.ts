import { describe, expect, it } from 'vitest';

import { ReplayProvider } from '../replay-provider.js';

describe('replay provider rejects malformed input before selecting responses', () => {
  it('does not silently omit a normalized response with an unknown message role', () => {
    const entry = {
      schemaVersion: 1,
      timestamp: '2026-09-23T00:00:00.000Z',
      sessionId: 'codec-replay',
      event: 'provider_response_normalized',
      executionId: 'execution-1',
      round: 0,
      toolCallsCount: 0,
      response: {
        id: 'message-1',
        role: 'bogus',
        state: 'complete',
        content: 'must not disappear',
        timestamp: '2026-09-23T00:00:00.000Z',
      },
    };

    expect(() => new ReplayProvider({ entries: [entry] })).toThrow(/INVALID_EVENT/);
  });
});
