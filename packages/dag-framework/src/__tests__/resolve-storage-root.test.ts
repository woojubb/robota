import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveAssetRoot, resolveStorageRoot } from '../config/resolve-storage-root.js';

const ENV_KEYS = ['DAG_STORAGE_ROOT', 'ASSET_STORAGE_ROOT', 'XDG_DATA_HOME'] as const;

function clearEnvKeys(): void {
  for (const key of ENV_KEYS) vi.stubEnv(key, undefined);
}

describe('resolveStorageRoot', () => {
  beforeEach(() => {
    clearEnvKeys();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns home-dir fallback when no env vars are set', () => {
    const result = resolveStorageRoot();
    expect(result).toBe(path.join(os.homedir(), '.robota-dag', 'storage'));
  });

  it('returns DAG_STORAGE_ROOT when set', () => {
    vi.stubEnv('DAG_STORAGE_ROOT', '/custom/storage');
    const result = resolveStorageRoot();
    expect(result).toBe(path.resolve('/custom/storage'));
  });

  it('returns XDG_DATA_HOME-based path when XDG_DATA_HOME is set', () => {
    vi.stubEnv('XDG_DATA_HOME', '/xdg/data');
    const result = resolveStorageRoot();
    expect(result).toBe(path.join('/xdg/data', 'robota-dag', 'storage'));
  });

  it('DAG_STORAGE_ROOT takes precedence over XDG_DATA_HOME', () => {
    vi.stubEnv('DAG_STORAGE_ROOT', '/explicit/storage');
    vi.stubEnv('XDG_DATA_HOME', '/xdg/data');
    const result = resolveStorageRoot();
    expect(result).toBe(path.resolve('/explicit/storage'));
  });
});

describe('resolveAssetRoot', () => {
  beforeEach(() => {
    clearEnvKeys();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns home-dir fallback when no env vars are set', () => {
    const result = resolveAssetRoot();
    expect(result).toBe(path.join(os.homedir(), '.robota-dag', 'assets'));
  });

  it('returns ASSET_STORAGE_ROOT when set', () => {
    vi.stubEnv('ASSET_STORAGE_ROOT', '/custom/assets');
    const result = resolveAssetRoot();
    expect(result).toBe(path.resolve('/custom/assets'));
  });

  it('returns XDG_DATA_HOME-based path when XDG_DATA_HOME is set', () => {
    vi.stubEnv('XDG_DATA_HOME', '/xdg/data');
    const result = resolveAssetRoot();
    expect(result).toBe(path.join('/xdg/data', 'robota-dag', 'assets'));
  });

  it('ASSET_STORAGE_ROOT takes precedence over XDG_DATA_HOME', () => {
    vi.stubEnv('ASSET_STORAGE_ROOT', '/explicit/assets');
    vi.stubEnv('XDG_DATA_HOME', '/xdg/data');
    const result = resolveAssetRoot();
    expect(result).toBe(path.resolve('/explicit/assets'));
  });
});
