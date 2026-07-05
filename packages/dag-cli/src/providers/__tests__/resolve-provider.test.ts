import { afterEach, describe, expect, it } from 'vitest';

import { listAvailableProviders, resolveProvider } from '../resolve-provider.js';

const RUNTIME_URL_ENV = 'DAG_RUNTIME_SERVER_URL';
const DEFAULT_PROVIDER_ENV = 'DAG_DEFAULT_PROVIDER';

describe('resolveProvider (WORKFLOW-002 Phase C)', () => {
  const savedRuntimeUrl = process.env[RUNTIME_URL_ENV];
  const savedDefaultProvider = process.env[DEFAULT_PROVIDER_ENV];

  afterEach(() => {
    if (savedRuntimeUrl === undefined) delete process.env[RUNTIME_URL_ENV];
    else process.env[RUNTIME_URL_ENV] = savedRuntimeUrl;
    if (savedDefaultProvider === undefined) delete process.env[DEFAULT_PROVIDER_ENV];
    else process.env[DEFAULT_PROVIDER_ENV] = savedDefaultProvider;
  });

  it('defaults to the local provider', async () => {
    delete process.env[DEFAULT_PROVIDER_ENV];
    const provider = await resolveProvider();
    expect(provider.providerId).toBe('local');
  });

  it('resolves the http provider against an explicit --server-url', async () => {
    const provider = await resolveProvider({
      provider: 'http',
      serverUrl: 'http://localhost:3939',
    });
    expect(provider.providerId).toBe('http');
  });

  it('resolves the http provider against DAG_RUNTIME_SERVER_URL when no flag is given', async () => {
    process.env[RUNTIME_URL_ENV] = 'http://env-host:3939';
    const provider = await resolveProvider({ provider: 'http' });
    expect(provider.providerId).toBe('http');
  });

  it('lets --server-url override DAG_RUNTIME_SERVER_URL', async () => {
    process.env[RUNTIME_URL_ENV] = 'http://env-host:3939';
    const provider = await resolveProvider({
      provider: 'http',
      serverUrl: 'http://flag-host:1234',
    });
    expect(provider.displayName).toContain('flag-host:1234');
  });

  it('throws for the http provider with no URL configured', async () => {
    delete process.env[RUNTIME_URL_ENV];
    await expect(resolveProvider({ provider: 'http' })).rejects.toThrow(/requires a server URL/);
  });

  it('throws for an unknown provider', async () => {
    await expect(resolveProvider({ provider: 'nope' })).rejects.toThrow(/Unknown provider/);
  });

  it('lists both local and http providers', () => {
    const ids = listAvailableProviders().map((p) => p.id);
    expect(ids).toContain('local');
    expect(ids).toContain('http');
  });
});
