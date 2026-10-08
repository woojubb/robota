import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { embeddedProductIdentity, resolveProductConfig } from '@robota-sdk/product-config';
import { robotaEnvironment } from '../robota.js';

import {
  desktopCliEnvironment,
  desktopHostEnvironment,
  desktopDaemonEnvironment,
  desktopUserDataPath,
  loadDesktopProductConfig,
  loadDesktopProductConfigSelection,
} from '../product-config.js';
import { desktopProductEnvironment } from './product-environment.js';

const temporary: string[] = [];
afterEach(() => temporary.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));
function home(): string {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-product-config-'));
  temporary.push(directory);
  return directory;
}

describe('desktop product configuration', () => {
  it('scopes remote and sidecar inputs before desktop mode selection', () => {
    const config = resolveProductConfig({ environment: desktopProductEnvironment('cedar') });
    const environment = desktopHostEnvironment(config, {
      PRODUCT_ID: 'amber',
      PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG: '/foreign/remote.json',
      PRODUCT_GUI_SIDECAR_CMD: '/foreign/sidecar',
      PRODUCT_SHELL: '/foreign/shell',
      CEDAR_GUI_SIDECAR_CMD: '/cedar/sidecar',
      PATH: '/system/bin',
    });
    expect(environment.PRODUCT_DESKTOP_REMOTE_CONNECTION_CONFIG).toBeUndefined();
    expect(environment.PRODUCT_GUI_SIDECAR_CMD).toBe('/cedar/sidecar');
    expect(environment.PRODUCT_SHELL).toBeUndefined();
    expect(environment.PATH).toBe('/system/bin');
    expect(desktopHostEnvironment(config, {
      PRODUCT_ID: 'cedar', PRODUCT_GUI_SIDECAR_CMD: '/cedar/explicit',
    }).PRODUCT_GUI_SIDECAR_CMD).toBe('/cedar/explicit');
  });

  it('uses invocation-home defaults for packaged Robota without embedding build storage', () => {
    const buildHome = home();
    const identity = embeddedProductIdentity(resolveProductConfig({ environment: robotaEnvironment({}, buildHome) }));
    expect(JSON.stringify(identity)).not.toContain(buildHome);
    for (const userHome of [home(), home()]) {
      const config = loadDesktopProductConfig({
        environment: { HOME: userHome },
        identityFile: '/app/product-identity.json',
        isPackaged: true,
        exists: (path: string) => path.endsWith('product-identity.json'),
        readFile: () => JSON.stringify(identity),
      });
      expect(config.storage.userRoot).toBe(join(userHome, '.robota'));
      expect(config.storage.cacheRoot).toBe(join(userHome, '.robota', 'cache'));
      expect(config.storage.logRoot).toBe(join(userHome, '.robota', 'logs'));
      expect(desktopUserDataPath(config)).toBe(join(userHome, '.robota', 'desktop'));
      expect(embeddedProductIdentity(config)).toEqual(identity);
    }
  });

  it('preserves packaged Robota overrides, explicit selection, empty and conflicting inputs', () => {
    const userHome = home();
    const identity = embeddedProductIdentity(resolveProductConfig({ environment: robotaEnvironment({}, userHome) }));
    const load = (environment: Record<string, string | undefined>) => loadDesktopProductConfig({
      environment: { HOME: userHome, PRODUCT_ID: 'robota', ...environment },
      identityFile: '/app/product-identity.json',
      isPackaged: true,
      exists: (path: string) => path.endsWith('product-identity.json'),
      readFile: () => JSON.stringify(identity),
    });
    const root = join(userHome, 'selected-state');
    expect(load({ ROBOTA_USER_STATE_DIR: root }).storage.cacheRoot).toBe(join(root, 'cache'));
    for (const environment of [
      { PRODUCT_USER_STATE_DIR: '' },
      { ROBOTA_LOG_DIR: '' },
      { PRODUCT_LOG_DIR: root, ROBOTA_LOG_DIR: join(root, 'other') },
      { ROBOTA_CREDENTIAL_SERVICE: 'other' },
      { ROBOTA_MASTER_KEY_DERIVATION_PATH: '[7240,1]' },
    ]) expect(() => load(environment)).toThrow();
    const filePath = join(userHome, 'selected.env');
    const file = Object.entries({
      ...robotaEnvironment({}, userHome),
      PRODUCT_USER_STATE_DIR: './file-state',
    }).map(([key, value]) => `${key}=${value}`)
      .join('\n');
    const selected = loadDesktopProductConfig({
      environment: { HOME: home(), PRODUCT_ID: 'robota', PRODUCT_CONFIG_FILE: filePath },
      identityFile: '/app/product-identity.json',
      isPackaged: true,
      exists: (path: string) => path.endsWith('product-identity.json'),
      readFile: (path) => (path === filePath ? file : JSON.stringify(identity)),
    });
    expect(selected.storage.userRoot).toBe(join(userHome, 'file-state'));
  });

  it('requires host settings for a same-ID desktop artifact with another complete profile', () => {
    const environment = {
      ...robotaEnvironment({}, home()),
      PRODUCT_CREDENTIAL_SERVICE: 'other',
      SECURITY_MASTER_KEY_DERIVATION_PATH: '[173,0]',
    };
    const identity = embeddedProductIdentity(resolveProductConfig({ environment }));
    const options = {
      identityFile: '/app/product-identity.json',
      isPackaged: true,
      exists: (path: string) => path.endsWith('product-identity.json'),
      readFile: () => JSON.stringify(identity),
    };
    expect(() => loadDesktopProductConfig({ ...options, environment: { HOME: home() } })).toThrow(
      'PRODUCT_USER_STATE_DIR',
    );
    expect(loadDesktopProductConfig({ ...options, environment }).credentials.serviceNamespace).toBe(
      'other',
    );
  });

  it('uses embedded identity while allowing host operational settings', () => {
    const identity = embeddedProductIdentity(
      resolveProductConfig({ environment: desktopProductEnvironment('cedar') }),
    );
    const config = loadDesktopProductConfig({
      environment: desktopProductEnvironment('cedar'),
      identityFile: '/app/dist/electron/product-identity.json',
      isPackaged: true,
      exists: (path: string) => path.endsWith('product-identity.json'),
      readFile: () => JSON.stringify(identity),
    });

    expect(config.identity.displayName).toBe('cedar Agent');
    expect(config.identity.desktopExecutableName).toBe('cedar-runtime');
    expect(config.storage.userRoot).toBe('/tmp/cedar/user');
    expect(identity).not.toHaveProperty('secrets');
    expect(identity).not.toHaveProperty('storage.userRoot');
  });

  it.each(['cedar', 'amber'])(
    'uses declared defaults for a packaged %s app without ambient operational inputs',
    (label) => {
      const identity = embeddedProductIdentity(
        resolveProductConfig({ environment: desktopProductEnvironment(label) }),
      );
      const userHome = home();
      const defaults = {
        PRODUCT_USER_STATE_DIR: `.${label}`,
        PRODUCT_CACHE_DIR: `.${label}/cache`,
        PRODUCT_LOG_DIR: `.${label}/logs`,
        PRODUCT_PROJECT_STATE_DIR: `.${label}`,
      };
      const config = loadDesktopProductConfig({
        environment: {
          HOME: userHome,
          PRODUCT_ID: 'foreign',
          PRODUCT_USER_STATE_DIR: '/tmp/foreign',
          PRODUCT_CONFIG_FILE: '/absent/foreign.env',
        },
        identityFile: '/app/product-identity.json',
        isPackaged: true,
        exists: () => true,
        readFile: (path) =>
          JSON.stringify(path.endsWith('product-runtime-defaults.json') ? defaults : identity),
      });
      expect(config.storage.userRoot).toBe(join(userHome, `.${label}`));
      expect(
        desktopCliEnvironment(config, {
          PRODUCT_ID: 'foreign',
          PRODUCT_CONFIG_FILE: '/absent/foreign.env',
        }).PRODUCT_CONFIG_FILE,
      ).toBeUndefined();
    },
  );

  it('keeps Electron profile storage under the selected user state root, independently of display name', () => {
    const environment = desktopProductEnvironment('cedar');
    const config = loadDesktopProductConfig({
      environment,
      identityFile: '/app/dist/electron/product-identity.json',
      isPackaged: false,
      exists: () => false,
    });
    const renamedConfig = loadDesktopProductConfig({
      environment: { ...environment, PRODUCT_DISPLAY_NAME: 'A Different Display Name' },
      identityFile: '/app/dist/electron/product-identity.json',
      isPackaged: false,
      exists: () => false,
    });

    expect(desktopUserDataPath(config)).toBe('/tmp/cedar/user/desktop');
    expect(desktopUserDataPath(renamedConfig)).toBe(desktopUserDataPath(config));
  });

  it('rejects a runtime environment that attempts to change packaged identity', () => {
    const identity = embeddedProductIdentity(
      resolveProductConfig({ environment: desktopProductEnvironment('cedar') }),
    );
    expect(() =>
      loadDesktopProductConfig({
        environment: {
          ...desktopProductEnvironment('cedar'),
          PRODUCT_DISPLAY_NAME: 'Different Product',
        },
        identityFile: '/app/dist/electron/product-identity.json',
        isPackaged: true,
        exists: (path: string) => path.endsWith('product-identity.json'),
        readFile: () => JSON.stringify(identity),
      }),
    ).toThrow('conflicts with embedded artifact identity');
  });

  it('requires an embedded identity in packaged applications', () => {
    expect(() =>
      loadDesktopProductConfig({
        environment: desktopProductEnvironment('cedar'),
        identityFile: '/app/dist/electron/product-identity.json',
        isPackaged: true,
        exists: () => false,
      }),
    ).toThrow('missing its embedded product identity');
  });

  it('allows source development only through explicit product environment values', () => {
    const config = loadDesktopProductConfig({
      environment: desktopProductEnvironment('maple'),
      identityFile: '/repo/apps/agent-app/dist/electron/product-identity.json',
      isPackaged: false,
      exists: () => false,
    });
    expect(config.identity.displayName).toBe('maple Agent');
  });

  it('curates CLI child environment from selected product settings and named provider credentials', () => {
    const environment = {
      ...desktopProductEnvironment('cedar'),
      PRODUCT_CONFIG_FILE: '/tmp/product.env',
      PATH: '/system/bin',
      HOME: '/tmp/home',
      ANTHROPIC_API_KEY: 'explicit-provider-key',
      CUSTOM_PROVIDER_KEY: 'custom-provider-secret',
      HTTPS_PROXY: 'https://proxy.example.test',
      FILE_ONLY_PROVIDER_KEY: undefined,
      PRODUCT_E2E_TRUST_FILE: '/tmp/e2e/trust',
      PRODUCT_E2E_UNRELATED: 'must-not-cross',
      AMBIENT_PRIVATE_SENTINEL: 'must-not-cross',
    };
    const selection = loadDesktopProductConfigSelection({
      environment,
      identityFile: '/repo/identity.json',
      isPackaged: false,
      exists: () => false,
      readFile: () =>
        'OPENAI_API_KEY=file-provider-key\nANTHROPIC_API_KEY=file-key-is-overridden\nFILE_ONLY_PROVIDER_KEY=file-only-provider-key\nUNRELATED_PRIVATE_TOKEN=file-private-sentinel\nPRODUCT_WS_TOKEN=file-ws-token\n',
    });
    const untrustedChild = desktopCliEnvironment(selection.config, environment);
    const child = desktopCliEnvironment(selection.config, environment, {
      providerEnvironmentReferences: [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'FILE_ONLY_PROVIDER_KEY',
      ],
    });

    expect(child).toMatchObject({
      PATH: '/system/bin',
      HOME: '/tmp/home',
      PRODUCT_CONFIG_FILE: '/tmp/product.env',
      PRODUCT_USER_STATE_DIR: '/tmp/cedar/user',
      ANTHROPIC_API_KEY: 'explicit-provider-key',
    });
    expect(child).not.toHaveProperty('AMBIENT_PRIVATE_SENTINEL');
    expect(child).not.toHaveProperty('UNRELATED_PRIVATE_TOKEN');
    expect(child).not.toHaveProperty('PRODUCT_WS_TOKEN');
    expect(untrustedChild).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(untrustedChild).not.toHaveProperty('CUSTOM_PROVIDER_KEY');
    expect(untrustedChild).not.toHaveProperty('HTTPS_PROXY');
    expect(untrustedChild).not.toHaveProperty('PRODUCT_E2E_TRUST_FILE');
    expect(child).not.toHaveProperty('OPENAI_API_KEY');
    expect(child).not.toHaveProperty('FILE_ONLY_PROVIDER_KEY');
    expect(
      desktopCliEnvironment(selection.config, environment, {
        providerEnvironmentReferences: [],
      }),
    ).not.toHaveProperty('ANTHROPIC_API_KEY');
    const admittedRefs = desktopCliEnvironment(selection.config, environment, {
      providerEnvironmentReferences: [
        'CUSTOM_PROVIDER_KEY',
        'HTTPS_PROXY',
        'ANTHROPIC_API_KEY',
        'INVALID=NAME',
      ],
    });
    expect(admittedRefs.CUSTOM_PROVIDER_KEY).toBe('custom-provider-secret');
    expect(admittedRefs.HTTPS_PROXY).toBe('https://proxy.example.test');
    const scriptedChild = desktopCliEnvironment(selection.config, environment, {
      allowScriptedE2eVariables: true,
    });
    expect(scriptedChild.PRODUCT_E2E_TRUST_FILE).toBe('/tmp/e2e/trust');
    expect(scriptedChild).not.toHaveProperty('PRODUCT_E2E_UNRELATED');
    expect(admittedRefs.ANTHROPIC_API_KEY).toBe('explicit-provider-key');
    expect(
      desktopDaemonEnvironment(selection.config, environment, {
        restricted: true,
        providerEnvironmentReferences: ['ANTHROPIC_API_KEY', 'CUSTOM_PROVIDER_KEY', 'HTTPS_PROXY'],
      }),
    ).not.toHaveProperty('CUSTOM_PROVIDER_KEY');
  });
});
