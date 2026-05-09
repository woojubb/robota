import { describe, it, expect, afterEach } from 'vitest';
import { rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IParsedCliArgs } from '../cli-args.js';
import {
  ensureConfig,
  formatMissingProviderConfigMessage,
  handleProviderConfigurationArgs,
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
  {
    type: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek OpenAI-compatible endpoint',
    defaults: {
      model: 'deepseek-v4-flash',
      apiKey: '$ENV:DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com',
    },
    setupSteps: [
      {
        key: 'baseURL',
        title: 'DeepSeek OpenAI-compatible base URL',
        defaultValue: 'https://api.deepseek.com',
      },
      { key: 'model', title: 'DeepSeek model', defaultValue: 'deepseek-v4-flash' },
      {
        key: 'apiKey',
        title: 'DeepSeek API key',
        defaultValue: '$ENV:DEEPSEEK_API_KEY',
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
    format: undefined,
    systemPrompt: undefined,
    appendSystemPrompt: undefined,
    taskFile: undefined,
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

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

describe('provider setup', () => {
  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
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
    expect(settings.currentProvider).toBe('gpt-4o');
    expect(settings.language).toBe('ko');
    expect(providers['gpt-4o']).toMatchObject({
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
    expect(settings.currentProvider).toBe('qwen-plus');
    expect(settings.language).toBe('ko');
    expect(providers['qwen-plus']).toMatchObject({
      type: 'qwen',
      model: 'qwen-plus',
      apiKey: '$ENV:DASHSCOPE_API_KEY',
      baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    });
  });

  it('writes a DeepSeek profile from provider-owned setup metadata', async () => {
    const home = join(TMP_BASE, 'home-deepseek');
    process.env.HOME = home;
    process.env.DEEPSEEK_API_KEY = 'deepseek-key';
    const answers = ['4', '', '', '', 'ko'];
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
    expect(prompts[0]).toContain('DeepSeek (deepseek)');
    expect(settings.currentProvider).toBe('deepseek-v4-flash');
    expect(settings.language).toBe('ko');
    expect(providers['deepseek-v4-flash']).toMatchObject({
      type: 'deepseek',
      model: 'deepseek-v4-flash',
      apiKey: '$ENV:DEEPSEEK_API_KEY',
      baseURL: 'https://api.deepseek.com',
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

    const args = { ...baseArgs(), provider: 'missing-profile' };
    await expect(
      ensureConfig(join(TMP_BASE, 'project'), args, promptInput, providerDefinitions),
    ).rejects.toThrow('No provider configuration found');
    expect(prompted).toBe(false);
  });

  it('validates the merged active provider instead of any individually valid settings file', async () => {
    const home = join(TMP_BASE, 'home-merged-active');
    const project = join(TMP_BASE, 'project-merged-active');
    process.env.HOME = home;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    writeJson(join(home, '.robota', 'settings.json'), {
      provider: {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-test',
      },
    });
    writeJson(join(project, '.robota', 'settings.local.json'), {
      currentProvider: 'qwen',
      providers: {
        qwen: {
          type: 'qwen',
          model: 'qwen-plus',
          apiKey: '$ENV:DASHSCOPE_API_KEY',
        },
      },
    });
    let prompted = false;
    const promptInput = async (): Promise<string> => {
      prompted = true;
      return '';
    };

    await expect(
      ensureConfig(project, baseArgs(), promptInput, providerDefinitions),
    ).rejects.toThrow('No provider configuration found');
    expect(prompted).toBe(false);
  });

  it('writes startup setup to project-local settings when project currentProvider masks user settings', async () => {
    const home = join(TMP_BASE, 'home-project-active');
    const project = join(TMP_BASE, 'project-active');
    process.env.HOME = home;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    writeJson(join(home, '.robota', 'settings.json'), {
      provider: {
        name: 'anthropic',
        model: 'claude-sonnet-4-6',
        apiKey: 'sk-ant-user',
      },
    });
    writeJson(join(project, '.robota', 'settings.local.json'), {
      currentProvider: 'qwen',
      providers: {
        qwen: {
          type: 'qwen',
          model: 'qwen-plus',
          apiKey: '$ENV:DASHSCOPE_API_KEY',
        },
      },
    });
    const answers = ['1', 'sk-ant-project', '', 'ko'];
    const promptInput = async (): Promise<string> => answers.shift() ?? '';

    await ensureConfig(project, baseArgs(), promptInput, providerDefinitions);

    const settings = JSON.parse(
      readFileSync(join(project, '.robota', 'settings.local.json'), 'utf8'),
    ) as {
      currentProvider?: string;
      language?: string;
      providers?: Record<string, Record<string, unknown>>;
    };
    expect(settings.currentProvider).toBe('claude-sonnet-4-6');
    expect(settings.language).toBe('ko');
    expect(settings.providers?.['claude-sonnet-4-6']).toMatchObject({
      type: 'anthropic',
      model: 'claude-sonnet-4-6',
      apiKey: 'sk-ant-project',
    });
    expect(settings.providers?.qwen).toMatchObject({
      type: 'qwen',
      model: 'qwen-plus',
    });
  });

  it('sets current provider in the effective project-local settings scope by default', () => {
    const home = join(TMP_BASE, 'home-provider-switch');
    const project = join(TMP_BASE, 'project-provider-switch');
    process.env.HOME = home;
    writeJson(join(home, '.robota', 'settings.json'), {
      currentProvider: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          model: 'claude-sonnet-4-6',
          apiKey: 'sk-ant-user',
        },
      },
    });
    writeJson(join(project, '.robota', 'settings.local.json'), {
      currentProvider: 'anthropic',
      providers: {
        qwen: {
          type: 'qwen',
          model: 'qwen-plus',
          apiKey: '$ENV:DASHSCOPE_API_KEY',
        },
      },
    });

    const handled = handleProviderConfigurationArgs(
      project,
      { ...baseArgs(), provider: 'qwen', setCurrent: true },
      providerDefinitions,
    );

    const userSettings = JSON.parse(
      readFileSync(join(home, '.robota', 'settings.json'), 'utf8'),
    ) as { currentProvider?: string };
    const projectSettings = JSON.parse(
      readFileSync(join(project, '.robota', 'settings.local.json'), 'utf8'),
    ) as { currentProvider?: string };
    expect(handled).toBe(true);
    expect(userSettings.currentProvider).toBe('anthropic');
    expect(projectSettings.currentProvider).toBe('qwen');
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
