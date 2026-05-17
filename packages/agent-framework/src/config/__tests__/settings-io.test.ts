import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readSettings,
  writeSettings,
  updateModelInSettings,
  deleteSettings,
} from '../settings-io.js';

const TEST_DIR = join(tmpdir(), 'robota-settings-io-test');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readSettings', () => {
  it('returns empty object for non-existent file', () => {
    expect(readSettings(join(TEST_DIR, 'nope.json'))).toEqual({});
  });

  it('reads valid JSON file', () => {
    const path = join(TEST_DIR, 'settings.json');
    const data = { provider: { name: 'anthropic', model: 'claude-sonnet-4-6' } };
    writeSettings(path, data);
    expect(readSettings(path)).toEqual(data);
  });
});

describe('writeSettings', () => {
  it('creates file with formatted JSON', () => {
    const path = join(TEST_DIR, 'out.json');
    writeSettings(path, { key: 'value' });
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('"key": "value"');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('creates parent directories', () => {
    const path = join(TEST_DIR, 'nested', 'deep', 'settings.json');
    writeSettings(path, { ok: true });
    expect(existsSync(path)).toBe(true);
  });

  it('overwrites existing file', () => {
    const path = join(TEST_DIR, 'settings.json');
    writeSettings(path, { v: 1 });
    writeSettings(path, { v: 2 });
    expect(readSettings(path)).toEqual({ v: 2 });
  });
});

describe('updateModelInSettings', () => {
  it('creates file with provider.model if file does not exist', () => {
    const path = join(TEST_DIR, 'new-settings.json');
    updateModelInSettings(path, 'claude-opus-4-6');
    const result = readSettings(path);
    expect(result).toEqual({ provider: { model: 'claude-opus-4-6' } });
  });

  it('updates model in existing settings without losing other fields', () => {
    const path = join(TEST_DIR, 'settings.json');
    writeSettings(path, {
      provider: { name: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' },
      defaultMode: 'default',
    });
    updateModelInSettings(path, 'claude-opus-4-6');
    const result = readSettings(path);
    expect(result).toEqual({
      provider: { name: 'anthropic', model: 'claude-opus-4-6', apiKey: 'sk-test' },
      defaultMode: 'default',
    });
  });

  it('creates provider object if missing in existing settings', () => {
    const path = join(TEST_DIR, 'settings.json');
    writeSettings(path, { defaultMode: 'plan' });
    updateModelInSettings(path, 'claude-haiku-4-5');
    const result = readSettings(path);
    expect(result).toEqual({
      defaultMode: 'plan',
      provider: { model: 'claude-haiku-4-5' },
    });
  });
});

describe('deleteSettings', () => {
  it('returns false for non-existent file', () => {
    expect(deleteSettings(join(TEST_DIR, 'nope.json'))).toBe(false);
  });

  it('deletes existing file and returns true', () => {
    const path = join(TEST_DIR, 'settings.json');
    writeSettings(path, { ok: true });
    expect(deleteSettings(path)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });
});
