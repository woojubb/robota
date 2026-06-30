import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAssetRoot, resolveStorageRoot } from '../config/resolve-storage-root.js';

const ENV_KEYS = ['DAG_STORAGE_ROOT', 'ASSET_STORAGE_ROOT', 'XDG_DATA_HOME'] as const;

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string>>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) {
    snap[key] = process.env[key];
  }
  return snap;
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snap[key];
    }
  }
}

describe('resolveStorageRoot', () => {
  let snap: EnvSnapshot;

  beforeEach(() => {
    snap = snapshotEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });
  afterEach(() => restoreEnv(snap));

  it('returns home-dir fallback when no env vars are set', () => {
    const result = resolveStorageRoot();
    expect(result).toBe(path.join(os.homedir(), '.robota-dag', 'storage'));
  });

  it('returns DAG_STORAGE_ROOT when set', () => {
    process.env['DAG_STORAGE_ROOT'] = '/custom/storage';
    const result = resolveStorageRoot();
    expect(result).toBe(path.resolve('/custom/storage'));
  });

  it('returns XDG_DATA_HOME-based path when XDG_DATA_HOME is set', () => {
    process.env['XDG_DATA_HOME'] = '/xdg/data';
    const result = resolveStorageRoot();
    expect(result).toBe(path.join('/xdg/data', 'robota-dag', 'storage'));
  });

  it('DAG_STORAGE_ROOT takes precedence over XDG_DATA_HOME', () => {
    process.env['DAG_STORAGE_ROOT'] = '/explicit/storage';
    process.env['XDG_DATA_HOME'] = '/xdg/data';
    const result = resolveStorageRoot();
    expect(result).toBe(path.resolve('/explicit/storage'));
  });
});

describe('resolveAssetRoot', () => {
  let snap: EnvSnapshot;

  beforeEach(() => {
    snap = snapshotEnv();
    for (const key of ENV_KEYS) delete process.env[key];
  });
  afterEach(() => restoreEnv(snap));

  it('returns home-dir fallback when no env vars are set', () => {
    const result = resolveAssetRoot();
    expect(result).toBe(path.join(os.homedir(), '.robota-dag', 'assets'));
  });

  it('returns ASSET_STORAGE_ROOT when set', () => {
    process.env['ASSET_STORAGE_ROOT'] = '/custom/assets';
    const result = resolveAssetRoot();
    expect(result).toBe(path.resolve('/custom/assets'));
  });

  it('returns XDG_DATA_HOME-based path when XDG_DATA_HOME is set', () => {
    process.env['XDG_DATA_HOME'] = '/xdg/data';
    const result = resolveAssetRoot();
    expect(result).toBe(path.join('/xdg/data', 'robota-dag', 'assets'));
  });

  it('ASSET_STORAGE_ROOT takes precedence over XDG_DATA_HOME', () => {
    process.env['ASSET_STORAGE_ROOT'] = '/explicit/assets';
    process.env['XDG_DATA_HOME'] = '/xdg/data';
    const result = resolveAssetRoot();
    expect(result).toBe(path.resolve('/explicit/assets'));
  });
});
