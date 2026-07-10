import { describe, expect, it } from 'vitest';

import { createDefaultRemoteCommandPolicy } from '../remote-command-policy.js';

describe('createDefaultRemoteCommandPolicy (REMOTE-003 B1)', () => {
  it('allows read-only commands and denies non-read-only commands with an empty allowlist', () => {
    const policy = createDefaultRemoteCommandPolicy();
    expect(policy.isAllowed('status', true)).toBe(true); // read-only → allowed
    expect(policy.isAllowed('shell', false)).toBe(false); // non-read-only → denied (deny-by-default)
  });

  it('widens: an allowlisted non-read-only command is permitted', () => {
    const policy = createDefaultRemoteCommandPolicy(['deploy']);
    expect(policy.isAllowed('deploy', false)).toBe(true);
    expect(policy.isAllowed('shell', false)).toBe(false); // still denied — not on the allowlist
  });

  it('normalizes leading slashes in both the allowlist and the queried name', () => {
    const policy = createDefaultRemoteCommandPolicy(['/deploy']);
    expect(policy.isAllowed('/deploy', false)).toBe(true);
    expect(policy.isAllowed('deploy', false)).toBe(true);
  });
});
