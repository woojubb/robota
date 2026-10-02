import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDagStoragePaths } from '../storage-paths.js';

describe('resolveDagStoragePaths', () => {
  it('places storage and assets under the user state root supplied by the host', () => {
    expect(resolveDagStoragePaths({ userStateRoot: '/selected/state' })).toEqual({
      storageRoot: path.join('/selected/state', 'dag', 'storage'),
      assetRoot: path.join('/selected/state', 'dag', 'assets'),
    });
  });

  it('uses explicit host overrides without reading or mutating process environment', () => {
    const environment = Object.freeze({
      DAG_STORAGE_ROOT: '/custom/storage',
      ASSET_STORAGE_ROOT: '/custom/assets',
    });
    const before = { ...environment };
    expect(resolveDagStoragePaths({ userStateRoot: '/selected/state', environment })).toEqual({
      storageRoot: path.resolve('/custom/storage'),
      assetRoot: path.resolve('/custom/assets'),
    });
    expect(environment).toEqual(before);
  });

  it('requires the selected product state root instead of inventing a default', () => {
    expect(() => resolveDagStoragePaths({ userStateRoot: ' ' })).toThrow(
      'A configured product user state root is required for DAG storage.',
    );
  });
});
