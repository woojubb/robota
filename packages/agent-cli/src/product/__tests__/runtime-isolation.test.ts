import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createNodeHostSettingsSource,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

import {
  createTestProductEnvironment,
  createTestProductRuntime,
  cleanupTestProductRuntimes,
} from '../../__tests__/helpers/product-runtime.js';
import { createCliWorkspaceComposition } from '../../startup/workspace-project-composition.js';
import {
  resolveCliRuntimeContext,
  normalizeProductEnvironment,
} from '../../startup/product-bootstrap.js';
import { readUserSettingsOrExit } from '../../startup/user-settings.js';
import { createProductUserSettingsSources } from '../user-settings.js';
import { productPluginDirectories } from '../plugin-paths.js';
import { childProductEnvironment } from '../child-environment.js';
import { restartProductEnvironment } from '../restart-environment.js';
import { isSecretPath } from '../../peer-files/outgoing-file.js';
import { parseLaunchIntent } from '../../launch-intent/launch-intent.js';
import { selectCredentialStore } from '../../credentials/select-credential-store.js';
import { createFakeKeyring } from '../../credentials/__tests__/fake-keyring.js';
import { readCliProviderSettings } from '../../startup/provider-startup.js';

const temporary: string[] = [];
afterEach(() => {
  temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
  cleanupTestProductRuntimes();
});
function home(): string {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-isolation-'));
  temporary.push(directory);
  return directory;
}

