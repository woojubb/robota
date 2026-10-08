import { describe, expect, it } from 'vitest';

import {
  ProductConfigError,
  embeddedProductIdentity,
  generateDefaultEnvironment,
  hostProductConfig,
  parsePublicProductConfig,
  publicProductConfig,
  resolveProductConfig,
} from './index.js';
import { productEnvironment } from './__tests__/product-environment.js';

describe('explicit product configuration', () => {
  it('validates build-only package command and artifact version independently of identity', () => {
    const defaults = productEnvironment();
    const selected = resolveProductConfig({ environment: {
      ...defaults,
      PRODUCT_CLI_PACKAGE_BIN: 'none',
      PRODUCT_VERSION: '4.2.1-beta.3',
      PRODUCT_BUILD_METADATA: 'fixture-build',
    } });
    expect(selected.build.cliPackageBin).toBe('none');
    expect(selected.release.productVersion).toBe('4.2.1-beta.3');
    expect(selected.release.buildMetadata).toBe('fixture-build');
    expect(embeddedProductIdentity(selected)).toEqual(embeddedProductIdentity(resolveProductConfig({ environment: defaults })));
    expect(() => resolveProductConfig({ environment: { ...defaults, PRODUCT_VERSION: 'invalid' } })).toThrow('PRODUCT_VERSION');
    for (const invalid of ['01.2.3', '1.2.3-.', '1.2.3-beta..1', '1.2.3-01', '1.2.3+build..1']) {
      expect(() => resolveProductConfig({ environment: { ...defaults, PRODUCT_VERSION: invalid } })).toThrow('PRODUCT_VERSION');
    }
    expect(resolveProductConfig({ environment: { ...defaults, PRODUCT_VERSION: '1.2.3-beta.1+build.01' } }).release.productVersion).toBe('1.2.3-beta.1+build.01');
    expect(() => resolveProductConfig({ environment: { ...defaults, PRODUCT_CLI_PACKAGE_BIN: '../other' } })).toThrow('PRODUCT_CLI_PACKAGE_BIN');
  });
  it('keeps A/B/A and concurrent calls independent without mutating input', async () => {
    const a = productEnvironment();
    const b = productEnvironment('maple');
    const before = { ...a };
    const first = resolveProductConfig({ environment: a });
    const second = resolveProductConfig({ environment: b });
    const again = resolveProductConfig({ environment: a });
    const concurrent = await Promise.all([a, b].map(async (environment) => resolveProductConfig({ environment })));
    expect(first).toEqual(again);
    expect(second.identity.id).toBe('maple');
    expect(concurrent.map((config) => config.identity.id)).toEqual(['cedar', 'maple']);
    expect(first.storage.userRoot).not.toBe(second.storage.userRoot);
    expect(first).not.toBe(again);
    expect(a).toEqual(before);
    expect(() => resolveProductConfig({ environment: {} })).toThrow(ProductConfigError);
  });

  it('applies explicit environment over selected file over defaults and preserves explicit empty', () => {
    const defaults = productEnvironment();
    const config = resolveProductConfig({
      defaults,
      fileValues: { PRODUCT_DISPLAY_NAME: 'File Agent', SERVICE_SIGNALING_URL: 'https://relay.example' },
      environment: { PRODUCT_DISPLAY_NAME: 'Run Agent', SERVICE_SIGNALING_URL: '' },
    });
    expect(config.identity.displayName).toBe('Run Agent');
    expect(config.services.signalingUrl).toBeUndefined();
    expect(() => resolveProductConfig({ defaults, environment: { PRODUCT_ID: '' } })).toThrow('PRODUCT_ID');
    expect(() => resolveProductConfig({ defaults, environment: { PRODUCT_ID: '  ' } })).toThrow('PRODUCT_ID');
  });

  it('keeps analytics absent unless selected and projects only the selected measurement account', () => {
    const defaults = productEnvironment();
    expect(publicProductConfig(resolveProductConfig({ environment: defaults })).services.analyticsMeasurementId).toBeUndefined();
    const selected = resolveProductConfig({ defaults, environment: { SERVICE_ANALYTICS_MEASUREMENT_ID: 'G-CEDARTEST' } });
    expect(publicProductConfig(selected).services.analyticsMeasurementId).toBe('G-CEDARTEST');
    expect(resolveProductConfig({ defaults, fileValues: { SERVICE_ANALYTICS_MEASUREMENT_ID: 'G-CEDARTEST' }, environment: { SERVICE_ANALYTICS_MEASUREMENT_ID: '' } }).services.analyticsMeasurementId).toBeUndefined();
    expect(() => resolveProductConfig({ defaults, environment: { SERVICE_ANALYTICS_MEASUREMENT_ID: 'G-";alert(1)' } })).toThrow('SERVICE_ANALYTICS_MEASUREMENT_ID');
  });

  it('normalizes public aliases and rejects conflicting canonical values without aliasing bootstrap', () => {
    const env = productEnvironment();
    delete env['PRODUCT_DISPLAY_NAME'];
    env['CEDAR_DISPLAY_NAME'] = 'Alias Agent';
    expect(resolveProductConfig({ environment: env }).identity.displayName).toBe('Alias Agent');
    expect(() => resolveProductConfig({ environment: { ...env, PRODUCT_DISPLAY_NAME: 'Other' } })).toThrow('CEDAR_DISPLAY_NAME');
    expect(resolveProductConfig({ environment: { ...env, PRODUCT_DISPLAY_NAME: 'Alias Agent' } }).identity.displayName).toBe('Alias Agent');
    expect(() => resolveProductConfig({ environment: { ...env, PRODUCT_ENV_PREFIX: undefined, CEDAR_ENV_PREFIX: 'CEDAR_' } })).toThrow('PRODUCT_ENV_PREFIX');
    expect(resolveProductConfig({ defaults: productEnvironment(), fileValues: { PRODUCT_DISPLAY_NAME: 'File' }, environment: { CEDAR_DISPLAY_NAME: 'Run' } }).identity.displayName).toBe('Run');
  });

  it('freezes nested values and validates namespace, URL, scope, relative project path and hardened indices', () => {
    const config = resolveProductConfig({ environment: productEnvironment() });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.storage)).toBe(true);
    expect(Object.isFrozen(config.crypto.masterKeyDerivationPath)).toBe(true);
    expect(Reflect.set(config.identity, 'id', 'changed')).toBe(false);
    for (const [key, value] of [
      ['PRODUCT_PACKAGE_SCOPE', 'plain-scope'],
      ['PRODUCT_ENV_PREFIX', 'bad-prefix'],
      ['PRODUCT_PROJECT_STATE_DIR', '../escape'],
      ['PRODUCT_PROJECT_STATE_DIR', '/absolute'],
      ['PRODUCT_PROJECT_STATE_DIR', '.state/nested'],
      ['PROJECT_REPOSITORY_URL', 'https://user:password@example.com'],
      ['PROJECT_HOMEPAGE_URL', 'javascript:alert(1)'],
      ['PRODUCT_CRYPTO_NAMESPACE', 'space namespace'],
      ['SECURITY_MASTER_KEY_DERIVATION_PATH', '[]'],
      ['SECURITY_MASTER_KEY_DERIVATION_PATH', '[2147483648]'],
      ['SECURITY_MASTER_KEY_DERIVATION_PATH', '[-1]'],
      ['SECURITY_MASTER_KEY_DERIVATION_PATH', '[1.5]'],
      ['SECURITY_MASTER_KEY_DERIVATION_PATH', '["1"]'],
      ['PROJECT_RELEASE_TAG_PREFIX', 'v/*'],
      ['PROJECT_RELEASE_TAG_PREFIX', 'v$(echo unsafe)'],
    ]) {
      expect(() => resolveProductConfig({ environment: { ...productEnvironment(), [key!]: value! } })).toThrow(key);
    }
  });

  it('ignores every foreign canonical family while preserving this product aliases', () => {
    const defaults = productEnvironment('cedar');
    const embeddedIdentity = embeddedProductIdentity(
      resolveProductConfig({ environment: defaults }),
    );
    const foreign = productEnvironment('amber');
    const resolved = resolveProductConfig({
      environment: {
        ...foreign,
        CEDAR_USER_STATE_DIR: '/tmp/cedar/alias',
        SERVICE_SIGNALING_URL: 'https://foreign.example',
      },
      defaults,
      embeddedIdentity,
    });
    expect(resolved.storage.userRoot).toBe('/tmp/cedar/alias');
    expect(resolved.identity.id).toBe('cedar');
    expect(resolved.services.signalingUrl).toBeUndefined();
  });

  it('uses embedded artifact identity and refuses changed identity but permits operational overrides', () => {
    const built = resolveProductConfig({ environment: productEnvironment() });
    const embeddedIdentity = embeddedProductIdentity(built);
    const environment = { ...productEnvironment(), PRODUCT_USER_STATE_DIR: '/tmp/relocated' };
    const installed = resolveProductConfig({ environment, embeddedIdentity });
    expect(installed.storage.userRoot).toBe('/tmp/relocated');
    expect(() => resolveProductConfig({ environment: {}, fileValues: { ...environment, PRODUCT_ID: 'amber' }, embeddedIdentity })).toThrow('PRODUCT_ID');
    expect(() => resolveProductConfig({ environment: { ...environment, SECURITY_MASTER_KEY_DERIVATION_PATH: '[124,0]' }, embeddedIdentity })).toThrow('SECURITY_MASTER_KEY_DERIVATION_PATH');
    expect(resolveProductConfig({ environment: {
      PRODUCT_ID: 'cedar', PRODUCT_USER_STATE_DIR: '/tmp/user', PRODUCT_PROJECT_STATE_DIR: '.state', PRODUCT_CACHE_DIR: '/tmp/cache', PRODUCT_LOG_DIR: '/tmp/logs',
    }, embeddedIdentity }).identity.id).toBe('cedar');
  });

  it('projects only allowed values and never reports private values in errors or default guidance', () => {
    const marker = 'synthetic-private-sentinel';
    const config = resolveProductConfig({ environment: {
      ...productEnvironment(),
      ANTHROPIC_API_KEY: marker,
      PRODUCT_TELEMETRY_OTLP_HEADERS: `Authorization=Bearer ${marker}`,
      PROJECT_REPOSITORY_URL: 'https://source.example/project',
      SERVICE_SIGNALING_URL: 'wss://relay.example',
    } });
    expect('secrets' in config).toBe(false);
    const publicView = publicProductConfig(config);
    const hostView = hostProductConfig(config);
    expect(JSON.stringify(publicView)).not.toContain(marker);
    expect(JSON.stringify(hostView)).not.toContain(marker);
    expect(JSON.stringify(embeddedProductIdentity(config))).not.toContain(marker);
    expect(publicView.identity.displayName).toBe(config.identity.displayName);
    expect('userRoot' in publicView.storage).toBe(false);
    expect(publicView.crypto.namespace).toBe(config.crypto.namespace);
    expect('masterKeyDerivationPath' in publicView.crypto).toBe(false);
    expect('secrets' in hostView).toBe(false);
    const defaults = generateDefaultEnvironment();
    expect(defaults).toContain('PRODUCT_ID=\n');
    expect(defaults).not.toContain('SECURITY_SIGNING_KEY_FILE=\n');
    expect(defaults).toContain('identity');
    expect(defaults).not.toContain(marker);
    expect(defaults).not.toContain('cedar');
    expect(() => resolveProductConfig({ environment: { ...productEnvironment(), PRODUCT_ID: `invalid\n${marker}` } })).toThrow('PRODUCT_ID');
    try {
      resolveProductConfig({ environment: { ...productEnvironment(), PRODUCT_ID: `invalid\n${marker}` } });
    } catch (error) {
      expect(String(error)).not.toContain(marker);
    }
  });

  it('validates a generated public projection without admitting extra host fields', () => {
    const config = resolveProductConfig({ environment: productEnvironment() });
    const expected = publicProductConfig(config);
    const parsed = parsePublicProductConfig(JSON.parse(JSON.stringify(expected)));
    expect(parsed).toEqual(expected);
    expect(Object.isFrozen(parsed.identity)).toBe(true);
    expect(() => parsePublicProductConfig({ ...expected, storage: { ...expected.storage, userRoot: '/private/host/path' } })).toThrow('PRODUCT_PUBLIC_CONFIG');
    expect(() => parsePublicProductConfig({ ...expected, identity: { ...expected.identity, cliName: '' } })).toThrow('PRODUCT_CLI_NAME');
    expect(() => parsePublicProductConfig({ ...expected, identity: { ...expected.identity, websiteUrl: 'https://user:private@example.test' } })).toThrow('PROJECT_HOMEPAGE_URL');
  });
});
