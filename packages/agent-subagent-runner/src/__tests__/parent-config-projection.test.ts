/**
 * ARCH-044 (issue #2047) — the wire payload carries what the child reads, not the parent's whole config.
 *
 * `ISubagentWorkerStartPayload.parentConfig` was `IInProcessSubagentRunnerDeps['config']` — the whole
 * `IResolvedConfig` — built two lines above `providerProfile: createProviderProfile(...)`, which
 * SEC-009 hardened to carry `apiKeyEnv` and leave the resolved secret behind. So the secret crossed
 * anyway, on the member nobody scoped.
 *
 * Measured at `7ee0ca6e4`, the child reads exactly four members:
 *   provider.model, permissions, defaultTrustLevel   (create-subagent-session.ts:190,214,226)
 *   hooks                                            (child-process-subagent-worker.ts:141)
 *
 * `provider.apiKey` is not among them and neither is `env`. A search for a spread, an
 * `Object.keys`, or a whole-object pass finds none, so those four are the value's readers rather
 * than merely its named ones. **The credential is structurally cloned into a second process and read
 * by nothing** — there is no benefit to weigh the exposure against.
 *
 * These test the PROJECTION's behaviour, not its type. Structural typing would accept
 * `return config` where the narrow type is expected — an object with excess properties is assignable
 * — so the type alone cannot keep the secret off the wire, and a test that only typechecked would
 * pass while the secret shipped.
 */

import { describe, expect, it } from 'vitest';

import { projectParentConfig } from '../parent-config-projection.js';

import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

function parentConfig(): IInProcessSubagentRunnerDeps['config'] {
  return {
    defaultTrustLevel: 'moderate',
    language: 'ko',
    currentProvider: 'openai',
    provider: {
      name: 'openai',
      model: 'test-model',
      apiKey: 'sk-the-resolved-secret',
      apiKeyEnv: 'OPENAI_API_KEY',
      baseURL: 'http://localhost:1234/v1',
    },
    permissions: { allow: ['Read'], deny: ['Bash(rm -rf /)'] },
    env: { SOME_TOKEN: 'another-secret' },
  } as unknown as IInProcessSubagentRunnerDeps['config'];
}

describe('ARCH-044: the projected parent config', () => {
  it('does not carry the resolved credential', () => {
    const projected = projectParentConfig(parentConfig()) as { provider?: { apiKey?: unknown } };

    expect(projected.provider?.apiKey).toBeUndefined();
  });

  it('does not carry the env map — a second unread carrier of secrets', () => {
    // One projection removes two classes rather than one field, which is the argument for
    // projecting rather than deleting `provider.apiKey` in place.
    expect((projectParentConfig(parentConfig()) as { env?: unknown }).env).toBeUndefined();
  });

  it('carries the four members the child actually reads', () => {
    // The control. A projection that returned `{}` would satisfy both cases above and break every
    // child; these are the fields measured as read.
    const projected = projectParentConfig(parentConfig());

    expect(projected.provider.model).toBe('test-model');
    expect(projected.permissions).toEqual({ allow: ['Read'], deny: ['Bash(rm -rf /)'] });
    expect(projected.defaultTrustLevel).toBe('moderate');
  });

  it('drops the members nothing reads, rather than passing the object through', () => {
    // The assertion that a `return config` implementation fails. Without it the two cases above are
    // satisfied by deleting two fields and leaving the rest of the parent's config on the wire.
    expect(Object.keys(projectParentConfig(parentConfig())).sort()).toEqual([
      'defaultTrustLevel',
      'permissions',
      'provider',
    ]);
  });
});