describe('per-invocation CLI product isolation', () => {
  it('opens existing Robota settings and preserves its identity without product selection', () => {
    const userHome = home();
    const root = join(userHome, '.robota');
    mkdirSync(root);
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ language: 'ko' }));
    const runtime = resolveCliRuntimeContext({ environment: { HOME: userHome, PRODUCT_LOG_DIR: undefined } });
    expect(readUserSettingsOrExit(runtime).language).toBe('ko');
    expect(runtime.layout.userRoot).toBe(root);
    expect(runtime.environment.PRODUCT_LOG_DIR).toBe(join(root, 'logs'));
    expect(runtime.layout.projectDirectory).toBe('.robota');
    expect(runtime.vocabulary.cliName).toBe('robota');
    expect(runtime.config.crypto.masterKeyDerivationPath).toEqual([7240, 0]);
    expect(runtime.cryptoContext.purposes.deviceCert).toBe('robota/device-cert/v1');
    expect(runtime.config.credentials.serviceNamespace).toBe('robota');
  });

  it('lets explicit Robota aliases override host defaults while rejecting explicit conflicts', () => {
    const userHome = home();
    const root = join(userHome, 'custom-state');
    const logs = join(userHome, 'custom-logs');
    const cache = join(userHome, 'custom-cache');
    const runtime = resolveCliRuntimeContext({
      environment: {
        HOME: userHome,
        ROBOTA_ENV_PREFIX: 'IGNORED_',
        ROBOTA_USER_STATE_DIR: root,
        ROBOTA_LOG_DIR: logs,
        ROBOTA_CACHE_DIR: cache,
        ROBOTA_PROJECT_STATE_DIR: '.custom-project',
        ROBOTA_MASTER_KEY_DERIVATION_PATH: '[7240,1]',
        ROBOTA_DOCS_URL: 'https://docs.example/robota',
      },
    });
    expect(runtime.config.identity.envPrefix).toBe('ROBOTA_');
    expect(runtime.layout.userRoot).toBe(root);
    expect(runtime.layout.projectDirectory).toBe('.custom-project');
    expect(runtime.environment.PRODUCT_LOG_DIR).toBe(logs);
    expect(runtime.environment.PRODUCT_CACHE_DIR).toBe(cache);
    expect(runtime.config.crypto.masterKeyDerivationPath).toEqual([7240, 1]);
    expect(runtime.environment.PROJECT_DOCS_URL).toBe('https://docs.example/robota');
    expect(() => resolveCliRuntimeContext({
      environment: { HOME: userHome, PRODUCT_LOG_DIR: logs, ROBOTA_LOG_DIR: cache },
    })).toThrow('conflicts with ROBOTA_LOG_DIR');
    expect(resolveCliRuntimeContext({
      environment: { HOME: userHome, PRODUCT_LOG_DIR: logs, ROBOTA_LOG_DIR: logs },
    }).environment.PRODUCT_LOG_DIR).toBe(logs);
  });

  it('keeps A/B/A and concurrent settings, plugin and contribution roots independent under one home', async () => {
    const userHome = home();
    const a = createTestProductRuntime('cedar', { HOME: userHome });
    const b = createTestProductRuntime('maple', { HOME: userHome });
    for (const runtime of [a, b]) {
      mkdirSync(join(runtime.layout.userRoot, 'skills'), { recursive: true });
      writeFileSync(
        runtime.layout.userPaths.settings,
        JSON.stringify({ language: runtime.config.identity.id }),
      );
      writeFileSync(
        join(runtime.layout.userRoot, 'skills', 'sample.txt'),
        runtime.config.identity.id,
      );
    }
    const access = createRestrictedWorkspaceProjectAccess('untrusted', userHome);
    const read = async (runtime: typeof a) => {
      const workspace = createCliWorkspaceComposition({
        cwd: userHome,
        productRuntime: runtime,
        projectAccess: access,
      });
      const source = workspace.contributionSources.find((entry) => entry.kind === 'host')!;
      return {
        settings: readUserSettingsOrExit(runtime),
        paths: createProductUserSettingsSources(runtime).map((entry) => entry.path),
        plugins: productPluginDirectories(userHome, runtime),
        contribution: source.readText(
          `${runtime.layout.projectDirectory}/skills/sample.txt`,
          'test',
        ),
        crossContribution: source.readText(
          `${(runtime === a ? b : a).layout.projectDirectory}/skills/sample.txt`,
          'test',
        ),
      };
    };
    const first = await read(a);
    const second = await read(b);
    expect(await read(a)).toEqual(first);
    const concurrent = await Promise.all([read(a), read(b)]);
    expect(concurrent).toEqual([first, second]);
    expect(first.settings.language).toBe('cedar');
    expect(second.settings.language).toBe('maple');
    expect(first.contribution).toBe('cedar');
    expect(second.contribution).toBe('maple');
    expect(first.crossContribution).toBeUndefined();
    expect(second.crossContribution).toBeUndefined();
    expect(first.plugins.user).not.toBe(second.plugins.user);
    expect(first.paths[0]).not.toBe(second.paths[0]);
    expect(first.paths[1]).toBe(second.paths[1]);
    expect(readFileSync(a.layout.userPaths.settings, 'utf8')).not.toBe(
      readFileSync(b.layout.userPaths.settings, 'utf8'),
    );
  });

  it('passes only allowed host configuration to workers and freezes captured values', () => {
    const runtime = createTestProductRuntime('cedar', {
      HOME: home(),
      PATH: '/synthetic/bin',
      XDG_RUNTIME_DIR: '/tmp/synthetic-runtime',
      PRODUCT_TELEMETRY_ENDPOINT: 'https://collector.example/synthetic-private',
      CEDAR_TELEMETRY_HEADERS: 'Bearer synthetic-private',
      ANTHROPIC_API_KEY: 'synthetic-provider-secret',
    });
    const child = childProductEnvironment(runtime);
    expect(child.PRODUCT_ID).toBe('cedar');
    expect(child.SECURITY_MASTER_KEY_DERIVATION_PATH).toBe('[123,0]');
    expect(child.PATH).toBe('/synthetic/bin');
    expect(child.XDG_RUNTIME_DIR).toBe('/tmp/synthetic-runtime');
    expect(JSON.stringify(child)).not.toMatch(
      /synthetic-private|synthetic-provider-secret|private-reference/,
    );
    expect(child.PRODUCT_CONFIG_FILE).toBeUndefined();
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.layout.pathProtection.protectedPaths)).toBe(true);
    expect(Reflect.set(runtime.environment, 'PRODUCT_ID', 'changed')).toBe(false);
    expect(resolveCliRuntimeContext({ productRuntime: runtime })).toBe(runtime);
  });

  it('normalizes only the selected product aliases without changing the input or retaining state', () => {
    const input = { CEDAR_MEMORY: '1', MAPLE_MEMORY: '0' };
    expect(normalizeProductEnvironment(input, 'CEDAR_').PRODUCT_MEMORY).toBe('1');
    expect(normalizeProductEnvironment(input, 'MAPLE_').PRODUCT_MEMORY).toBe('0');
    expect(normalizeProductEnvironment(input, 'CEDAR_').PRODUCT_MEMORY).toBe('1');
    expect(input).toEqual({ CEDAR_MEMORY: '1', MAPLE_MEMORY: '0' });
    expect(() =>
      normalizeProductEnvironment({ PRODUCT_MEMORY: '0', CEDAR_MEMORY: '1' }, 'CEDAR_'),
    ).toThrow('conflicting');
  });

  it('loads operational file values into the host snapshot with explicit environment precedence', async () => {
    const directory = home();
    const filePath = join(directory, 'selected.env');
    const file = {
      ...createTestProductEnvironment('cedar'),
      PRODUCT_USER_STATE_DIR: './state',
      PRODUCT_CACHE_DIR: './cache',
      PRODUCT_LOG_DIR: './logs',
      ANTHROPIC_API_KEY: 'synthetic-file-key',
      CEDAR_TELEMETRY_OTLP_ENDPOINT: 'https://file.example/telemetry',
      PRODUCT_WS_TOKEN: 'synthetic-file-token',
      PRODUCT_WS_PORT: '24811',
    };
    writeFileSync(
      filePath,
      Object.entries(file)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    );
    const runtime = resolveCliRuntimeContext({
      environment: {
        HOME: directory,
        PRODUCT_CONFIG_FILE: filePath,
        CEDAR_TELEMETRY_OTLP_ENDPOINT: 'https://environment.example/telemetry',
        PRODUCT_WS_PORT: undefined,
      },
    });
    expect(runtime.config.storage.userRoot).toBe(join(directory, 'state'));
    expect(runtime.environment.PRODUCT_USER_STATE_DIR).toBe(join(directory, 'state'));
    expect(runtime.environment.ANTHROPIC_API_KEY).toBe('synthetic-file-key');
    const definition = {
      type: 'synthetic-provider',
      defaults: { model: 'fixture-model', apiKey: '$ENV:ANTHROPIC_API_KEY' },
      createProvider: () => {
        throw new Error('provider must not be created by settings resolution');
      },
    };
    expect(readCliProviderSettings(runtime, [], [definition]).apiKey).toBe('synthetic-file-key');
    const profilePath = join(directory, 'provider-settings.json');
    writeFileSync(
      profilePath,
      JSON.stringify({
        currentProvider: 'selected',
        providers: {
          selected: {
            type: 'synthetic-provider',
            model: 'fixture-model',
            apiKey: '$ENV:ANTHROPIC_API_KEY',
          },
        },
      }),
    );
    expect(
      readCliProviderSettings(
        runtime,
        [createNodeHostSettingsSource('user', profilePath)],
        [definition],
      ).apiKey,
    ).toBe('synthetic-file-key');
    const restarted = restartProductEnvironment(
      runtime,
      [createNodeHostSettingsSource('user', profilePath)],
      [definition],
    );
    expect(restarted.PRODUCT_CONFIG_FILE).toBe(filePath);
    expect(restarted.ANTHROPIC_API_KEY).toBe('synthetic-file-key');
    expect(restarted.PRODUCT_WS_TOKEN).toBeUndefined();
    expect(restarted.PRODUCT_TELEMETRY_OTLP_ENDPOINT).toBeUndefined();
    const secondFilePath = join(directory, 'other-product.env');
    writeFileSync(
      secondFilePath,
      Object.entries({
        ...createTestProductEnvironment('maple'),
        ANTHROPIC_API_KEY: 'synthetic-other-key',
      })
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    );
    const second = resolveCliRuntimeContext({
      environment: { HOME: directory, PRODUCT_CONFIG_FILE: secondFilePath },
    });
    const readKey = (selected: typeof runtime) =>
      readCliProviderSettings(selected, [], [definition]).apiKey;
    expect([readKey(runtime), readKey(second), readKey(runtime)]).toEqual([
      'synthetic-file-key',
      'synthetic-other-key',
      'synthetic-file-key',
    ]);
    expect(
      await Promise.all([
        Promise.resolve().then(() => readKey(runtime)),
        Promise.resolve().then(() => readKey(second)),
      ]),
    ).toEqual(['synthetic-file-key', 'synthetic-other-key']);
    expect([
      restartProductEnvironment(runtime, [], [definition]).ANTHROPIC_API_KEY,
      restartProductEnvironment(second, [], [definition]).ANTHROPIC_API_KEY,
      restartProductEnvironment(runtime, [], [definition]).ANTHROPIC_API_KEY,
    ]).toEqual(['synthetic-file-key', 'synthetic-other-key', 'synthetic-file-key']);
    expect(runtime.environment.PRODUCT_TELEMETRY_OTLP_ENDPOINT).toBe(
      'https://environment.example/telemetry',
    );
    expect(runtime.environment.PRODUCT_WS_TOKEN).toBe('synthetic-file-token');
    expect(runtime.environment.PRODUCT_WS_PORT).toBe('24811');
    const child = childProductEnvironment(runtime);
    expect(child.ANTHROPIC_API_KEY).toBeUndefined();
    expect(child.PRODUCT_WS_TOKEN).toBeUndefined();
    expect(child.PRODUCT_TELEMETRY_OTLP_ENDPOINT).toBeUndefined();
    expect(child.PRODUCT_CONFIG_FILE).toBeUndefined();
    expect(() =>
      resolveCliRuntimeContext({
        environment: {
          HOME: directory,
          PRODUCT_CONFIG_FILE: filePath,
          PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'one',
          CEDAR_TELEMETRY_OTLP_ENDPOINT: 'two',
        },
      }),
    ).toThrow('conflicting');
    writeFileSync(
      filePath,
      `${Object.entries(file)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n')}\nPRODUCT_TELEMETRY_OTLP_ENDPOINT=https://conflict.example/telemetry\n`,
    );
    expect(() =>
      resolveCliRuntimeContext({
        environment: {
          HOME: directory,
          PRODUCT_CONFIG_FILE: filePath,
          PRODUCT_TELEMETRY_OTLP_ENDPOINT: 'https://environment.example/telemetry',
        },
      }),
    ).toThrow('conflicting');
  });

  it('projects only explicitly referenced environment-only provider keys into a full CLI restart', () => {
    const runtime = createTestProductRuntime('cedar', {
      HOME: home(),
      SYNTHETIC_PROVIDER_KEY: 'synthetic-env-only-key',
      SYNTHETIC_PROVIDER_ENDPOINT: 'https://cedar-provider.invalid',
      HTTPS_PROXY: 'https://cedar-proxy.invalid',
      UNRELATED_PRIVATE_TOKEN: 'must-stay-parent-only',
    });
    const definitions = [
      {
        type: 'synthetic-provider',
        defaults: { model: 'fixture-model', apiKey: '$ENV:SYNTHETIC_PROVIDER_KEY' },
        destinationEnvironment: ['SYNTHETIC_PROVIDER_ENDPOINT'],
        createProvider: () => {
          throw new Error('not used');
        },
      },
    ];
    const restarted = restartProductEnvironment(runtime, [], definitions);
    expect(restarted.SYNTHETIC_PROVIDER_KEY).toBe('synthetic-env-only-key');
    expect(restarted.SYNTHETIC_PROVIDER_ENDPOINT).toBe('https://cedar-provider.invalid');
    expect(restarted.HTTPS_PROXY).toBe('https://cedar-proxy.invalid');
    expect(restarted.UNRELATED_PRIVATE_TOKEN).toBeUndefined();
    expect(restarted.PRODUCT_CONFIG_FILE).toBeUndefined();
    const second = createTestProductRuntime('maple', {
      HOME: home(),
      SYNTHETIC_PROVIDER_KEY: 'synthetic-other-env-only-key',
      SYNTHETIC_PROVIDER_ENDPOINT: 'https://maple-provider.invalid',
      HTTPS_PROXY: 'https://maple-proxy.invalid',
      UNRELATED_PRIVATE_TOKEN: 'other-parent-only-token',
    });
    expect([
      restartProductEnvironment(runtime, [], definitions).SYNTHETIC_PROVIDER_KEY,
      restartProductEnvironment(second, [], definitions).SYNTHETIC_PROVIDER_KEY,
      restartProductEnvironment(runtime, [], definitions).SYNTHETIC_PROVIDER_KEY,
    ]).toEqual([
      'synthetic-env-only-key',
      'synthetic-other-env-only-key',
      'synthetic-env-only-key',
    ]);
    expect([
      restartProductEnvironment(runtime, [], definitions).SYNTHETIC_PROVIDER_ENDPOINT,
      restartProductEnvironment(second, [], definitions).SYNTHETIC_PROVIDER_ENDPOINT,
      restartProductEnvironment(runtime, [], definitions).SYNTHETIC_PROVIDER_ENDPOINT,
    ]).toEqual([
      'https://cedar-provider.invalid',
      'https://maple-provider.invalid',
      'https://cedar-provider.invalid',
    ]);
    expect(
      restartProductEnvironment(second, [], definitions).UNRELATED_PRIVATE_TOKEN,
    ).toBeUndefined();
  });

  it('protects configured state directories and admits only the selected deep-link scheme', () => {
    const a = createTestProductRuntime('cedar', { HOME: home() });
    const b = createTestProductRuntime('maple', { HOME: home() });
    expect(isSecretPath(join(a.layout.userRoot, 'keys.json'), a.layout.pathProtection)).toBe(true);
    expect(isSecretPath('/work/.cedar/ordinary.txt', a.layout.pathProtection)).toBe(true);
    expect(isSecretPath('/work/.cedar/ordinary.txt', b.layout.pathProtection)).toBe(false);
    expect(
      parseLaunchIntent('cedar://open?v=1&prompt=hi&cwd=%2Fwork', a.config.identity.protocolScheme)
        .ok,
    ).toBe(true);
    expect(
      parseLaunchIntent('cedar://open?v=1&prompt=hi&cwd=%2Fwork', b.config.identity.protocolScheme)
        .ok,
    ).toBe(false);
  });

  it('uses independent credential services with one mock keychain and never opens a real keychain', async () => {
    const userHome = home();
    const a = createTestProductRuntime('cedar', { HOME: userHome });
    const b = createTestProductRuntime('maple', { HOME: userHome });
    const { module, controls } = createFakeKeyring();
    const open = async (runtime: typeof a) =>
      selectCredentialStore({
        root: runtime.layout.userRoot,
        serviceNamespace: runtime.config.credentials.serviceNamespace,
        loadKeyring: () => module,
      });
    const [storeA, storeB] = await Promise.all([open(a), open(b)]);
    const keyA = { service: a.config.credentials.serviceNamespace, account: 'same-account' };
    const keyB = { service: b.config.credentials.serviceNamespace, account: 'same-account' };
    await storeA.store.set(keyA, 'synthetic-a');
    expect(await storeB.store.get(keyB)).toBeUndefined();
    await storeB.store.set(keyB, 'synthetic-b');
    expect(await (await open(a)).store.get(keyA)).toBe('synthetic-a');
    expect(await storeB.store.get(keyB)).toBe('synthetic-b');
    expect(controls.entries.size).toBe(2);
  });
});
