/**
 * Env-var-only zero-config startup tests (CLI-066).
 *
 * When no settings profile resolves, provider resolution falls back to the first
 * provider definition whose `$ENV:` apiKey default resolves against the environment
 * and whose defaults include a model. Settings always win; no recognized key keeps
 * the typed ProviderConfigError.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ProviderConfigError,
  readProviderSettings,
  resolveEnvDefaultProvider,
} from '../provider-factory.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

function definition(partial: Partial<IProviderDefinition> & { type: string }): IProviderDefinition {
  return {
    createProvider: () => {
      throw new Error('not used in resolution tests');
    },
    ...partial,
  };
}

const ANTHROPIC = definition({
  type: 'anthropic',
  defaults: { model: 'claude-default-model', apiKey: '$ENV:ANTHROPIC_API_KEY' },
});
const OPENAI_NO_MODEL = definition({
  type: 'openai',
  defaults: { apiKey: '$ENV:OPENAI_API_KEY' },
});
const GEMINI = definition({
  type: 'gemini',
  defaults: { model: 'gemini-default-model', apiKey: '$ENV:GEMINI_API_KEY' },
});
const GEMMA_LITERAL_KEY = definition({
  type: 'gemma',
  defaults: { model: 'gemma-model', apiKey: 'lm-studio', baseURL: 'http://localhost:1234/v1' },
});
const DEEPSEEK = definition({
  type: 'deepseek',
  defaults: {
    model: 'deepseek-default-model',
    apiKey: '$ENV:DEEPSEEK_API_KEY',
    baseURL: 'https://api.deepseek.com/v1',
  },
});
const DEFINITIONS = [ANTHROPIC, OPENAI_NO_MODEL, GEMINI, GEMMA_LITERAL_KEY, DEEPSEEK];

describe('resolveEnvDefaultProvider (CLI-066)', () => {
  it('TC-01: synthesizes the anthropic config from definition defaults when its env key is set', () => {
    const config = resolveEnvDefaultProvider(DEFINITIONS, { ANTHROPIC_API_KEY: 'sk-test' });

    expect(config).toMatchObject({
      name: 'anthropic',
      model: 'claude-default-model',
      // Resolved key (profile-path parity); the env var NAME travels in sourceEnvVar.
      apiKey: 'sk-test',
      source: 'env-default',
      sourceEnvVar: 'ANTHROPIC_API_KEY',
    });
  });

  it('TC-02: definition order decides when multiple synthesizable keys are set', () => {
    const config = resolveEnvDefaultProvider(DEFINITIONS, {
      GEMINI_API_KEY: 'g-key',
      ANTHROPIC_API_KEY: 'a-key',
    });

    expect(config?.name).toBe('anthropic');
  });

  it('TC-02: falls through to the next synthesizable definition when the first key is unset', () => {
    const config = resolveEnvDefaultProvider(DEFINITIONS, { GEMINI_API_KEY: 'g-key' });

    expect(config?.name).toBe('gemini');
  });

  it('TC-05: openai (no default model) never synthesizes even with its env var set', () => {
    const config = resolveEnvDefaultProvider(DEFINITIONS, { OPENAI_API_KEY: 'sk-openai' });

    expect(config).toBeUndefined();
  });

  it('TC-05: gemma (literal non-$ENV apiKey) never synthesizes', () => {
    // gemma's literal key default is always "present" but is not an env reference.
    const config = resolveEnvDefaultProvider([GEMMA_LITERAL_KEY], {});

    expect(config).toBeUndefined();
  });

  it('TC-05: deepseek synthesizes from its complete defaults including baseURL', () => {
    const config = resolveEnvDefaultProvider(DEFINITIONS, { DEEPSEEK_API_KEY: 'dk' });

    expect(config).toMatchObject({
      name: 'deepseek',
      model: 'deepseek-default-model',
      baseURL: 'https://api.deepseek.com/v1',
      source: 'env-default',
    });
  });

  it('empty env value does not count as set', () => {
    const config = resolveEnvDefaultProvider(DEFINITIONS, { ANTHROPIC_API_KEY: '' });

    expect(config).toBeUndefined();
  });
});

describe('readProviderSettings env-default integration (CLI-066)', () => {
  let cwd: string | undefined;

  afterEach(() => {
    if (cwd) rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('TC-01: no settings anywhere + env key set → env-default config', () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-env-default-'));

    const config = readProviderSettings(cwd, {
      providerDefinitions: DEFINITIONS,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
    });

    expect(config.name).toBe('anthropic');
    expect(config.source).toBe('env-default');
  });

  it('TC-03: settings profile wins over the env key', () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-env-default-'));
    const robotaDir = join(cwd, '.robota');
    mkdirSync(robotaDir, { recursive: true });
    writeFileSync(
      join(robotaDir, 'settings.json'),
      JSON.stringify({
        currentProvider: 'gemini',
        providers: {
          gemini: { type: 'gemini', model: 'configured-model', apiKey: '$ENV:GEMINI_API_KEY' },
        },
      }),
      'utf8',
    );

    const config = readProviderSettings(cwd, {
      providerDefinitions: DEFINITIONS,
      env: { ANTHROPIC_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-key' },
    });

    expect(config.name).toBe('gemini');
    expect(config.model).toBe('configured-model');
    expect(config.source).toBeUndefined();
  });

  it('TC-04: no profile + no recognized env key → ProviderConfigError unchanged', () => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-env-default-'));

    expect(() =>
      readProviderSettings(cwd as string, { providerDefinitions: DEFINITIONS, env: {} }),
    ).toThrow(ProviderConfigError);
  });
});
