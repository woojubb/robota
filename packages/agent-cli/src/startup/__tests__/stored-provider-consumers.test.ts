import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import type {
  IAIProvider,
  IProviderDefinition,
  TProviderCredentialResolver,
} from '@robota-sdk/agent-core';
import { composeCliAdvisor } from '../advisor-composition.js';
import { applyModelFallbackChain } from '../model-fallback-startup.js';
import { buildPooledSessionOptions, buildServeSessionOptions } from '../../modes/serve-mode.js';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createLiveContentSecretsGetter } from '../../telemetry/live-content-secrets.js';
import { prepareLiveContentRedactor } from '../../telemetry/live-content-redaction.js';
import { runEvalCommand } from '../../eval/eval-command.js';

const token = 'synthetic-stored-consumer-key';
const reference = { service: 'robota.provider.openrouter', account: 'fixture-connection' };
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'robota-stored-consumer-'));
  dirs.push(dir);
  const path = join(dir, 'settings.json');
  writeFileSync(
    path,
    JSON.stringify({
      currentProvider: 'main',
      providers: {
        main: { type: 'openrouter', model: 'main-model', apiKeyRef: reference },
        alternate: { type: 'openrouter', model: 'alternate-model', apiKeyRef: reference },
      },
    }),
  );
  const create = vi.fn((config) => {
    expect(config.apiKey).toBe(token);
    expect(config.apiKeyRef).toEqual(reference);
    return {
      name: 'openrouter',
      version: 'fixture',
      supportsTools: () => false,
      validateConfig: () => true,
      generateResponse: async () => ({ content: 'unused' }),
      chat: async () => ({
        id: 'fixture-response',
        role: 'assistant',
        content: 'STORED_CONSUMER_OK',
        state: 'complete',
        timestamp: new Date(),
      }),
    } as unknown as IAIProvider;
  });
  const definitions: IProviderDefinition[] = [
    {
      type: 'openrouter',
      defaults: { baseURL: 'https://openrouter.ai/api/v1' },
      createProvider: create,
    },
  ];
  const resolver = vi.fn<TProviderCredentialResolver>(async (config) => ({
    ...config,
    apiKey: token,
  }));
  return {
    dir,
    path,
    sources: [createNodeHostSettingsSource('user', path)],
    definitions,
    resolver,
    create,
  };
}
describe('CLI consumers of stored provider references', () => {
  it('carries the host resolver into served and recreated sessions', () => {
    const f = fixture();
    const options = buildServeSessionOptions({
      productRuntime: createTestProductRuntime(),
      cwd: '/work',
      args: { noSessionPersistence: true },
      preset: {},
      resolveProviderCredential: f.resolver,
    } as never);
    expect(options).toHaveProperty('resolveProviderCredential', f.resolver);
    expect(buildPooledSessionOptions(options, {}, 'recreated')).toHaveProperty(
      'resolveProviderCredential',
      f.resolver,
    );
    expect(f.resolver).not.toHaveBeenCalled();
  });
  it('resolves advisor credentials only when a consultation runs', async () => {
    const f = fixture();
    const advisor = composeCliAdvisor({
      flag: 'alternate',
      userSettings: {},
      safeMode: false,
      env: {},
      orgPolicy: null,
      settingsSources: f.sources,
      providerDefinitions: f.definitions,
      userSettingsPath: f.path,
      resolveProviderCredential: f.resolver,
      mainProvider: {
        provider: { name: 'openrouter' } as IAIProvider,
        config: { name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1' },
      },
    });
    expect(advisor.controller.set('alternate:changed-model').success).toBe(true);
    expect(advisor.controller.displayLabel()).toContain('changed-model');
    expect(f.resolver).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    const answer = await advisor.controller.consult({
      history: [],
      systemPrompt: 'fixture',
      mainDestination: 'openrouter@openrouter.ai',
      sessionId: 'fixture-session',
      turnId: 'fixture-turn',
    });
    expect(answer.outcome).toBe('answered');
    expect(answer.text).toContain('STORED_CONSUMER_OK');
    expect(f.resolver).toHaveBeenCalledOnce();
    expect(readFileSync(f.path, 'utf8')).not.toContain(token);
  });
  it('resolves fallback credentials after the primary becomes unavailable', async () => {
    const f = fixture();
    const primary = {
      name: 'openrouter',
      chat: async () => {
        throw Object.assign(new Error('overloaded'), { status: 529 });
      },
    } as unknown as IAIProvider;
    const provider = applyModelFallbackChain({
      provider: primary,
      fallbackFlag: ['alternate'],
      settingsSources: f.sources,
      primaryConfig: {
        name: 'openrouter',
        model: 'main-model',
        apiKey: token,
        apiKeyRef: reference,
        baseURL: 'https://openrouter.ai/api/v1',
      },
      providerDefinitions: f.definitions,
      resolveProviderCredential: f.resolver,
      notice: () => {},
    });
    expect(f.resolver).not.toHaveBeenCalled();
    const answer = await provider.chat([], { model: 'main-model' });
    expect(answer.content).toBe('STORED_CONSUMER_OK');
    expect(f.resolver).toHaveBeenCalledOnce();
    expect(readFileSync(f.path, 'utf8')).not.toContain(token);
  });
  it('redacts keys acquired after startup without putting them in settings', () => {
    const f = fixture();
    const known: string[] = [];
    const getSecrets = createLiveContentSecretsGetter({
      settingsSources: f.sources,
      providerDefinitions: f.definitions,
      env: {},
      resolvedCredentialSecrets: () => known,
    });
    expect(getSecrets()).not.toContain(token);
    known.push(token);
    expect(
      prepareLiveContentRedactor({ getSecrets, cwd: '/work', homedir: '/fixture/home' })(
        `echo ${token}`,
        2048,
        false,
      ).text,
    ).toBe('echo [redacted]');
    expect(readFileSync(f.path, 'utf8')).not.toContain(token);
  });
  it('resolves the stored profile before the actual default eval session runs', async () => {
    const f = fixture();
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const code = await runEvalCommand(['fixture.mjs'], f.dir, {
        settingsSources: f.sources,
        environment: {},
        providerDefinitions: f.definitions,
        resolveProviderCredential: f.resolver,
        loadDefinition: async () => ({
          name: 'stored fixture',
          cases: [{ input: 'reply' }],
          metrics: [
            { name: 'completed', score: (result) => result.response === 'STORED_CONSUMER_OK' },
          ],
        }),
      });
      expect(stderr.mock.calls.map(([message]) => String(message)).join('')).not.toContain(token);
      expect(code).toBe(0);
      expect(f.resolver).toHaveBeenCalledOnce();
      expect(f.create).toHaveBeenCalledOnce();
      expect(readFileSync(f.path, 'utf8')).not.toContain(token);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
