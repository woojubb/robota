import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyActiveModelChange,
  applyProviderConfiguration,
  applyProviderSwitch,
} from '../provider-configuration.js';
import { readProviderSettings } from '../provider-factory.js';

const TMP_BASE = join(tmpdir(), `robota-provider-configuration-test-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('provider configuration writes', () => {
  beforeEach(() => {
    process.env.HOME = join(TMP_BASE, 'home');
  });

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
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

  it('updates the highest-precedence active provider profile model', () => {
    const userPath = join(TMP_BASE, '.robota', 'settings.json');
    const projectPath = join(TMP_BASE, 'project', '.robota', 'settings.local.json');
    mkdirSync(join(TMP_BASE, '.robota'), { recursive: true });
    mkdirSync(join(TMP_BASE, 'project', '.robota'), { recursive: true });
    writeFileSync(
      userPath,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' },
        },
      }),
      'utf8',
    );
    writeFileSync(
      projectPath,
      JSON.stringify({
        currentProvider: 'qwen',
        providers: {
          qwen: { type: 'qwen', model: 'qwen3.6-plus-2026-04-02', apiKey: 'sk-qwen' },
        },
      }),
      'utf8',
    );

    const result = applyActiveModelChange(join(TMP_BASE, 'project'), 'qwen-plus', {
      settingsPaths: [userPath, projectPath],
    });

    expect(result.settingsPath).toBe(projectPath);
    const userSettings = readJson(userPath);
    const projectSettings = readJson(projectPath);
    expect(
      (userSettings.providers as Record<string, Record<string, unknown>>).anthropic?.model,
    ).toBe('claude-sonnet-4-6');
    expect((projectSettings.providers as Record<string, Record<string, unknown>>).qwen?.model).toBe(
      'qwen-plus',
    );
  });

  it('updates the provider override profile model resolved by the next session', () => {
    const cwd = join(TMP_BASE, 'project');
    const settingsPath = join(cwd, '.robota', 'settings.json');
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' },
          openai: {
            type: 'openai',
            model: 'gpt-4.1-mini',
            apiKey: 'lm-studio',
            baseURL: 'http://localhost:1234/v1',
          },
        },
      }),
      'utf8',
    );

    const result = applyActiveModelChange(cwd, 'gpt-4.1', {
      providerOverride: 'openai',
    });

    const settings = readJson(settingsPath);
    const providers = settings.providers as Record<string, Record<string, unknown>>;
    expect(result.profileName).toBe('openai');
    expect(providers.anthropic?.model).toBe('claude-sonnet-4-6');
    expect(providers.openai?.model).toBe('gpt-4.1');
    expect(readProviderSettings(cwd, { providerOverride: 'openai' }).model).toBe('gpt-4.1');
  });

  it('updates the current provider profile model resolved by the next session', () => {
    const cwd = join(TMP_BASE, 'project');
    const settingsPath = join(cwd, '.robota', 'settings.json');
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-ant' },
        },
      }),
      'utf8',
    );

    applyActiveModelChange(cwd, 'claude-opus-4-6');

    expect(readProviderSettings(cwd).model).toBe('claude-opus-4-6');
  });

  it('updates the legacy provider model resolved by the next session without losing fields', () => {
    const cwd = join(TMP_BASE, 'project');
    const settingsPath = join(cwd, '.robota', 'settings.json');
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        provider: {
          name: 'openai',
          model: 'gpt-4.1-mini',
          apiKey: 'lm-studio',
          baseURL: 'http://localhost:1234/v1',
        },
      }),
      'utf8',
    );

    applyActiveModelChange(cwd, 'gpt-4.1');

    const settings = readJson(settingsPath);
    expect(settings.provider).toMatchObject({
      name: 'openai',
      model: 'gpt-4.1',
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    });
    expect(readProviderSettings(cwd).model).toBe('gpt-4.1');
  });
});
