import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IParsedCliArgs } from '../cli-args.js';
import { ensureConfig, runInteractiveProviderSetup } from '../provider-setup.js';
import type { IProviderDefinition } from '../provider-definition.js';

const TMP_BASE = join(tmpdir(), `robota-provider-setup-test-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
const openaiDefaults = {
  model: 'supergemma4-26b-uncensored-v2',
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
};
const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'claude-sonnet-4-6' },
    setupSteps: [
      { key: 'apiKey', title: 'Anthropic API key', required: true, masked: true },
      { key: 'model', title: 'Anthropic model', defaultValue: 'claude-sonnet-4-6' },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'openai',
    defaults: openaiDefaults,
    setupSteps: [
      {
        key: 'baseURL',
        title: 'OpenAI-compatible base URL',
        defaultValue: openaiDefaults.baseURL,
      },
      {
        key: 'model',
        title: 'OpenAI-compatible model',
        defaultValue: openaiDefaults.model,
      },
      {
        key: 'apiKey',
        title: 'OpenAI-compatible API key',
        defaultValue: openaiDefaults.apiKey,
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
];

function baseArgs(): IParsedCliArgs {
  return {
    positional: [],
    printMode: false,
    continueMode: false,
    resumeId: undefined,
    model: undefined,
    language: undefined,
    permissionMode: undefined,
    maxTurns: undefined,
    forkSession: false,
    sessionName: undefined,
    outputFormat: undefined,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    version: false,
    reset: false,
    bare: false,
    allowedTools: undefined,
    noSessionPersistence: false,
    jsonSchema: undefined,
    configure: false,
    configureProvider: undefined,
    provider: undefined,
    providerType: undefined,
    baseURL: undefined,
    apiKey: undefined,
    apiKeyEnv: undefined,
    setCurrent: false,
    settingsScope: undefined,
    checkUpdate: false,
    disableUpdateCheck: false,
  };
}

function readUserSettings(home: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(home, '.robota', 'settings.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('provider setup', () => {
  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: ORIGINAL_STDIN_TTY,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: ORIGINAL_STDOUT_TTY,
      configurable: true,
    });
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('writes LM Studio defaults during interactive setup', async () => {
    const home = join(TMP_BASE, 'home-openai');
    process.env.HOME = home;
    const answers = ['openai', '', '', '', 'ko'];
    const promptInput = async (): Promise<string> => answers.shift() ?? '';

    await runInteractiveProviderSetup(
      join(TMP_BASE, 'project'),
      baseArgs(),
      promptInput,
      providerDefinitions,
    );

    const settings = readUserSettings(home);
    const providers = settings.providers as Record<string, Record<string, unknown>>;
    expect(settings.currentProvider).toBe('openai');
    expect(settings.language).toBe('ko');
    expect(providers.openai).toMatchObject({
      type: 'openai',
      model: openaiDefaults.model,
      apiKey: openaiDefaults.apiKey,
      baseURL: openaiDefaults.baseURL,
    });
    expect(providers.anthropic).toBeUndefined();
  });

  it('does not prompt in non-interactive missing-config mode', async () => {
    process.env.HOME = join(TMP_BASE, 'home-missing');
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    let prompted = false;
    const promptInput = async (): Promise<string> => {
      prompted = true;
      return '';
    };

    await expect(
      ensureConfig(join(TMP_BASE, 'project'), baseArgs(), promptInput, providerDefinitions),
    ).rejects.toThrow('No provider configuration found');
    expect(prompted).toBe(false);
  });
});
