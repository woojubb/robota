import { createTestProductRuntime } from '../__tests__/helpers/product-runtime.js';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProductUserSettingsSources } from './user-settings.js';

describe('test-product Agent user settings layers', () => {
  it('keeps the existing test-product Agent then Claude precedence under the supplied home', () => {
    expect(createProductUserSettingsSources(createTestProductRuntime('test-product', { HOME: '/test-home' })).map((source) => source.path)).toEqual([
      join('/test-home', '.test-product', 'settings.json'),
      join('/test-home', '.claude', 'settings.json'),
    ]);
  });
});
