import { describe, expect, it } from 'vitest';
import { embeddedProductIdentity, resolveProductConfig } from '@robota-sdk/product-config';

import {
  desktopCliEnvironment,
  desktopDaemonEnvironment,
  desktopUserDataPath,
  loadDesktopProductConfig,
  loadDesktopProductConfigSelection,
} from '../product-config.js';
import { desktopProductEnvironment } from './product-environment.js';

describe('desktop product configuration', () => {
  it('uses embedded identity while allowing host operational settings', () => {
    const identity = embeddedProductIdentity(resolveProductConfig({ environment: desktopProductEnvironment('cedar') }));
    const config = loadDesktopProductConfig({
      environment: desktopProductEnvironment('cedar'),
      identityFile: '/app/dist/electron/product-identity.json',
      isPackaged: true,
      exists: () => true,
      readFile: () => JSON.stringify(identity),
    });

    expect(config.identity.displayName).toBe('cedar Agent');
    expect(config.identity.desktopExecutableName).toBe('cedar-runtime');
    expect(config.storage.userRoot).toBe('/tmp/cedar/user');
    expect(identity).not.toHaveProperty('secrets');
    expect(identity).not.toHaveProperty('storage.userRoot');
  });

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
    const identity = embeddedProductIdentity(resolveProductConfig({ environment: desktopProductEnvironment('cedar') }));
    expect(() => loadDesktopProductConfig({
      environment: { ...desktopProductEnvironment('cedar'), PRODUCT_DISPLAY_NAME: 'Different Product' },
      identityFile: '/app/dist/electron/product-identity.json',
      isPackaged: true,
      exists: () => true,
      readFile: () => JSON.stringify(identity),
    })).toThrow('conflicts with embedded artifact identity');
  });

  it('requires an embedded identity in packaged applications', () => {
    expect(() => loadDesktopProductConfig({
      environment: desktopProductEnvironment('cedar'),
      identityFile: '/app/dist/electron/product-identity.json',
      isPackaged: true,
      exists: () => false,
    })).toThrow('missing its embedded product identity');
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
      readFile: () => 'OPENAI_API_KEY=file-provider-key\nANTHROPIC_API_KEY=file-key-is-overridden\nFILE_ONLY_PROVIDER_KEY=file-only-provider-key\nUNRELATED_PRIVATE_TOKEN=file-private-sentinel\nPRODUCT_WS_TOKEN=file-ws-token\n',
    });
    const untrustedChild = desktopCliEnvironment(selection.config, environment);
    const child = desktopCliEnvironment(selection.config, environment, {
      providerEnvironmentReferences: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'FILE_ONLY_PROVIDER_KEY'],
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
    expect(desktopCliEnvironment(selection.config, environment, {
      providerEnvironmentReferences: [],
    })).not.toHaveProperty('ANTHROPIC_API_KEY');
    const admittedRefs = desktopCliEnvironment(selection.config, environment, {
      providerEnvironmentReferences: ['CUSTOM_PROVIDER_KEY', 'HTTPS_PROXY', 'ANTHROPIC_API_KEY', 'INVALID=NAME'],
    });
    expect(admittedRefs.CUSTOM_PROVIDER_KEY).toBe('custom-provider-secret');
    expect(admittedRefs.HTTPS_PROXY).toBe('https://proxy.example.test');
    const scriptedChild = desktopCliEnvironment(selection.config, environment, {
      allowScriptedE2eVariables: true,
    });
    expect(scriptedChild.PRODUCT_E2E_TRUST_FILE).toBe('/tmp/e2e/trust');
    expect(scriptedChild).not.toHaveProperty('PRODUCT_E2E_UNRELATED');
    expect(admittedRefs.ANTHROPIC_API_KEY).toBe('explicit-provider-key');
    expect(desktopDaemonEnvironment(selection.config, environment, {
      restricted: true,
      providerEnvironmentReferences: ['ANTHROPIC_API_KEY', 'CUSTOM_PROVIDER_KEY', 'HTTPS_PROXY'],
    })).not.toHaveProperty('CUSTOM_PROVIDER_KEY');
  });
});
