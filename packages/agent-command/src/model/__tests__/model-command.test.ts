/**
 * #3282 §2 — `/model`.
 *
 * `buildProviderSwitch` (#3282 §1 fix, PR #3297) validates a cross-profile switch BEFORE writing
 * settings, so a switch that would fail changes nothing on disk. `/model` follows the same shape for
 * its cross-profile branch, and for the same-profile branch goes one step further: it performs the
 * live hot-swap itself (via `applyModelOptions`, the same seam `/effort` and `/preset` use) and
 * persists only once THAT succeeds — never a static validation standing in for the real attempt.
 */

import { describe, expect, it, vi } from 'vitest';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { executeModelCommand } from '../model-command.js';

import type { IProviderCommandModuleOptions, IProviderProfileSettings } from '@robota-sdk/agent-framework';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const DEFINITIONS: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    displayName: 'Anthropic',
    modelCatalog: {
      status: 'live',
      entries: [
        { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
      ],
    },
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'openai',
    displayName: 'OpenAI',
    modelCatalog: { status: 'unavailable' },
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

function providers(): Record<string, IProviderProfileSettings> {
  return {
    anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
    'my-openai': { type: 'openai', model: 'gpt-5.1', apiKey: '$ENV:OPENAI_API_KEY' },
  };
}

function buildOptions(overrides: {
  writeTargetSettings?: ReturnType<typeof vi.fn>;
  currentProvider?: string;
  providers?: Record<string, IProviderProfileSettings>;
  allowedProviders?: string[];
}): IProviderCommandModuleOptions {
  const providerMap = overrides.providers ?? providers();
  const document = { currentProvider: overrides.currentProvider ?? 'anthropic', providers: providerMap };
  return {
    providerDefinitions: DEFINITIONS,
    settings: {
      readMergedSettings: () => document,
      readTargetSettings: () => document,
      writeTargetSettings: overrides.writeTargetSettings ?? vi.fn(),
    },
    ...(overrides.allowedProviders !== undefined
      ? { orgPolicy: { allowedProviders: overrides.allowedProviders } }
      : {}),
  };
}

describe('/model', () => {
  it('hot-swaps within the current profile and persists only after the swap succeeds', async () => {
    const applyModelOptions = vi.fn().mockResolvedValue(undefined);
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({
      session: { applyModelOptions, getModelId: () => 'claude-sonnet-4-6' },
    });
    const options = buildOptions({ writeTargetSettings });

    const result = await executeModelCommand(host, 'claude-haiku-4-5', options);

    expect(result).toEqual({ message: 'Model: Claude Haiku 4.5', success: true });
    expect(applyModelOptions).toHaveBeenCalledWith({ model: 'claude-haiku-4-5' });
    expect(writeTargetSettings).toHaveBeenCalledTimes(1);
    const written = writeTargetSettings.mock.calls[0]![0];
    expect(written.providers.anthropic).toMatchObject({ model: 'claude-haiku-4-5' });
  });

  it('a failed same-profile swap persists nothing', async () => {
    const applyModelOptions = vi.fn().mockRejectedValue(new Error('boom'));
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({
      session: { applyModelOptions, getModelId: () => 'claude-sonnet-4-6' },
    });
    const options = buildOptions({ writeTargetSettings });

    const result = await executeModelCommand(host, 'claude-haiku-4-5', options);

    expect(result.success).toBe(false);
    expect(result.message).toContain('boom');
    expect(writeTargetSettings).not.toHaveBeenCalled();
  });

  it('a cross-profile id switches profile through the provider-hot-swap host action', async () => {
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({
      session: { getModelId: () => 'claude-sonnet-4-6' },
    });
    const options = buildOptions({ writeTargetSettings });

    const result = await executeModelCommand(host, 'gpt-5.1', options);

    expect(result.success).toBe(true);
    expect(result.message).toBe('Model: gpt-5.1');
    expect(result.hostActions).toEqual([{ type: 'provider-hot-swap', profileName: 'my-openai' }]);
    expect(writeTargetSettings).toHaveBeenCalledTimes(1);
    const written = writeTargetSettings.mock.calls[0]![0];
    expect(written.currentProvider).toBe('my-openai');
    expect(written.providers['my-openai']).toMatchObject({ model: 'gpt-5.1' });
  });

  it('an org policy still allowing the target profile leaves a cross-profile switch working', async () => {
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({ session: { getModelId: () => 'claude-sonnet-4-6' } });
    const options = buildOptions({ writeTargetSettings, allowedProviders: ['anthropic', 'my-openai'] });

    const result = await executeModelCommand(host, 'gpt-5.1', options);

    expect(result.success).toBe(true);
    expect(result.hostActions).toEqual([{ type: 'provider-hot-swap', profileName: 'my-openai' }]);
    expect(writeTargetSettings).toHaveBeenCalledTimes(1);
  });

  it('refuses a cross-profile switch to a profile org policy disallows, changing nothing on disk', async () => {
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({ session: { getModelId: () => 'claude-sonnet-4-6' } });
    // Typing the id resolves it (resolution is never filtered) so the refusal names the profile
    // specifically, rather than the id falling through to a generic "Unknown model" error.
    const options = buildOptions({ writeTargetSettings, allowedProviders: ['anthropic'] });

    const result = await executeModelCommand(host, 'gpt-5.1', options);

    expect(result.success).toBe(false);
    expect(result.message).toContain('organization policy');
    expect(result.message).toContain('my-openai');
    expect(result.hostActions).toBeUndefined();
    expect(writeTargetSettings).not.toHaveBeenCalled();
  });

  it('the listing omits a profile org policy disallows', async () => {
    const host = createTestCommandHost({ session: { getModelId: () => 'claude-sonnet-4-6' } });
    const options = buildOptions({ allowedProviders: ['anthropic'] });

    const result = await executeModelCommand(host, '', options);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Anthropic (anthropic)');
    expect(result.message).not.toContain('OpenAI');
    expect(result.message).not.toContain('my-openai');
  });

  it('an unknown id gives a plain error naming /model', async () => {
    const host = createTestCommandHost({ session: { getModelId: () => 'claude-sonnet-4-6' } });
    const options = buildOptions({});

    const result = await executeModelCommand(host, 'not-a-real-model', options);

    expect(result).toEqual({
      message: 'Unknown model "not-a-real-model". Run /model to see the choices.',
      success: false,
    });
  });

  it('prefers the current profile when an id is offered by more than one profile', async () => {
    const applyModelOptions = vi.fn().mockResolvedValue(undefined);
    const writeTargetSettings = vi.fn();
    const shared = {
      anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
      'anthropic-2': { type: 'anthropic', model: 'claude-haiku-4-5' },
    };
    const host = createTestCommandHost({
      session: { applyModelOptions, getModelId: () => 'claude-sonnet-4-6' },
    });
    const options = buildOptions({ writeTargetSettings, providers: shared, currentProvider: 'anthropic' });

    const result = await executeModelCommand(host, 'claude-haiku-4-5', options);

    // Resolved against the CURRENT profile's catalog entry, not "anthropic-2" — applyModelOptions
    // (same-profile hot-swap), not a provider-hot-swap host action, proves which branch ran.
    expect(result.success).toBe(true);
    expect(applyModelOptions).toHaveBeenCalledWith({ model: 'claude-haiku-4-5' });
    expect(result.hostActions).toBeUndefined();
  });

  it('lists models as plain text without an interactive renderer', async () => {
    const host = createTestCommandHost({ session: { getModelId: () => 'claude-sonnet-4-6' } });
    const options = buildOptions({});

    const result = await executeModelCommand(host, '', options);

    expect(result.success).toBe(true);
    expect(result.message).toContain('Anthropic (anthropic)');
    expect(result.message).toContain('* Claude Sonnet 4.6');
    expect(result.message).toContain('OpenAI (my-openai)');
  });

  it('drives the inline picker and applies the chosen model when a renderer is attached', async () => {
    const applyModelOptions = vi.fn().mockResolvedValue(undefined);
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({
      session: { applyModelOptions, getModelId: () => 'claude-sonnet-4-6' },
      overrides: {
        getUserInteraction: () => ({
          ask: async () => ({ type: 'answer', values: ['claude-haiku-4-5'] }),
        }),
      },
    });
    const options = buildOptions({ writeTargetSettings });

    const result = await executeModelCommand(host, '', options);

    expect(result).toEqual({ message: 'Model: Claude Haiku 4.5', success: true });
  });

  it('reports cancellation without changing anything when the picker is cancelled', async () => {
    const writeTargetSettings = vi.fn();
    const host = createTestCommandHost({
      session: { getModelId: () => 'claude-sonnet-4-6' },
      overrides: { getUserInteraction: () => ({ ask: async () => ({ type: 'cancelled' }) }) },
    });
    const options = buildOptions({ writeTargetSettings });

    const result = await executeModelCommand(host, '', options);

    expect(result).toEqual({ message: 'Model selection cancelled.', success: true });
    expect(writeTargetSettings).not.toHaveBeenCalled();
  });
});
