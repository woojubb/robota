/**
 * CLI-083 (issue #2287) — the default command modules forward the org policy.
 *
 * `createDefaultCommandModules` used to accept `orgPolicy` and hand it to the provider command
 * module; `92596bc6f` removed the parameter along with its one caller. The consumer never changed:
 * `provider-command-profile-operations.ts` still reads `const { orgPolicy } = options` and enforces
 * `allowedProviders` and `requireApiKeyFromEnv` on it.
 *
 * So this asserts the SEGMENT that was cut. The enforcement itself is covered elsewhere by a test
 * that hands a policy object straight to the operation — which is why the cut was invisible for
 * three months: that test is green whether or not anything upstream supplies a policy.
 */

import { describe, expect, it } from 'vitest';

import { createDefaultCommandModules } from '../default-command-modules.js';

import type { IOrgPolicy } from '@robota-sdk/agent-framework';

const POLICY: IOrgPolicy = { allowedProviders: ['anthropic'], adminContact: 'ops@example.com' };

function options(extra: Record<string, unknown> = {}): never {
  return {
    cwd: '/work',
    providerDefinitions: [],
    providerSettingsAdapter: {
      read: () => ({}),
      write: () => undefined,
    },
    ...extra,
  } as never;
}

describe('CLI-083: the default command modules forward the org policy', () => {
  // There is deliberately no "the factory accepts an orgPolicy" case. At runtime JavaScript accepts
  // an undeclared extra property silently, so such an assertion passes whether or not the parameter
  // exists — it was written, it passed against the broken tree, and it proved nothing. The signature
  // is the type checker's job; `pnpm typecheck` is what fails if the field is not declared.

  it('reaches the provider module, so allowedProviders is enforceable', () => {
    const withPolicy = createDefaultCommandModules(options({ orgPolicy: POLICY }));
    const providerModule = withPolicy.modules.find(
      (module) => module.name === 'agent-command-provider',
    );

    // The module is what carries the policy to the operations that enforce it. Asserting the
    // policy is READ here rather than that a name appears keeps this from passing on registration
    // alone — a module registered without its policy is the exact state this item fixes.
    expect(providerModule).toBeDefined();
    expect(JSON.stringify(providerModule)).toContain('anthropic');
  });
});
