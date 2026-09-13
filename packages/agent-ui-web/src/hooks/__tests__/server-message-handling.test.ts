import { describe, expect, it } from 'vitest';

import { SERVER_MESSAGE_HANDLING } from '../server-message-handling.js';

describe('ARCH-2164 server-message handling contract', () => {
  it('keeps every declared disposition explicit and non-empty', () => {
    expect(Object.keys(SERVER_MESSAGE_HANDLING).length).toBeGreaterThan(30);
    expect(Object.values(SERVER_MESSAGE_HANDLING)).not.toContain(undefined);
    expect(SERVER_MESSAGE_HANDLING.error).toBe('visible-notice');
    expect(SERVER_MESSAGE_HANDLING.command_result).toBe('visible-notice');
    expect(SERVER_MESSAGE_HANDLING.usage_report).toBe('reducer-state');
  });
});
