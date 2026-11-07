/**
 * A session reads `$ENV:` references against its own `environment` snapshot when it has one, and
 * against the host's `env` otherwise. A host that lends neither reads every reference as unset.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createNodeHostSettingsSource } from '../../config/node-host-settings-source.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type { IFrameworkHost } from '../../host/framework-host.js';

const KEY = 'ROBOTA_SESSION_HOST_ENV_KEY';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-session-host-env-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** Starts a session that can switch to the `cloud` profile and reports the key the provider was built with. */
function startSession(host: IFrameworkHost, environment?: Record<string, string>) {
  const path = join(dir, 'settings.json');
  writeFileSync(
    path,
    JSON.stringify({
      providers: { cloud: { type: 'synthetic', model: 'fixture-model', apiKey: `$ENV:${KEY}` } },
    }),
  );
  const keys: Array<string | undefined> = [];
  const definitions: IProviderDefinition[] = [
    {
      type: 'synthetic',
      createProvider: (config) => {
        keys.push(config.apiKey);
        return { name: 'synthetic' } as unknown as IAIProvider;
      },
    },
  ];
  const swapProvider = vi.fn();
  const session = new InteractiveSession({
    host,
    session: { swapProvider, getSessionId: () => 'sess-1', getHistory: () => [] },
    cwd: '/tmp',
    provider: { name: 'initial' },
    providerDefinitions: definitions,
    userSettingsSources: [createNodeHostSettingsSource('user', path)],
    ...(environment === undefined ? {} : { environment }),
  } as never);
  const switchProvider = (): Promise<void> =>
    (session as unknown as { switchProvider(profile: string): Promise<void> }).switchProvider(
      'cloud',
    );
  return { keys, swapProvider, switchProvider };
}

describe('the environment a session reads credential references against', () => {
  it('is the host environment when the session was given no snapshot of its own', async () => {
    vi.stubEnv(KEY, 'from-process');
    const host = createTestFrameworkHost({
      env: (name) => (name === KEY ? 'from-host' : undefined),
    });
    const { keys, switchProvider } = startSession(host);
    await switchProvider();
    expect(keys).toEqual(['from-host']);
  });

  it('is the session snapshot when it has one, whatever the host answers', async () => {
    const host = createTestFrameworkHost({ env: () => 'from-host' });
    const { keys, switchProvider } = startSession(host, { [KEY]: 'from-snapshot' });
    await switchProvider();
    expect(keys).toEqual(['from-snapshot']);
  });

  it('reads every reference as unset when the host lends no environment', async () => {
    vi.stubEnv(KEY, 'from-process');
    const host = createTestFrameworkHost({ env: undefined });
    const { keys, switchProvider } = startSession(host);
    await switchProvider();
    expect(keys).toEqual([undefined]);
  });
});
