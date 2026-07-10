import { describe, expect, it } from 'vitest';

import {
  createDefaultRemoteCommandPolicy,
  type IRemoteCommandPolicy,
} from '../remote-command-policy.js';

describe('createDefaultRemoteCommandPolicy (REMOTE-006 — allow-by-default, local == remote)', () => {
  it('allows a non-read-only command from a remote origin by default (was denied under REMOTE-003)', () => {
    const policy = createDefaultRemoteCommandPolicy();
    expect(policy.isAllowed('shell', false)).toBe(true); // non-read-only → allowed (local == remote)
    expect(policy.isAllowed('status', true)).toBe(true); // read-only → allowed
  });

  it('the IRemoteCommandPolicy interface is the optional restriction seam — a custom policy can restrict', () => {
    // A consumer that opts into a read-only-only restriction implements the interface itself.
    const restrictive: IRemoteCommandPolicy = { isAllowed: (_name, readOnly) => readOnly };
    expect(restrictive.isAllowed('shell', false)).toBe(false);
    expect(restrictive.isAllowed('status', true)).toBe(true);
  });
});
