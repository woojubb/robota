/**
 * CLI-083 (issue #2287) — the default command modules forward the org policy.
 *
 * `createDefaultCommandModules` used to accept `orgPolicy` and hand it to the provider command
 * module; `92596bc6f` removed the parameter along with its only caller. The consumer never changed:
 * `provider-command-profile-operations.ts` still destructures `orgPolicy` and enforces
 * `allowedProviders` on it.
 *
 * `org-policy.test.ts` already covers that enforcement — by constructing the provider module
 * DIRECTLY with a policy. That test is green whether or not anything upstream forwards one, which
 * is why the cut survived three months. This drives the same enforcement through the factory that
 * lost the parameter, so it fails exactly when the forwarding is missing.
 *
 * There is deliberately no "the factory accepts an orgPolicy" case. At runtime JavaScript accepts an
 * undeclared extra property silently, so that assertion passes whether or not the parameter exists —
 * it was written, it passed against the broken tree, and it proved nothing. The signature is the
 * type checker's job.
 */

import { describe, expect, it } from 'vitest';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createDefaultCommandModules } from '../default-command-modules.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IOrgPolicy,
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';

const providerDefinitions: readonly IProviderDefinition[] = ['anthropic', 'openai'].map((type) => ({
  type,
  displayName: type,
  defaults: { model: 'm', apiKey: `$ENV:${type.toUpperCase()}_API_KEY` },
  setupSteps: [],
  requiresApiKey: true,
  createProvider: () => {
    throw new Error('not used');
  },
}));

const SETTINGS: TProviderSettingsDocument = {
  currentProvider: 'anthropic',
  providers: {
    anthropic: { type: 'anthropic', model: 'm' },
    openai: { type: 'openai', model: 'm' },
  },
};

const adapter: IProviderCommandSettingsAdapter = {
  readMergedSettings: () => SETTINGS,
  readTargetSettings: () => ({}),
  writeTargetSettings: () => undefined,
};

const POLICY: IOrgPolicy = { allowedProviders: ['anthropic'], adminContact: 'ops@example.com' };

/** Build the provider executor the way the PRODUCT does — through the default-modules factory. */
function executorThroughFactory(orgPolicy?: IOrgPolicy): SystemCommandExecutor {
  const { modules } = createDefaultCommandModules({
    cwd: '/work',
    providerDefinitions,
    providerSettingsAdapter: adapter,
    ...(orgPolicy === undefined ? {} : { orgPolicy }),
  });
  const provider = modules.find((module) => module.name === 'agent-command-provider');
  if (provider === undefined) throw new Error('the provider command module was not built');
  return new SystemCommandExecutor([...(provider.systemCommands ?? [])]);
}

describe('CLI-083: the default command modules forward the org policy', () => {
  it('blocks a disallowed provider switch when a policy is supplied to the FACTORY', async () => {
    const result = await executorThroughFactory(POLICY).execute(
      'provider',
      createTestCommandHost(),
      'switch openai',
    );

    expect(result?.success).toBe(false);
    expect(result?.message).toContain('"openai" is not allowed');
    expect(result?.message).toContain('ops@example.com');
  });

  it('does not block when no policy is supplied — absence stays distinguishable', async () => {
    // The control. A factory that attached a policy of its own would satisfy the case above and
    // change behaviour for every user who has no org policy at all.
    const result = await executorThroughFactory().execute(
      'provider',
      createTestCommandHost(),
      'switch openai',
    );

    expect(result?.message ?? '').not.toContain('is not allowed');
  });
});
