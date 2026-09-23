import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  statSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadConfig } from '../../config/config-loader.js';
import { createTrustedSettingsSourcesFixture } from '../../testing/trusted-project-state-fixture.js';
import { NoCurrentProviderProfileError } from '../no-current-provider-profile-error.js';
import * as settingsIo from '../settings-io.js';
import {
  readSettings,
  writeSettings,
  updateModelInSettings,
  deleteSettings,
} from '../settings-io.js';

const TEST_DIR = realpathSync(mkdtempSync(join(tmpdir(), 'robota-settings-io-test-')));

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readSettings', () => {
  it('does not expose an ambient project-scope path resolver', () => {
    expect('resolveSettingsPathForScope' in settingsIo).toBe(false);
  });

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

  // SEC-003: a settings file may hold a plaintext `provider.apiKey`, so it must not be
  // created world-readable by the ambient umask.
  it('creates the file owner-readable only', () => {
    const path = join(TEST_DIR, 'credentialed.json');
    writeSettings(path, { provider: { name: 'openai', apiKey: 'sk-secret' } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('overwrites existing file', () => {
    const path = join(TEST_DIR, 'settings.json');
    writeSettings(path, { v: 1 });
    writeSettings(path, { v: 2 });
    expect(readSettings(path)).toEqual({ v: 2 });
  });
});

describe('updateModelInSettings', () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  // CONFIG-002: the writer must never emit the legacy flat `provider` shape that loadConfig rejects.
  it('refuses to create a file when there is no active provider profile', () => {
    const path = join(TEST_DIR, 'new-settings.json');
    expect(() => updateModelInSettings(path, 'claude-opus-4-6')).toThrow(
      NoCurrentProviderProfileError,
    );
    expect(existsSync(path)).toBe(false);
  });

  it('refuses legacy flat provider settings and leaves the file untouched', () => {
    const path = join(TEST_DIR, 'settings.json');
    const legacy = { provider: { name: 'anthropic', model: 'claude-sonnet-4-6' } };
    writeSettings(path, legacy);
    expect(() => updateModelInSettings(path, 'claude-opus-4-6')).toThrow(
      NoCurrentProviderProfileError,
    );
    expect(readSettings(path)).toEqual(legacy);
  });

  it('updates the active profile model without losing other fields', () => {
    const path = join(TEST_DIR, 'settings.json');
    writeSettings(path, {
      currentProvider: 'main',
      providers: { main: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: 'sk-test' } },
      defaultMode: 'default',
    });
    updateModelInSettings(path, 'claude-opus-4-6');
    expect(readSettings(path)).toEqual({
      currentProvider: 'main',
      providers: { main: { type: 'anthropic', model: 'claude-opus-4-6', apiKey: 'sk-test' } },
      defaultMode: 'default',
    });
  });

  it('writes a shape the canonical loader round-trips', async () => {
    const cwd = join(TEST_DIR, 'project');
    const home = join(TEST_DIR, 'home');
    mkdirSync(join(cwd, '.robota'), { recursive: true });
    mkdirSync(home, { recursive: true });
    process.env.HOME = home;
    const path = join(cwd, '.robota', 'settings.json');
    writeSettings(path, {
      currentProvider: 'main',
      providers: { main: { type: 'anthropic', model: 'claude-sonnet-4-6' } },
    });
    updateModelInSettings(path, 'claude-opus-4-6');
    const config = await loadConfig(await createTrustedSettingsSourcesFixture(cwd));
    expect(config.provider.name).toBe('anthropic');
    expect(config.provider.model).toBe('claude-opus-4-6');
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
