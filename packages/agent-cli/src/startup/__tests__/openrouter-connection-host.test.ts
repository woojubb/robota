import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { createOpenRouterConnectionHost } from '../openrouter-connection-host.js';
import type { IOpenRouterConnectionHostOptions } from '../openrouter-connection-host.js';

import type { ICredentialKey, ICredentialStore } from '@robota-sdk/agent-core';
import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

const TOKEN = 'synthetic-openrouter-credential';
const OLD = { service: 'robota.provider.openrouter', account: 'existing-shared-connection' };
const config = (ref: ICredentialKey) => ({
  name: 'openrouter',
  model: 'fixture/model',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyRef: ref,
});
const key = (ref: ICredentialKey) => JSON.stringify(ref);
const consumerHome = mkdtempSync(join(tmpdir(), 'openrouter-consumer-'));
afterAll(() => rmSync(consumerHome, { recursive: true, force: true }));

function fixture() {
  const secrets = new Map<string, string>([[key(OLD), 'synthetic-old-credential']]);
  const store: ICredentialStore = {
    get: vi.fn(async (ref) => secrets.get(key(ref))),
    set: vi.fn(async (ref, secret) => {
      secrets.set(key(ref), secret);
    }),
    delete: vi.fn(async (ref) => {
      secrets.delete(key(ref));
    }),
  };
  const fetchKey = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe('https://openrouter.ai/api/v1/key');
    expect(init?.redirect).toBe('error');
    expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
    return new Response(JSON.stringify({ data: { label: 'fixture', usage: 0 } }));
  });
  const acquireKey = vi.fn<NonNullable<IOpenRouterConnectionHostOptions['acquireKey']>>(
    async () => TOKEN,
  );
  const options = {
    root: '/unused-fixture-root',
    serviceNamespace: 'robota',
    keyLabel: 'Robota',
    store,
    fetch: fetchKey,
    acquireKey,
  };
  return {
    secrets,
    store,
    fetchKey,
    acquireKey,
    options,
    host: createOpenRouterConnectionHost(options),
  };
}

