/**
 * CLI-083 (issue #2287) — the org policy reaches the session through EVERY projection.
 *
 * `loadOrgPolicy()` had one caller and a refactor removed it (`92596bc6f`, two days after
 * `48ebec353` added it), so four implemented enforcement sites have been unreachable since
 * 2026-05-25. The type system never objected: the field is optional, and an optional parameter
 * deleted from a producer is invisible to a consumer that reads absence as "no policy configured".
 *
 * These sit at the PROJECTIONS rather than over a shared helper, and the reason is written above
 * `buildServeSessionOptions` in the file this tests:
 *
 *   > a field can be declared on the projection, forwarded by two shells and dropped by the third,
 *   > and nothing would have said so. A test of the helper is green in that state; a test of this
 *   > is not.
 *
 * That was recorded for a different field and `orgPolicy` was never added to it. One test covering
 * both projections would leave a half-wiring green, which reads as "the policy is loaded now".
 */

import { describe, expect, it } from 'vitest';

import { buildServeSessionOptions } from '../serve-mode.js';

import type { IOrgPolicy } from '@robota-sdk/agent-framework';

const POLICY: IOrgPolicy = {
  blockedCommands: ['clear'],
  allowedProviders: ['anthropic'],
  adminContact: 'ops@example.com',
};

function makeArgs(): never {
  return {
    permissionMode: undefined,
    maxTurns: undefined,
    noSessionPersistence: true,
    forkSession: undefined,
    sessionName: undefined,
  } as never;
}

describe('CLI-083: the serve projection carries the org policy', () => {
  it('forwards a supplied policy into the session options', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: makeArgs(),
      preset: {},
      orgPolicy: POLICY,
    } as never) as { orgPolicy?: IOrgPolicy };

    expect(options.orgPolicy).toEqual(POLICY);
  });

  it('carries no policy when none was supplied, rather than inventing one', () => {
    // The absence case has to stay distinguishable: a projection that always attaches a policy
    // object would satisfy the case above and change behaviour for every user without one.
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: makeArgs(),
      preset: {},
    } as never) as { orgPolicy?: IOrgPolicy };

    expect(options.orgPolicy).toBeUndefined();
  });
});
