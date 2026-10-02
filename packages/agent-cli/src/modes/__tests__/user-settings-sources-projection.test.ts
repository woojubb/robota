import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { describe, expect, it } from 'vitest';

import { createProductUserSettingsSources } from '../../product/user-settings.js';
import { productPermissionBaseline } from '../../product/permission-baseline.js';
import { buildServeSessionOptions } from '../serve-mode.js';
const PRODUCT_PERMISSION_BASELINE = productPermissionBaseline(createTestProductRuntime());


describe('served session user settings sources', () => {
  it('forwards the CLI-selected sources into the runtime session', () => {
    const sources = createProductUserSettingsSources(createTestProductRuntime('test-product', { HOME: '/test-home' }));
    const options = buildServeSessionOptions({productRuntime: createTestProductRuntime(),
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      userSettingsSources: sources,
    } as never);

    expect(options.userSettingsSources).toBe(sources);
    if (!('baselinePermissionAllow' in options)) {
      throw new Error('Served session must keep the CLI permission baseline.');
    }
    expect(options.baselinePermissionAllow).toEqual(PRODUCT_PERMISSION_BASELINE);
  });

  it('keeps safe mode in the runtime session (issue #3082)', () => {
    const options = buildServeSessionOptions({productRuntime: createTestProductRuntime(),
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      bare: true,
      skipConfiguredHooks: true,
    } as never);
    expect('bare' in options && options.bare).toBe(true);
    expect('skipConfiguredHooks' in options && options.skipConfiguredHooks).toBe(true);
  });
});
