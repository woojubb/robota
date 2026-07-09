import { describe, expect, it } from 'vitest';
import * as dagFramework from '../index.js';
import {
  DAG_FRAMEWORK_PACKAGE_NAME,
  createDagFramework,
  DagPromptBackend,
  LocalFsAssetStore,
} from '../index.js';

describe('package public surface (index.ts re-exports)', () => {
  it('exports DAG_FRAMEWORK_PACKAGE_NAME constant', () => {
    expect(DAG_FRAMEWORK_PACKAGE_NAME).toBe('@robota-sdk/dag-framework');
  });

  it('does NOT re-export the default node catalog (moved to @robota-sdk/dag-nodes-default, ARCH-PROVIDER-004)', () => {
    // A pass-through re-export would re-create the concrete-node coupling this stage removes.
    expect('createDefaultNodeRegistrySync' in dagFramework).toBe(false);
    expect('createDefaultNodeRegistry' in dagFramework).toBe(false);
  });

  it('exports createDagFramework', () => {
    expect(typeof createDagFramework).toBe('function');
  });

  it('exports DagPromptBackend class', () => {
    expect(typeof DagPromptBackend).toBe('function');
  });

  it('exports LocalFsAssetStore class', () => {
    expect(typeof LocalFsAssetStore).toBe('function');
  });
});
