import { describe, expect, it } from 'vitest';
import { embeddedProductRuntimeDefaults, resolveProductConfig } from './index.js';
import { expandProductRuntimeDefaults } from './node.js';
import { productEnvironment } from './__tests__/product-environment.js';

describe('non-secret artifact runtime defaults', () => {
  it.each(['cedar', 'amber'])('expands only declared %s home-relative roots', (name) => {
    const config = resolveProductConfig({
      environment: {
        ...productEnvironment(name),
        PRODUCT_DEFAULT_USER_STATE_DIR: `.${name}`,
        PRODUCT_DEFAULT_CACHE_DIR: `.${name}/cache`,
        PRODUCT_DEFAULT_LOG_DIR: `.${name}/logs`,
        PRODUCT_DEFAULT_PROJECT_STATE_DIR: `.${name}`,
        PRODUCT_SHARED_USER_SETTINGS: '[]',
        PRODUCT_SHARED_PROJECT_SETTINGS: '[]',
      },
    });
    const artifact = embeddedProductRuntimeDefaults(config);
    expect(JSON.stringify(artifact)).not.toContain('/tmp/');
    const defaults = expandProductRuntimeDefaults(artifact, '/home/fixture');
    expect(defaults.PRODUCT_USER_STATE_DIR).toBe(`/home/fixture/.${name}`);
    expect(defaults.PRODUCT_CACHE_DIR).toBe(`/home/fixture/.${name}/cache`);
    expect(defaults.PRODUCT_LOG_DIR).toBe(`/home/fixture/.${name}/logs`);
    expect(defaults.PRODUCT_PROJECT_STATE_DIR).toBe(`.${name}`);
    expect(defaults.PRODUCT_SHARED_USER_SETTINGS).toBe('[]');
  });

  it('rejects absolute paths, traversal and unrelated keys in embedded defaults', () => {
    for (const value of [
      '/tmp/root',
      '../root',
      'x/../root',
      '~/.root',
      '$HOME/root',
      'C:\\root',
    ]) {
      expect(() =>
        resolveProductConfig({
          environment: { ...productEnvironment(), PRODUCT_DEFAULT_USER_STATE_DIR: value },
        }),
      ).toThrow('PRODUCT_DEFAULT_USER_STATE_DIR');
    }
    expect(() =>
      expandProductRuntimeDefaults({ PRODUCT_WS_TOKEN: 'synthetic-token' }, '/home/fixture'),
    ).toThrow();
  });
});

it.each(['PRODUCT_SHARED_USER_SETTINGS', 'PRODUCT_SHARED_PROJECT_SETTINGS'])(
  'rejects an empty %s rather than losing the disabled selection at a process boundary',
  (variable) => {
    expect(() => resolveProductConfig({
      environment: { ...productEnvironment('cedar'), [variable]: '' },
    })).toThrow(variable);
  },
);
