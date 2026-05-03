import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IParsedCliArgs } from '../cli-args.js';
import {
  ensureConfig,
  formatMissingProviderConfigMessage,
  runInteractiveProviderSetup,
} from '../provider-setup.js';
import type { IProviderDefinition } from '../provider-definition.js';

const TMP_BASE = join(tmpdir(), `robota-provider-setup-test-${process.pid}`);
const ORIGINAL_HOME = process.env.HOME;
const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
const openaiDefaults = {
  apiKey: '$ENV:OPENAI_API_KEY',
};
const providerDefinitions: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    displayName: 'Anthropic',
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
    displayName: 'OpenAI',
    defaults: openaiDefaults,
    setupSteps: [
      {
        key: 'model',
        title: 'OpenAI model',
        required: true,
      },
      {
        key: 'apiKey',
        title: 'OpenAI API key',
        defaultValue: openaiDefaults.apiKey,
        masked: true,
      },
    ],
    requiresApiKey: true,
    createProvider: () => {
      throw new Error('not used');
    },
  },
  {
    type: 'qwen',
    displayName: 'Qwen',
    description: 'Alibaba Cloud Model Studio',
    defaults: {
      model: 'qwen-plus',
      apiKey: '$ENV:DASHSCOPE_API_KEY',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    },
    setupSteps: [
      {
        key: 'baseURL',
        title: 'Qwen OpenAI-compatible base URL',
        defaultValue: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      },
      { key: 'model', title: 'Qwen model', defaultValue: 'qwen-plus' },
      {
        key: 'apiKey',
        title: 'Qwen Model Studio API key',
        defaultValue: '$ENV:DASHSCOPE_API_KEY',
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
    delete process.env.OPENAI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
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

  it('writes OpenAI settings during interactive setup', async () => {
    const home = join(TMP_BASE, 'home-openai');
    process.env.HOME = home;
    process.env.OPENAI_API_KEY = 'sk-openai-from-env';
    const answers = ['openai', 'gpt-4o', '', 'ko'];
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
      model: 'gpt-4o',
      apiKey: openaiDefaults.apiKey,
    });
    expect(providers.anthropic).toBeUndefined();
  });

  it('writes provider selected from the first-run provider list', async () => {
    const home = join(TMP_BASE, 'home-qwen');
    process.env.HOME = home;
    process.env.DASHSCOPE_API_KEY = 'dashscope-key';
    const answers = ['3', '', '', '', 'ko'];
    const prompts: string[] = [];
    const promptInput = async (label: string): Promise<string> => {
      prompts.push(label);
      return answers.shift() ?? '';
    };

    await runInteractiveProviderSetup(
      join(TMP_BASE, 'project'),
      baseArgs(),
      promptInput,
      providerDefinitions,
    );

    const settings = readUserSettings(home);
    const providers = settings.providers as Record<string, Record<string, unknown>>;
    expect(prompts[0]).toContain('Select provider');
    expect(prompts[0]).toContain('Qwen (qwen)');
    expect(settings.currentProvider).toBe('qwen');
    expect(settings.language).toBe('ko');
    expect(providers.qwen).toMatchObject({
      type: 'qwen',
      model: 'qwen-plus',
      apiKey: '$ENV:DASHSCOPE_API_KEY',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    });
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

  it('formats missing-config guidance from injected provider definitions', () => {
    const message = formatMissingProviderConfigMessage(providerDefinitions);

    expect(message).toContain('Supported providers: anthropic, openai, qwen');
    expect(message).toContain(
      'robota --configure-provider qwen --type qwen --base-url <url> --model <model> --api-key-env <ENV_NAME> --set-current',
    );
    expect(message).not.toContain('supergemma4-26b-uncensored-v2');
  });
});
