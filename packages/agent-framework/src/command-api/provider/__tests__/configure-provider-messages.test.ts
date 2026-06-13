/**
 * CLI-068: configure-provider failures name the actual cause — unknown provider
 * is diagnosed as unknown (with the supported list), an unset --api-key-env
 * target names the variable at configure time.
 */

import { describe, expect, it } from 'vitest';

import { buildProviderSetupPatch } from '../provider-settings.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

// agent-framework must not depend on agent-provider — fixture definitions
// mirror the real default-definition shapes (CLI-066 test precedent).
function definition(partial: Partial<IProviderDefinition> & { type: string }): IProviderDefinition {
  return {
    createProvider: () => {
      throw new Error('not used in configure-validation tests');
    },
    ...partial,
  };
}

const definitions: readonly IProviderDefinition[] = [
  definition({
    type: 'anthropic',
    defaults: { model: 'claude-default-model', apiKey: '$ENV:ANTHROPIC_API_KEY' },
  }),
  // openai carries no default model by policy (live model discovery).
  definition({ type: 'openai', defaults: { apiKey: '$ENV:OPENAI_API_KEY' } }),
];

describe('configure-provider failure messages (CLI-068)', () => {
  it('TC-01: unknown provider type names the cause and lists supported providers', () => {
    let thrown: Error | undefined;
    try {
      buildProviderSetupPatch(
        { profile: 'doesnotexist', type: 'doesnotexist', setCurrent: false },
        { providerDefinitions: definitions, env: {} },
      );
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('Unknown provider "doesnotexist"');
    expect(thrown!.message).toContain('Supported providers:');
    expect(thrown!.message).toContain('anthropic');
    expect(thrown!.message).not.toContain('missing model');
  });

  it('TC-02: unset --api-key-env target names the variable and the configure-time requirement', () => {
    let thrown: Error | undefined;
    try {
      buildProviderSetupPatch(
        {
          profile: 'anthropic',
          type: 'anthropic',
          model: 'claude-test',
          apiKeyEnv: 'UNSET_VAR',
          setCurrent: false,
        },
        { providerDefinitions: definitions, env: {} },
      );
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('Environment variable UNSET_VAR is not set');
    expect(thrown!.message).toContain('set it before configuring');
    expect(thrown!.message).not.toContain('missing apiKey');
  });

  it('TC-03: valid configure flow succeeds unchanged (regression)', () => {
    const patch = buildProviderSetupPatch(
      {
        profile: 'anthropic',
        type: 'anthropic',
        model: 'claude-test',
        apiKeyEnv: 'MY_SET_VAR',
        setCurrent: true,
      },
      { providerDefinitions: definitions, env: { MY_SET_VAR: 'sk-test' } },
    );
    expect(patch.currentProvider).toBe('anthropic');
    expect(patch.providers['anthropic']).toMatchObject({
      type: 'anthropic',
      model: 'claude-test',
      apiKey: '$ENV:MY_SET_VAR',
    });
  });

  it('TC-04: a known provider genuinely missing a model still reports the missing field', () => {
    // openai carries no default model by policy (live model discovery) — the
    // missing-model diagnosis is correct here and must be preserved.
    let thrown: Error | undefined;
    try {
      buildProviderSetupPatch(
        {
          profile: 'openai',
          type: 'openai',
          apiKeyEnv: 'MY_SET_VAR',
          setCurrent: false,
        },
        { providerDefinitions: definitions, env: { MY_SET_VAR: 'sk-test' } },
      );
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('is missing model');
    expect(thrown!.message).not.toContain('Unknown provider');
  });
});
