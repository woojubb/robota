import { describe, expect, it } from 'vitest';
import {
  DAG_FRAMEWORK_PACKAGE_NAME,
  createDefaultNodeRegistrySync,
  createDagFramework,
  DagPromptBackend,
  LocalFsAssetStore,
} from '../index.js';

describe('package public surface (index.ts re-exports)', () => {
  it('exports DAG_FRAMEWORK_PACKAGE_NAME constant', () => {
    expect(DAG_FRAMEWORK_PACKAGE_NAME).toBe('@robota-sdk/dag-framework');
  });

  it('exports createDefaultNodeRegistrySync', () => {
    expect(typeof createDefaultNodeRegistrySync).toBe('function');
    const nodes = createDefaultNodeRegistrySync();
    expect(Array.isArray(nodes)).toBe(true);
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
