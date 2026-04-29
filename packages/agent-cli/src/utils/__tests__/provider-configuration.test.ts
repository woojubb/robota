import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyProviderConfiguration, applyProviderSwitch } from '../provider-configuration.js';

const TMP_BASE = join(tmpdir(), `robota-provider-configuration-test-${process.pid}`);

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('provider configuration writes', () => {
  afterEach(() => {
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('adds an Anthropic profile, preserves OpenAI profile, and sets current provider', () => {
    const settingsPath = join(TMP_BASE, '.robota', 'settings.json');
    mkdirSync(join(TMP_BASE, '.robota'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        currentProvider: 'openai',
        providers: {
          openai: {
            type: 'openai',
            model: 'supergemma4-26b-uncensored-v2',
            apiKey: 'lm-studio',
          },
        },
      }),
      'utf8',
    );

    applyProviderConfiguration(settingsPath, {
      profile: 'anthropic',
      type: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      setCurrent: true,
    });

    const settings = readJson(settingsPath);
    const providers = settings.providers as Record<string, Record<string, unknown>>;
    expect(settings.currentProvider).toBe('anthropic');
    expect(providers.openai?.model).toBe('supergemma4-26b-uncensored-v2');
    expect(providers.anthropic).toEqual({
      type: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: '$ENV:ANTHROPIC_API_KEY',
    });
  });

  it('writes only the requested settings path', () => {
    const userPath = join(TMP_BASE, '.robota', 'settings.json');
    const claudePath = join(TMP_BASE, '.claude', 'settings.json');

    applyProviderConfiguration(userPath, {
      profile: 'openai',
      type: 'openai',
      model: 'supergemma4-26b-uncensored-v2',
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
      setCurrent: true,
    });

    expect(existsSync(userPath)).toBe(true);
    expect(existsSync(claudePath)).toBe(false);
  });

  it('persists provider switch only when explicitly applied', () => {
    const settingsPath = join(TMP_BASE, '.robota', 'settings.json');
    mkdirSync(join(TMP_BASE, '.robota'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' },
          openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
        },
      }),
      'utf8',
    );

    applyProviderSwitch(settingsPath, 'openai');

    expect(readJson(settingsPath).currentProvider).toBe('openai');
  });

  it('persists currentProvider when profile is known from merged settings', () => {
    const settingsPath = join(TMP_BASE, '.robota', 'settings.json');

    applyProviderSwitch(settingsPath, 'openai', {
      knownProviders: {
        openai: { type: 'openai', model: 'supergemma4-26b-uncensored-v2' },
      },
    });

    const settings = readJson(settingsPath);
    expect(settings.currentProvider).toBe('openai');
    expect(settings.providers).toBeUndefined();
  });
});