describe('OpenRouter host-owned provider credentials', () => {
  it('isolates two sealed consumer services and OAuth labels in one dummy key store', async () => {
    const entries = new Map<string, string>();
    const store: ICredentialStore = {
      get: vi.fn(async (ref) => entries.get(key(ref))),
      set: vi.fn(async (ref, secret) => { entries.set(key(ref), secret); }),
      delete: vi.fn(async (ref) => { entries.delete(key(ref)); }),
    };
    const acquireKey = vi.fn(async () => TOKEN);
    const network = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: { label: 'fixture', usage: 0 } })));
    const cedar = createTestProductRuntime('cedar', { HOME: consumerHome });
    const amber = createTestProductRuntime('amber', { HOME: consumerHome });
    const hostFor = (runtime: typeof cedar) => createOpenRouterConnectionHost({
      root: runtime.layout.userRoot,
      serviceNamespace: runtime.config.credentials.serviceNamespace,
      keyLabel: runtime.config.identity.displayName,
      store,
      acquireKey,
      fetch: network,
    });
    const cedarHost = hostFor(cedar);
    const amberHost = hostFor(amber);
    const connect = (host: typeof cedarHost) => host.connect(
      { type: 'openrouter', profile: 'router', method: 'browser' }, () => {},
    );
    const cedarRef = await connect(cedarHost);
    const amberRef = await connect(amberHost);
    expect(cedarRef.service).toBe(`${cedar.config.credentials.serviceNamespace}.provider.openrouter`);
    expect(amberRef.service).toBe(`${amber.config.credentials.serviceNamespace}.provider.openrouter`);
    expect(cedarRef.service).not.toBe(amberRef.service);
    expect(acquireKey).toHaveBeenNthCalledWith(1, expect.objectContaining({ keyLabel: cedar.config.identity.displayName }));
    expect(acquireKey).toHaveBeenNthCalledWith(2, expect.objectContaining({ keyLabel: amber.config.identity.displayName }));
    expect(await cedarHost.resolveCredential(config(cedarRef))).toMatchObject({ apiKey: TOKEN });
    const readsBefore = vi.mocked(store.get).mock.calls.length;
    await expect(amberHost.resolveCredential(config(cedarRef))).rejects.toThrow('selected service');
    await expect(cedarHost.resolveCredential(config(OLD))).rejects.toThrow('selected service');
    expect(store.get).toHaveBeenCalledTimes(readsBefore);
  });
  it.each(['api-key', 'browser'] as const)(
    'stores %s credentials and resolves the saved connection after restart',
    async (method) => {
      const f = fixture();
      let saved: ICredentialKey | undefined;
      const persist = vi.fn((ref: ICredentialKey) => {
        saved = ref;
      });
      const ref = await f.host.connect(
        {
          type: 'openrouter',
          profile: 'router',
          method,
          ...(method === 'api-key' ? { apiKey: TOKEN } : {}),
        },
        persist,
      );
      expect(ref.service).toBe('robota.provider.openrouter');
      expect(ref.account).not.toBe(OLD.account);
      expect(saved).toEqual(ref);
      expect(f.secrets.get(key(ref))).toBe(TOKEN);
      expect(f.fetchKey).toHaveBeenCalledOnce();
      expect(f.acquireKey).toHaveBeenCalledTimes(method === 'browser' ? 1 : 0);
      if (method === 'browser')
        expect(f.acquireKey).toHaveBeenCalledWith(expect.objectContaining({ keyLabel: 'Robota' }));
      const original = config(ref);
      const restarted = createOpenRouterConnectionHost(f.options);
      expect(await restarted.resolveCredential(original)).toEqual({ ...original, apiKey: TOKEN });
      expect(original).not.toHaveProperty('apiKey');
      expect(f.secrets.get(key(OLD))).toBe('synthetic-old-credential');
    },
  );

  it('leaves existing literal and environment configurations untouched without opening storage', async () => {
    const f = fixture();
    for (const apiKey of ['legacy-synthetic-key', '$ENV:EXISTING_KEY']) {
      const legacy = { name: 'openai', model: 'fixture', apiKey };
      expect(await f.host.resolveCredential(legacy)).toBe(legacy);
    }
    expect(f.store.get).not.toHaveBeenCalled();
    expect(f.acquireKey).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'openai' },
    { baseURL: 'https://other.example/v1' },
    { baseURL: 'https://openrouter.ai/api/v1/' },
    { apiKeyRef: { service: 'another.service', account: OLD.account } },
  ])(
    'refuses a stored credential outside its service/destination binding: %j',
    async (override) => {
      const f = fixture();
      await expect(f.host.resolveCredential({ ...config(OLD), ...override })).rejects.toThrow(
        'OpenRouter',
      );
      expect(f.store.get).not.toHaveBeenCalled();
    },
  );

  it('names the user reconnect action for a missing saved key', async () => {
    const f = fixture();
    await expect(f.host.resolveCredential(config({ ...OLD, account: 'missing' }))).rejects.toThrow(
      '/provider reconnect',
    );
  });

  it('rejects validation failures without persisting or disclosing provider response content', async () => {
    const f = fixture();
    f.fetchKey.mockResolvedValueOnce(new Response(TOKEN, { status: 401 }));
    const persist = vi.fn();
    const attempt = f.host.connect(
      { type: 'openrouter', profile: 'router', method: 'api-key', apiKey: TOKEN },
      persist,
    );
    await expect(attempt).rejects.toThrow('validation');
    await expect(attempt).rejects.not.toThrow(TOKEN);
    expect(persist).not.toHaveBeenCalled();
    expect(f.store.set).not.toHaveBeenCalled();
  });

  it.each([
    ['api-key', 'is_management_key'],
    ['browser', 'is_management_key'],
    ['api-key', 'is_provisioning_key'],
    ['browser', 'is_provisioning_key'],
  ] as const)(
    'rejects administrative-only %s credentials identified by %s before changing the connection',
    async (method, field) => {
      const f = fixture();
      f.fetchKey.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { [field]: true, label: TOKEN, usage: 0 },
          }),
        ),
      );
      const original = { model: 'existing/model', apiKeyRef: OLD };
      let profile = original;
      const persist = vi.fn((reference: ICredentialKey) => {
        profile = { ...original, apiKeyRef: reference };
      });
      const attempt = f.host.connect(
        {
          type: 'openrouter',
          profile: 'router',
          method,
          ...(method === 'api-key' ? { apiKey: TOKEN } : {}),
        },
        persist,
      );
      await expect(attempt).rejects.toThrow('ordinary OpenRouter API key');
      await expect(attempt).rejects.not.toThrow(TOKEN);
      expect(profile).toBe(original);
      expect(persist).not.toHaveBeenCalled();
      expect(f.store.set).not.toHaveBeenCalled();
      expect(f.store.delete).not.toHaveBeenCalled();
      expect(f.secrets).toEqual(new Map([[key(OLD), 'synthetic-old-credential']]));
    },
  );

  it('explains remote key recovery if a browser-issued key cannot be saved locally', async () => {
    const f = fixture();
    const attempt = f.host.connect(
      { type: 'openrouter', profile: 'router', method: 'browser' },
      () => {
        throw new Error(TOKEN);
      },
    );
    await expect(attempt).rejects.toThrow('may still exist in OpenRouter');
    await expect(attempt).rejects.toThrow('https://openrouter.ai/keys');
    await expect(attempt).rejects.not.toThrow(TOKEN);
    expect(f.secrets).toEqual(new Map([[key(OLD), 'synthetic-old-credential']]));
  });

  it('cleans only its staged key if settings persistence fails, preserving duplicated old references', async () => {
    const f = fixture();
    const attempt = f.host.connect(
      { type: 'openrouter', profile: 'router', method: 'api-key', apiKey: TOKEN },
      () => {
        throw new Error(TOKEN);
      },
    );
    await expect(attempt).rejects.toThrow('saved');
    await expect(attempt).rejects.not.toThrow(TOKEN);
    expect(f.secrets).toEqual(new Map([[key(OLD), 'synthetic-old-credential']]));
    expect(f.store.delete).toHaveBeenCalledOnce();
    expect(f.store.delete).not.toHaveBeenCalledWith(OLD);
  });

  it('cleans an uncertain failed storage write before any profile commit', async () => {
    const f = fixture();
    f.store.set = vi.fn(async (ref, secret) => {
      f.secrets.set(key(ref), secret);
      throw new Error(TOKEN);
    });
    const persist = vi.fn();
    await expect(
      f.host.connect(
        { type: 'openrouter', profile: 'router', method: 'api-key', apiKey: TOKEN },
        persist,
      ),
    ).rejects.toThrow('saved');
    expect(persist).not.toHaveBeenCalled();
    expect(f.secrets).toEqual(new Map([[key(OLD), 'synthetic-old-credential']]));
  });

  it('cancels model-selection persistence and removes the staged key', async () => {
    const f = fixture();
    const cancel = new AbortController();
    await expect(
      f.host.connect(
        {
          type: 'openrouter',
          profile: 'router',
          method: 'api-key',
          apiKey: TOKEN,
          signal: cancel.signal,
        },
        async () => {
          cancel.abort();
          cancel.signal.throwIfAborted();
        },
      ),
    ).rejects.toThrow('cancelled');
    expect(f.secrets).toEqual(new Map([[key(OLD), 'synthetic-old-credential']]));
  });

  it('keeps a successfully committed key when cancellation arrives after the settings write', async () => {
    const f = fixture();
    const cancel = new AbortController();
    let saved: ICredentialKey | undefined;
    const ref = await f.host.connect(
      {
        type: 'openrouter',
        profile: 'router',
        method: 'api-key',
        apiKey: TOKEN,
        signal: cancel.signal,
      },
      (value) => {
        saved = value;
        cancel.abort();
      },
    );
    expect(saved).toEqual(ref);
    expect(f.secrets.get(key(ref))).toBe(TOKEN);
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it('rejects another in-flight attempt for the same profile and allows retry after completion', async () => {
    const f = fixture();
    let finish!: (key: string) => void;
    f.acquireKey.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const first = f.host.connect(
      { type: 'openrouter', profile: 'router', method: 'browser' },
      () => {},
    );
    await expect(
      f.host.connect({ type: 'openrouter', profile: 'router', method: 'browser' }, () => {}),
    ).rejects.toThrow('already');
    finish(TOKEN);
    await first;
    await expect(
      f.host.connect({ type: 'openrouter', profile: 'router', method: 'browser' }, () => {}),
    ).resolves.toMatchObject({ service: OLD.service });
  });

  it('aborts active host authentication during shutdown before any key can commit', async () => {
    const f = fixture();
    f.acquireKey.mockImplementationOnce(
      async ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true });
        }),
    );
    const persist = vi.fn();
    const attempt = f.host.connect(
      { type: 'openrouter', profile: 'router', method: 'browser' },
      persist,
    );
    f.host.shutdown();
    await expect(attempt).rejects.toThrow('cancelled');
    expect(persist).not.toHaveBeenCalled();
  });

  it('propagates host shutdown into pending model selection before settings commit', async () => {
    const f = fixture();
    const persist = vi.fn(async (_reference: ICredentialKey, signal: AbortSignal) => {
      f.host.shutdown();
      signal.throwIfAborted();
    });
    await expect(
      f.host.connect(
        { type: 'openrouter', profile: 'router', method: 'api-key', apiKey: TOKEN },
        persist,
      ),
    ).rejects.toThrow('cancelled');
    expect(persist).toHaveBeenCalledOnce();
    expect(f.secrets).toEqual(new Map([[key(OLD), 'synthetic-old-credential']]));
  });

  it('respects environment-only organization policy before browser, network or store access', async () => {
    const f = fixture();
    const host = createOpenRouterConnectionHost({ ...f.options, requireApiKeyFromEnv: true });
    await expect(
      host.connect({ type: 'openrouter', profile: 'router', method: 'browser' }, () => {}),
    ).rejects.toThrow('environment');
    await expect(host.resolveCredential(config(OLD))).rejects.toThrow('environment');
    expect(f.acquireKey).not.toHaveBeenCalled();
    expect(f.fetchKey).not.toHaveBeenCalled();
    expect(f.store.get).not.toHaveBeenCalled();
  });
});
