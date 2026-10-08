import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeHostSettingsStore } from '@robota-sdk/agent-framework';
import type { IProviderConnectionHost } from '@robota-sdk/agent-framework';
import type {
  IProviderDefinition,
  ITerminalOutput,
  IUserInteraction,
} from '@robota-sdk/agent-core';
import { PrintTerminal } from '../../print-terminal.js';
import {
  handleProviderConfigurationArgs,
  runInteractiveProviderSetup,
} from '../provider-startup.js';
import { parseCliArgs } from '../../utils/cli-args.js';

const token = 'synthetic-cli-setup-key';
const reference = { service: 'robota.provider.openrouter', account: 'fixture-host-key' };
const definitions: IProviderDefinition[] = [
  {
    type: 'openrouter',
    connectionMethods: ['api-key', 'browser'],
    requiresApiKey: true,
    defaults: {
      model: 'fixture/model',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: '$ENV:OPENROUTER_API_KEY',
    },
    setupSteps: [
      { key: 'apiKey', title: 'API key', masked: true },
      { key: 'model', title: 'Model', defaultValue: 'fixture/model' },
    ],
    createProvider: () => {
      throw new Error('setup must not run inference');
    },
  },
];
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'openrouter-cli-setup-'));
  dirs.push(directory);
  const path = join(directory, 'settings.json');
  const settings = createNodeHostSettingsStore('user', path);
  const connect = vi.fn<IProviderConnectionHost['connect']>(async (_request, persist) => {
    await persist(reference, new AbortController().signal);
    return reference;
  });
  const terminal: ITerminalOutput = new PrintTerminal();
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const access = {
    cliName: 'fixture',
    env: { FIXTURE_KEY: token },
    settingsSources: [settings.source],
    settingsStores: [settings],
    connectionHost: { connect },
  };
  return { directory, path, settings, connect, terminal, access };
}
describe('CLI OpenRouter setup entry points', () => {
  it('stores only the host reference for a literal key supplied through headless flags', async () => {
    const f = fixture();
    const handled = await handleProviderConfigurationArgs(
      f.directory,
      parseCliArgs([
        '--configure-provider',
        'router',
        '--type',
        'openrouter',
        '--api-key',
        token,
        '--set-current',
      ]),
      f.terminal,
      definitions,
      f.access,
    );
    expect(handled).toBe(true);
    expect(f.connect).toHaveBeenCalledOnce();
    expect(f.connect.mock.calls[0]?.[0]).toMatchObject({
      type: 'openrouter',
      profile: 'router',
      method: 'api-key',
      apiKey: token,
    });
    expect(f.settings.read()).toMatchObject({
      currentProvider: 'router',
      providers: { router: { type: 'openrouter', apiKeyRef: reference } },
    });
    expect(readFileSync(f.path, 'utf8')).not.toContain(token);
    expect(f.settings.read().providers).not.toHaveProperty('router.apiKey');
  });
  it('keeps environment-only flags browserless and without host secret storage', async () => {
    const f = fixture();
    await handleProviderConfigurationArgs(
      f.directory,
      parseCliArgs([
        '--configure-provider',
        'router',
        '--type',
        'openrouter',
        '--api-key-env',
        'FIXTURE_KEY',
        '--set-current',
      ]),
      f.terminal,
      definitions,
      { ...f.access, orgPolicy: { requireApiKeyFromEnv: true } },
    );
    expect(f.connect).not.toHaveBeenCalled();
    expect(f.settings.read()).toMatchObject({
      providers: { router: { apiKey: '$ENV:FIXTURE_KEY' } },
    });
    expect(readFileSync(f.path, 'utf8')).not.toContain(token);
  });
  it('does not overwrite a profile changed while its new key was being validated', async () => {
    const f = fixture();
    f.settings.write({
      currentProvider: 'router',
      providers: { router: { type: 'openrouter', model: 'before', apiKeyRef: reference } },
    });
    const changed = {
      currentProvider: 'router',
      providers: {
        router: {
          type: 'openrouter',
          model: 'concurrent-edit',
          apiKeyRef: { ...reference, account: 'another-connection' },
        },
      },
    };
    f.connect.mockImplementationOnce(async (_request, persist) => {
      f.settings.write(changed);
      await persist(reference, new AbortController().signal);
      return reference;
    });
    await expect(
      handleProviderConfigurationArgs(
        f.directory,
        parseCliArgs([
          '--configure-provider',
          'router',
          '--type',
          'openrouter',
          '--api-key',
          token,
        ]),
        f.terminal,
        definitions,
        f.access,
      ),
    ).rejects.toThrow('changed');
    expect(f.settings.read()).toEqual(changed);
  });
  it.each([
    ['custom destination', ['--base-url', 'https://custom.invalid/v1'], {}],
    ['environment-only policy', [], { requireApiKeyFromEnv: true }],
  ] as const)(
    'rejects literal flags with %s before connecting',
    async (_label, extra, orgPolicy) => {
      const f = fixture();
      await expect(
        handleProviderConfigurationArgs(
          f.directory,
          parseCliArgs([
            '--configure-provider',
            'router',
            '--type',
            'openrouter',
            '--api-key',
            token,
            ...extra,
          ]),
          f.terminal,
          definitions,
          { ...f.access, orgPolicy },
        ),
      ).rejects.toThrow();
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.settings.read()).toEqual({});
    },
  );
  it('forwards the startup interaction and host port for browser then model setup', async () => {
    const f = fixture();
    const ask = vi.fn<IUserInteraction['ask']>(async (request) =>
      request.id === 'provider-connection-method'
        ? { type: 'answer', values: ['browser'] }
        : { type: 'answer', values: [], text: 'fixture/selected-model' },
    );
    await runInteractiveProviderSetup(
      f.directory,
      parseCliArgs(['--configure']),
      vi.fn().mockResolvedValueOnce('4').mockResolvedValue(''),
      f.terminal,
      definitions,
      { ...f.access, interaction: { ask } },
    );
    expect(ask.mock.calls.map(([request]) => request.id)).toEqual([
      'provider-connection-method',
      'provider-setup-model',
    ]);
    expect(f.connect.mock.calls[0]?.[0]).toMatchObject({ method: 'browser', type: 'openrouter' });
    expect(f.settings.read()).toMatchObject({
      currentProvider: 'openrouter',
      providers: { openrouter: { model: 'fixture/selected-model', apiKeyRef: reference } },
    });
    expect(readFileSync(f.path, 'utf8')).not.toContain(token);
  });
});
