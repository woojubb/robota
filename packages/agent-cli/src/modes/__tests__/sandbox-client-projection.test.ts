/**
 * Issue #3242: a served session consults the same sandbox the shell tools run under, so a confined
 * command the sandbox approves runs without a prompt.
 */

import { describe, expect, it } from 'vitest';

import { buildServeSessionOptions } from '../serve-mode.js';

import type { ISandboxClient } from '@robota-sdk/agent-tools';

const sandboxClient = { filesystem: 'shared', autoApproves: () => true } as unknown as ISandboxClient;

function makeArgs(): never {
  return {
    permissionMode: undefined,
    maxTurns: undefined,
    noSessionPersistence: true,
    forkSession: undefined,
    sessionName: undefined,
  } as never;
}

describe('the serve projection carries the sandbox client', () => {
  it('forwards a supplied sandbox into the session options', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: makeArgs(),
      preset: {},
      sandboxClient,
    } as never) as { sandboxClient?: unknown };

    expect(options.sandboxClient).toBe(sandboxClient);
  });

  it('carries none when none was supplied', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: makeArgs(),
      preset: {},
    } as never) as { sandboxClient?: unknown };

    expect(options.sandboxClient).toBeUndefined();
  });
});
