import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliLiveContentRedaction, createLiveContentSecretsGetter } from '../live-content-secrets.js';
import { prepareLiveContentRedactor } from '../live-content-redaction.js';

const definitions: IProviderDefinition[] = [
  { type: 'alpha', defaults: { model: 'alpha-1', apiKey: '$ENV:ALPHA_TEST_API_KEY' }, createProvider: () => { throw new Error('unused'); } },
  { type: 'beta', defaults: { model: 'beta-1', apiKey: '$ENV:BETA_TEST_API_KEY' }, createProvider: () => { throw new Error('unused'); } },
];

describe('live content secrets', () => {
  let home: string;
  let settingsPath: string;
  const write = (settings: unknown): void => writeFileSync(settingsPath, JSON.stringify(settings));

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'robota-content-secrets-'));
    mkdirSync(join(home, '.robota'), { recursive: true });
    settingsPath = join(home, '.robota', 'settings.json');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  function getter(startupCredentials: string[] = []) {
    return createLiveContentSecretsGetter({
      settingsSources: [createNodeHostSettingsSource('user', settingsPath)],
      providerDefinitions: definitions,
      env: process.env,
      startupCredentials,
    });
  }

  it('masks a provider switched to mid-session, with a key the startup snapshot never saw', () => {
    vi.stubEnv('BETA_TEST_API_KEY', 'beta-ambient-key-2222');
    write({ currentProvider: 'a', providers: { a: { type: 'alpha', apiKey: 'alpha-literal-key-1111' } } });
    const secrets = getter();
    const before = prepareLiveContentRedactor({ getSecrets: secrets, cwd: home, homedir: '/home/al' });
    expect(before('using beta-ambient-key-2222', 2048, false).text).toContain('beta-ambient-key-2222');

    // `/provider` adds and switches to a profile whose key is the definition's ambient default.
    write({
      currentProvider: 'b',
      providers: { a: { type: 'alpha', apiKey: 'alpha-literal-key-1111' }, b: { type: 'beta' } },
    });
    const after = prepareLiveContentRedactor({ getSecrets: secrets, cwd: home, homedir: '/home/al' });
    const out = after('using beta-ambient-key-2222 and alpha-literal-key-1111', 2048, false).text;
    expect(out).toBe('using [redacted] and [redacted]');
  });

  it('collects settings secrets, every profile’s resolved key and the startup credential', () => {
    vi.stubEnv('ALPHA_TEST_API_KEY', 'alpha-ambient-key-3333');
    vi.stubEnv('REFERENCED_TEST_KEY', 'referenced-key-4444');
    write({
      provider: { name: 'alpha', model: 'alpha-1', apiKey: '$ENV:REFERENCED_TEST_KEY' },
      providers: { idle: { type: 'alpha' } },
      env: { SOME_SETTING: 'settings-env-value-5555' },
    });
    const secrets = getter(['startup-flag-key-6666'])();
    expect(secrets).toEqual(expect.arrayContaining([
      'referenced-key-4444', 'alpha-ambient-key-3333', 'settings-env-value-5555', 'startup-flag-key-6666',
    ]));
  });

  it('does not mask an ambient key no definition or profile resolves', () => {
    vi.stubEnv('BETA_TEST_API_KEY', 'beta-unused-key-7777');
    write({ currentProvider: 'a', providers: { a: { type: 'alpha', apiKey: 'alpha-literal-key-1111' } } });
    expect(getter()()).not.toContain('beta-unused-key-7777');
  });

  it('gives the CLI a context that masks the startup-resolved ambient key and the working directory', () => {
    vi.stubEnv('ALPHA_TEST_API_KEY', 'alpha-startup-key-8888');
    const context = createCliLiveContentRedaction({
      cwd: home,
      projectAccess: { status: 'untrusted' } as never,
      settingsSources: [createNodeHostSettingsSource('user', settingsPath)],
      providerDefinitions: definitions,
      env: process.env,
      startupCredentials: ['alpha-startup-key-8888'],
    });
    const out = prepareLiveContentRedactor(context)(`key alpha-startup-key-8888 at ${home}/a.txt`, 2048, false).text;
    expect(out).toBe('key [redacted] at <workspace>/a.txt');
  });
});
