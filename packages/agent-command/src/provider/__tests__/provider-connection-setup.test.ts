import { describe, expect, it, vi } from 'vitest';
import type {
  TProviderCredentialReference,
  IProviderDefinition,
  IUserInteraction,
} from '@robota-sdk/agent-core';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import type {
  IProviderConnectionHost,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import { executeProviderCommand } from '../provider-command-execution.js';
import { runProviderStartupSetup } from '../provider-startup.js';
import { scriptedContext } from './scripted-interaction.js';
import { createProviderCommandModule } from '../provider-command-module.js';

const reference: TProviderCredentialReference = {
  service: 'fixture.providers',
  account: 'attempt-1',
};
const definition: IProviderDefinition = {
  type: 'openrouter',
  displayName: 'OpenRouter',
  connectionMethods: ['api-key', 'browser'],
  defaults: { model: 'maker/model', baseURL: 'https://openrouter.ai/api/v1' },
  setupSteps: [
    { key: 'apiKey', title: 'API key', masked: true, required: true },
    { key: 'model', title: 'Model', defaultValue: 'maker/model' },
  ],
  requiresApiKey: true,
  createProvider: () => {
    throw new Error('not used');
  },
};

function fixture(initial: TProviderSettingsDocument = {}) {
  let settings = initial;
  const connect = vi.fn<IProviderConnectionHost['connect']>(async (request, persist) => {
    await persist(reference, request.signal ?? new AbortController().signal);
    return reference;
  });
  return {
    read: () => settings,
    options: {
      providerDefinitions: [definition],
      env: { ROUTER_KEY: 'synthetic-environment-secret' },
      connectionHost: { connect },
      settings: {
        readMergedSettings: () => settings,
        readTargetSettings: () => settings,
        writeTargetSettings: (next: TProviderSettingsDocument) => {
          settings = next;
        },
      },
    },
    connect,
  };
}

describe('service connection setup', () => {
  it('gives browser key recovery guidance without exposing an unsafe host error', async () => {
    const { options, connect, read } = fixture();
    connect.mockRejectedValueOnce(new Error('unsafe-host-secret-and-response'));
    const { context } = scriptedContext([{ type: 'answer', values: ['browser'] }]);
    const result = await executeProviderCommand(context, 'add openrouter', options);
    expect(result.success).toBe(false);
    expect(result.message).toContain('https://openrouter.ai/keys');
    expect(result.message).toContain('may remain');
    expect(result.message).toContain('ordinary OpenRouter API key');
    expect(result.message).not.toContain('unsafe-host-secret-and-response');
    expect(read()).toEqual({});
  });
  it('offers both methods and stores a manual key through the host without echoing it', async () => {
    const { options, connect, read } = fixture();
    const { context, requests } = scriptedContext(
      [
        { type: 'answer', values: ['api-key'] },
        { type: 'answer', values: [], text: 'synthetic-manual-secret' },
        { type: 'answer', values: [], text: '' },
      ],
      true,
    );

    const result = await executeProviderCommand(context, 'add openrouter', options);

    expect(result.success).toBe(true);
    expect(requests[0]).toMatchObject({
      id: 'provider-connection-method',
      options: [
        { value: 'api-key', label: 'API key' },
        { value: 'browser', label: 'Browser' },
      ],
    });
    expect(requests[1]).toMatchObject({ masked: true });
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'api-key',
        apiKey: 'synthetic-manual-secret',
        profile: 'openrouter',
      }),
      expect.any(Function),
    );
    expect(read().providers?.openrouter).toEqual({
      type: 'openrouter',
      model: 'maker/model',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKeyRef: reference,
    });
    expect(JSON.stringify([read(), requests, result])).not.toContain('synthetic-manual-secret');
    expect(result.hostActions).toEqual([{ type: 'provider-hot-swap', profileName: 'openrouter' }]);
  });

  it('keeps environment entry independent of the browser and credential store', async () => {
    const { options, connect, read } = fixture();
    const { context } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: '$ENV:ROUTER_KEY' },
      { type: 'answer', values: [], text: '' },
    ]);

    const result = await executeProviderCommand(context, 'add openrouter', options);

    expect(result.success).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    expect(read().providers?.openrouter?.apiKey).toBe('$ENV:ROUTER_KEY');
    expect(read().providers?.openrouter?.apiKeyRef).toBeUndefined();
  });

  it('keeps an existing stored connection when its model is edited', async () => {
    const profile = {
      type: 'openrouter',
      model: 'maker/model',
      apiKeyRef: reference,
      baseURL: 'https://openrouter.ai/api/v1',
    };
    const { options, connect, read } = fixture({
      currentProvider: 'router',
      providers: { router: profile },
    });
    const { context } = scriptedContext([
      { type: 'answer', values: [], text: 'maker/another-model' },
    ]);

    const result = await executeProviderCommand(context, 'edit router', options);

    expect(result.success).toBe(true);
    expect(connect).not.toHaveBeenCalled();
    expect(read().providers?.router).toEqual({ ...profile, model: 'maker/another-model' });
  });

  it('requires explicit reconnect and preserves a working profile when the host fails', async () => {
    const initial = {
      currentProvider: 'router',
      providers: {
        router: { type: 'openrouter', model: 'maker/model', apiKey: '$ENV:ROUTER_KEY' },
      },
    };
    const { options, connect, read } = fixture(initial);
    connect.mockRejectedValueOnce(new Error('synthetic host failure'));
    const { context } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: 'synthetic-replacement-secret' },
      { type: 'answer', values: [], text: '' },
    ]);

    const result = await executeProviderCommand(context, 'reconnect router', options);

    expect(connect).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.message).toContain('/provider reconnect router');
    expect(read()).toEqual(initial);
    expect(result.message).not.toContain('synthetic-replacement-secret');
  });

  it.each([
    { origin: 'environment', credential: { apiKey: '$ENV:ROUTER_KEY' } },
    { origin: 'stored key', credential: { apiKeyRef: reference } },
  ])(
    'restarts after replacing the active $origin connection while preserving duplicate profiles',
    async ({ credential }) => {
      const previous = { type: 'openrouter', model: 'maker/model', ...credential };
      const initial = {
        currentProvider: 'router',
        providers: { router: previous, duplicate: previous },
      };
      const { options, connect, read } = fixture(initial);
      const nextReference = { ...reference, account: 'attempt-2' };
      connect.mockImplementationOnce(async (request, persist) => {
        await persist(nextReference, request.signal ?? new AbortController().signal);
        return nextReference;
      });
      const { context } = scriptedContext([
        { type: 'answer', values: ['api-key'] },
        { type: 'answer', values: [], text: 'synthetic-new-account-key' },
        { type: 'answer', values: [], text: '' },
      ]);

      const result = await executeProviderCommand(context, 'reconnect router', options);

      expect(result.success).toBe(true);
      expect(result.hostActions).toEqual([
        { type: 'session-restart', reason: 'other', message: 'Provider connection restart' },
      ]);
      expect(read().currentProvider).toBe('router');
      expect(read().providers?.router?.apiKeyRef).toEqual(nextReference);
      expect(read().providers?.router?.apiKey).toBeUndefined();
      expect(read().providers?.duplicate).toEqual(previous);
      expect(JSON.stringify([read(), result])).not.toContain('synthetic-new-account-key');
    },
  );

  it('reconnects an inactive profile without restarting or changing the active connection', async () => {
    const active = { type: 'openrouter', model: 'maker/model', apiKey: '$ENV:ROUTER_KEY' };
    const initial = {
      currentProvider: 'working',
      providers: {
        working: active,
        router: { type: 'openrouter', model: 'maker/model', apiKeyRef: reference },
      },
    };
    const { options, connect, read } = fixture(initial);
    const nextReference = { ...reference, account: 'attempt-2' };
    connect.mockImplementationOnce(async (request, persist) => {
      await persist(nextReference, request.signal ?? new AbortController().signal);
      return nextReference;
    });
    const { context } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: 'synthetic-inactive-key' },
      { type: 'answer', values: [], text: '' },
    ]);

    const result = await executeProviderCommand(context, 'reconnect router', options);

    expect(result.success).toBe(true);
    expect(result.hostActions).toBeUndefined();
    expect(read().currentProvider).toBe('working');
    expect(read().providers?.working).toEqual(active);
    expect(read().providers?.router?.apiKeyRef).toEqual(nextReference);
  });

  it('provides browser cancellation and returns to method selection before key setup', async () => {
    const { options, connect, read } = fixture();
    const ids: string[] = [];
    const ui: IUserInteraction = {
      ask: async (request) => {
        ids.push(request.id);
        if (request.id === 'provider-connection-method')
          return {
            type: 'answer',
            values: [ids.filter((id) => id === request.id).length === 1 ? 'browser' : 'api-key'],
          };
        if (request.id.startsWith('provider-connection-progress')) return { type: 'cancelled' };
        if (request.id === 'provider-connection-key')
          return { type: 'answer', values: [], text: 'synthetic-fallback-secret' };
        return { type: 'answer', values: [], text: 'maker/model' };
      },
    };
    connect.mockImplementationOnce(
      (request) =>
        new Promise((_resolve, reject) => {
          request.onProgress?.('awaiting-approval');
          request.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        }),
    );
    const context = createTestCommandHost({ overrides: { getUserInteraction: () => ui } });

    const result = await executeProviderCommand(context, 'add openrouter', options);

    expect(result.success).toBe(true);
    expect(connect.mock.calls.map(([request]) => request.method)).toEqual(['browser', 'api-key']);
    expect(connect.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    expect(read().providers?.openrouter?.apiKeyRef).toEqual(reference);
  });

  it('offers first-run OpenRouter connection without claiming a pre-existing key is required', async () => {
    const { options, connect, read } = fixture();
    const labels: string[] = [];
    const answers = ['4', '1', 'synthetic-startup-secret', '', ''];
    const prompt = vi.fn(async (label: string) => {
      labels.push(label);
      return answers.shift() ?? '';
    });
    const store = {
      kind: 'host' as const,
      scope: 'user' as const,
      displayName: 'fixture settings',
      source: createNodeHostSettingsSource('user', '/fixture/settings.json'),
      read: options.settings.readTargetSettings,
      write: options.settings.writeTargetSettings,
    };

    await runProviderStartupSetup(
      '/fixture',
      {
        settingsSources: [],
        settingsStores: [store],
        connectionHost: options.connectionHost,
      },
      prompt,
      { writeLine: () => {}, writeError: () => {} } as never,
      [definition],
    );

    expect(labels[0]).toContain('Connect with OpenRouter');
    expect(connect).toHaveBeenCalledOnce();
    expect(read().providers?.openrouter?.apiKeyRef).toEqual(reference);
    expect(labels.some((label) => label.includes('base URL'))).toBe(false);
  });

  it('withdraws browser progress after authentication and only then asks for the model', async () => {
    const { options, connect, read } = fixture();
    const events: string[] = [];
    const ui: IUserInteraction = {
      ask: (request, askOptions) => {
        events.push(request.id);
        if (request.id === 'provider-connection-method')
          return Promise.resolve({ type: 'answer', values: ['browser'] });
        if (request.id.startsWith('provider-connection-progress')) {
          return new Promise((resolve) =>
            askOptions?.signal?.addEventListener('abort', () => resolve({ type: 'cancelled' }), {
              once: true,
            }),
          );
        }
        return Promise.resolve({ type: 'answer', values: [], text: 'maker/selected' });
      },
    };
    connect.mockImplementationOnce(async (request, persist) => {
      events.push('authenticated');
      request.onProgress?.('awaiting-approval');
      request.onProgress?.('validating');
      await persist(reference, request.signal ?? new AbortController().signal);
      return reference;
    });
    const context = createTestCommandHost({
      overrides: { getUserInteraction: () => ui, isSetupRequired: () => true },
    });

    const result = await executeProviderCommand(context, 'add openrouter', options);

    expect(result.success).toBe(true);
    expect(events.indexOf('authenticated')).toBeLessThan(events.indexOf('provider-setup-model'));
    expect(events).not.toContain('provider-connection-key');
    expect(connect.mock.calls[0]?.[0].signal?.aborted).toBe(false);
    expect(read().providers?.openrouter?.model).toBe('maker/selected');
  });

  it('honors explicit browser cancellation submitted immediately before a progress transition', async () => {
    const { options, connect, read } = fixture();
    let methods = 0;
    let submitCancel = (): void => {
      throw new Error('No progress prompt is active.');
    };
    const modelPrompts: string[] = [];
    const ui: IUserInteraction = {
      ask: (request, askOptions) => {
        if (request.id === 'provider-connection-method') {
          methods += 1;
          return Promise.resolve(
            methods === 1 ? { type: 'answer', values: ['browser'] } : { type: 'cancelled' },
          );
        }
        if (request.id.startsWith('provider-connection-progress')) {
          return new Promise((resolve) => {
            submitCancel = () => resolve({ type: 'answer', values: ['cancel'] });
            askOptions?.signal?.addEventListener('abort', () => resolve({ type: 'cancelled' }), {
              once: true,
            });
          });
        }
        modelPrompts.push(request.id);
        return Promise.resolve({ type: 'answer', values: [], text: 'maker/selected' });
      },
    };
    connect.mockImplementationOnce(async (request, persist) => {
      request.onProgress?.('awaiting-approval');
      submitCancel();
      // The next stage withdraws the old prompt before its answer continuation runs.
      request.onProgress?.('validating');
      await Promise.resolve();
      request.signal?.throwIfAborted();
      await persist(reference, request.signal ?? new AbortController().signal);
      return reference;
    });

    const result = await executeProviderCommand(
      createTestCommandHost({ overrides: { getUserInteraction: () => ui } }),
      'add openrouter',
      options,
    );

    expect(connect.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    expect(modelPrompts).toEqual([]);
    expect(read()).toEqual({});
    expect(result.hostActions).toBeUndefined();
    expect(methods).toBe(2);
  });

  it('rejects a staged connection when model selection is cancelled', async () => {
    const initial = {
      providers: { router: { type: 'openrouter', model: 'maker/model', apiKeyRef: reference } },
    };
    const { options, connect, read } = fixture(initial);
    const { context } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: 'synthetic-replacement' },
      { type: 'cancelled' },
      { type: 'cancelled' },
    ]);
    const rejectedPersistence = vi.fn();
    connect.mockImplementationOnce(async (request, persist) => {
      try {
        await persist(
          { ...reference, account: 'attempt-2' },
          request.signal ?? new AbortController().signal,
        );
      } catch (error) {
        rejectedPersistence();
        throw error;
      }
      return reference;
    });

    const result = await executeProviderCommand(context, 'reconnect router', options);

    expect(rejectedPersistence).toHaveBeenCalledOnce();
    expect(read()).toEqual(initial);
    expect(result.hostActions).toBeUndefined();
  });

  it('does not overwrite a profile or active choice changed while authentication is pending', async () => {
    const initial = {
      currentProvider: 'router',
      providers: { router: { type: 'openrouter', model: 'maker/model', apiKeyRef: reference } },
    };
    const { options, connect, read } = fixture(initial);
    const updated = {
      ...initial,
      currentProvider: 'another',
      providers: {
        ...initial.providers,
        router: { ...initial.providers.router, model: 'maker/newer-choice' },
      },
    };
    connect.mockImplementationOnce(async (request, persist) => {
      options.settings.writeTargetSettings(updated);
      await persist(
        { ...reference, account: 'attempt-2' },
        request.signal ?? new AbortController().signal,
      );
      return reference;
    });
    const { context } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: 'synthetic-replacement' },
      { type: 'answer', values: [], text: '' },
    ]);

    const result = await executeProviderCommand(context, 'reconnect router', options);

    expect(result.success).toBe(false);
    expect(read()).toEqual(updated);
  });

  it('offers only environment entry under environment-only organization policy', async () => {
    const { options, connect, read } = fixture();
    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: 'synthetic-disallowed-literal' },
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: '$ENV:ROUTER_KEY' },
      { type: 'answer', values: [], text: '' },
    ]);

    const result = await executeProviderCommand(context, 'add openrouter', {
      ...options,
      orgPolicy: { requireApiKeyFromEnv: true },
    });

    expect(result.success).toBe(true);
    expect(requests[0]?.options?.map((option) => option.value)).toEqual(['api-key']);
    expect(connect).not.toHaveBeenCalled();
    expect(read().providers?.openrouter?.apiKey).toBe('$ENV:ROUTER_KEY');
    expect(JSON.stringify([requests, read(), result])).not.toContain(
      'synthetic-disallowed-literal',
    );
  });

  it('withdraws model selection when the host connection deadline expires', async () => {
    const { options, connect, read } = fixture();
    const hostController = new AbortController();
    let modelSignal: AbortSignal | undefined;
    const ui: IUserInteraction = {
      ask: (request, askOptions) => {
        if (request.id === 'provider-connection-method')
          return Promise.resolve({ type: 'answer', values: ['api-key'] });
        if (request.id === 'provider-connection-key')
          return Promise.resolve({ type: 'answer', values: [], text: 'synthetic-deadline-key' });
        modelSignal = askOptions?.signal;
        return new Promise((resolve) => {
          askOptions?.signal?.addEventListener('abort', () => resolve({ type: 'cancelled' }), {
            once: true,
          });
          hostController.abort();
        });
      },
    };
    const modelCancelled = vi.fn();
    connect.mockImplementationOnce(async (_request, persist) => {
      try {
        await persist(reference, hostController.signal);
      } catch (error) {
        modelCancelled();
        throw error;
      }
      return reference;
    });
    // After the aborted attempt, leave setup instead of starting another connection.
    const firstAsk = ui.ask;
    let choices = 0;
    ui.ask = (request, askOptions) =>
      request.id === 'provider-connection-method' && ++choices > 1
        ? Promise.resolve({ type: 'cancelled' })
        : firstAsk(request, askOptions);

    const result = await executeProviderCommand(
      createTestCommandHost({ overrides: { getUserInteraction: () => ui } }),
      'add openrouter',
      options,
    );

    expect(modelSignal).toBe(hostController.signal);
    expect(modelCancelled).toHaveBeenCalledOnce();
    expect(read()).toEqual({});
    expect(result.hostActions).toBeUndefined();
  });

  it('keeps missing environment references out of the host and offers concrete retry guidance', async () => {
    const { options, connect, read } = fixture();
    const { context, requests } = scriptedContext([
      { type: 'answer', values: ['api-key'] },
      { type: 'answer', values: [], text: '$ENV:UNSET_ROUTER_KEY' },
      { type: 'cancelled' },
    ]);

    const result = await executeProviderCommand(context, 'add openrouter', options);

    expect(connect).not.toHaveBeenCalled();
    expect(requests[2]?.description).toContain('Set its variable');
    expect(read()).toEqual({});
    expect(result.hostActions).toBeUndefined();
  });

  it('keeps connect and reconnect user-only at both command registration boundaries', () => {
    const { options } = fixture();
    const module = createProviderCommandModule(options);
    const entry = module.commandSources?.[0]?.getCommands()[0];
    expect(entry?.modelInvocable).toBe(false);
    expect(module.systemCommands?.[0]?.modelInvocable).toBe(false);
    expect(entry?.argumentHint).toContain('reconnect <profile>');
    expect(entry?.description).toContain('/provider reconnect <profile>');
  });
});
