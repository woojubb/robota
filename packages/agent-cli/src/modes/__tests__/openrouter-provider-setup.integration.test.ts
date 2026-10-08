import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOpenRouterProviderDefinition } from '@robota-sdk/agent-builtin-providers';
import { createProviderCommandModule } from '@robota-sdk/agent-command';
import { createProviderFromConfig } from '@robota-sdk/agent-core';
import {
  createNodeHostSettingsSource,
  createInProcessSubagentRunner,
  InteractiveSession,
  readProviderSettings,
} from '@robota-sdk/agent-framework';
import { createOutboundDelivery, createSessionMessageHandler } from '@robota-sdk/agent-transport';
import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createProductSubagentRunnerFactory } from '../../product/subagent-composition.js';
import { PrintTerminal } from '../../print-terminal.js';
import { createOpenRouterConnectionHost } from '../../startup/openrouter-connection-host.js';
import { createSetupPlaceholderProvider } from '../../startup/setup-placeholder-provider.js';
import { buildServeSessionOptions } from '../serve-mode.js';

import type {
  IAIProvider,
  ICredentialKey,
  ICredentialStore,
  IProviderDefinitionConfig,
  TActionResponse,
} from '@robota-sdk/agent-core';
import type {
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TAskFrame = Extract<TServerMessage, { type: 'ask_request' }>;

const ENDPOINT = 'https://openrouter.ai/api/v1';
const MODEL = 'anthropic/claude-sonnet-4.6';
const BROWSER_KEY = 'synthetic-app-browser-issued-key';
const MANUAL_KEY = 'synthetic-app-manually-entered-key';
const AUTHORIZATION_CODE = 'synthetic-app-authorization-code';
const OLD_KEY = 'synthetic-app-existing-key';
const OLD_REFERENCE = { service: 'robota.provider.openrouter', account: 'existing-app-connection' };
const storeKey = (reference: ICredentialKey): string => JSON.stringify(reference);

function visit(url: URL): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { agent: false }, (response) => {
      response.resume();
      response.once('end', () => {
        resolve(response.statusCode ?? 0);
      });
    });
    request.once('error', reject);
    request.end();
  });
}

function previousSettings(): TProviderSettingsDocument {
  const profile = { type: 'openrouter', model: MODEL, baseURL: ENDPOINT, apiKeyRef: OLD_REFERENCE };
  return { currentProvider: 'router', providers: { router: profile, duplicate: { ...profile } } };
}

/** Actual host OAuth/connection/setup/session protocol; only inference and account services are fixtures. */
async function fixture(
  initialSettings: TProviderSettingsDocument = {},
  options: { approveBrowser?: boolean; secrets?: Map<string, string> } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'openrouter-app-setup-'));
  const home = join(directory, 'home');
  const state = join(home, '.test-product');
  mkdirSync(state, { recursive: true });
  const settingsPath = join(state, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(initialSettings));
  const readSettings = (): TProviderSettingsDocument =>
    JSON.parse(readFileSync(settingsPath, 'utf8')) as TProviderSettingsDocument;
  const settings: IProviderCommandSettingsAdapter = {
    readMergedSettings: readSettings,
    readTargetSettings: readSettings,
    writeTargetSettings: (next) => {
      writeFileSync(settingsPath, JSON.stringify(next));
    },
  };
  const secrets = options.secrets ?? new Map<string, string>([[storeKey(OLD_REFERENCE), OLD_KEY]]);
  const store: ICredentialStore = {
    get: vi.fn(async (reference) => secrets.get(storeKey(reference))),
    set: vi.fn(async (reference, value) => {
      secrets.set(storeKey(reference), value);
    }),
    delete: vi.fn(async (reference) => {
      secrets.delete(storeKey(reference));
    }),
  };
  const opened: URL[] = [];
  const verifiers: string[] = [];
  const operations: string[] = [];
  const network = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    expect(init?.redirect).toBe('error');
    if (String(input) === `${ENDPOINT}/auth/keys`) {
      operations.push('exchange');
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(init?.method).toBe('POST');
      expect(body.code).toBe(AUTHORIZATION_CODE);
      expect(body.code_challenge_method).toBe('S256');
      expect(createHash('sha256').update(body.code_verifier!).digest('base64url')).toBe(
        opened.at(-1)?.searchParams.get('code_challenge'),
      );
      verifiers.push(body.code_verifier!);
      return new Response(JSON.stringify({ key: BROWSER_KEY }));
    }
    expect(String(input)).toBe(`${ENDPOINT}/key`);
    expect(init?.method).toBe('GET');
    const authorization = new Headers(init?.headers).get('authorization');
    expect([`Bearer ${BROWSER_KEY}`, `Bearer ${MANUAL_KEY}`]).toContain(authorization);
    operations.push('validate');
    return new Response(
      JSON.stringify({ data: { label: 'Synthetic Robota connection', usage: 0 } }),
    );
  });
  const openBrowser = vi.fn(async (authorization: URL) => {
    operations.push('browser');
    opened.push(authorization);
    if (options.approveBrowser === false) return;
    const callback = new URL(authorization.searchParams.get('callback_url') ?? '');
    callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
    callback.searchParams.set('code', AUTHORIZATION_CODE);
    expect(await visit(callback)).toBe(200);
  });
  const connectionHost = createOpenRouterConnectionHost({
    root: state,
    serviceNamespace: 'synthetic.app',
    store,
    fetch: network,
    openBrowser,
  });
  const definition = createOpenRouterProviderDefinition();
  const sources = [createNodeHostSettingsSource('user', settingsPath)];
  let model = 'setup-required';
  let provider: IAIProvider = createSetupPlaceholderProvider();
  let startupConfig: IProviderDefinitionConfig | undefined;
  if (initialSettings.currentProvider !== undefined) {
    const unresolved = readProviderSettings(sources, {
      providerDefinitions: [definition],
      env: {},
    });
    const resolved = await connectionHost.resolveCredential(unresolved);
    startupConfig = resolved;
    model = resolved.model;
    provider = createProviderFromConfig(resolved, [definition]);
  }
  const runtimeSession = {
    run: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'openrouter-app-session',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
    getModelId: () => model,
    getPermissionMode: () => 'default',
    getModelEffort: () => 'auto',
    swapProvider: vi.fn((next: IAIProvider, nextModel: string) => {
      provider = next;
      model = nextModel;
    }),
  };
  const requestRestart = vi.fn();
  const session = new InteractiveSession({
    ...buildServeSessionOptions({
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      cwd: directory,
      args: { noSessionPersistence: true },
      preset: {},
      provider,
      setupRequired: initialSettings.currentProvider === undefined,
      providerDefinitions: [definition],
      userSettingsSources: sources,
      resolveProviderCredential: connectionHost.resolveCredential,
      commandModules: [
        createProviderCommandModule({
          providerDefinitions: [definition],
          settings,
          env: {},
          connectionHost,
          resolveCredential: connectionHost.resolveCredential,
        }),
      ],
      commandHostAdapters: { process: { requestRestart, requestExit: vi.fn() } },
      backgroundTaskRunners: [],
    } as never),
    providerEnvironment: {},
    session: runtimeSession,
  } as never);
  const frames: TServerMessage[] = [];
  const handler = createSessionMessageHandler({
    session,
    deliver: createOutboundDelivery(
      (frame) => frames.push(frame),
      (error) => {
        throw error;
      },
    ),
    driverId: 'synthetic-desktop-openrouter',
  });
  const answer = (frame: TAskFrame, response: TActionResponse): void => {
    handler.onMessage(JSON.stringify({ type: 'ask-response', id: frame.event.id, response }));
  };
  const begin = (args: string): number => {
    const seen = frames.length;
    handler.onMessage(JSON.stringify({ type: 'command', name: 'provider', args }));
    return seen;
  };
  const waitForResult = async (seen: number): Promise<void> => {
    await vi.waitFor(
      () => {
        expect(frames.slice(seen).find((frame) => frame.type === 'command_result')).toMatchObject({
          type: 'command_result',
          success: true,
        });
      },
      { timeout: 5_000, interval: 10 },
    );
  };
  const waitForAsk = async (id: string, seen = 0): Promise<TAskFrame> => {
    let found: TAskFrame | undefined;
    await vi.waitFor(
      () => {
        found = frames
          .slice(seen)
          .find(
            (frame): frame is TAskFrame =>
              frame.type === 'ask_request' && frame.event.request.id.startsWith(id),
          );
        expect(found).toBeDefined();
      },
      { timeout: 5_000, interval: 10 },
    );
    return found!;
  };

  return {
    directory,
    bootstrap: { provider, config: startupConfig, definition },
    session,
    runtimeSession,
    readSettings,
    connectionHost,
    secrets,
    store,
    opened,
    network,
    openBrowser,
    operations,
    frames,
    verifiers,
    requestRestart,
    answer,
    begin,
    waitForAsk,
    waitForResult,
    async command(args: string, answers: Readonly<Record<string, string>> = {}) {
      const seen = begin(args);
      const answered = new Set<string>();
      await vi.waitFor(
        () => {
          for (const frame of frames.slice(seen)) {
            if (
              frame.type !== 'ask_request' ||
              answered.has(frame.event.id) ||
              frame.event.request.id.startsWith('provider-connection-progress-')
            )
              continue;
            const request = frame.event.request;
            const value = answers[request.id] ?? request.default?.text ?? '';
            answered.add(frame.event.id);
            answer(frame, {
              type: 'answer',
              values: request.options?.some((option) => option.value === value) ? [value] : [],
              ...(request.options === undefined ? { text: value } : {}),
            });
          }
          expect(frames.slice(seen).find((frame) => frame.type === 'command_result')).toMatchObject(
            { type: 'command_result', success: true },
          );
        },
        { timeout: 5_000, interval: 10 },
      );
      expect(frames.slice(seen).filter((frame) => frame.type === 'protocol_error')).toEqual([]);
      return frames.slice(seen).filter((frame): frame is TAskFrame => frame.type === 'ask_request');
    },
    async restart() {
      return fixture(readSettings(), { secrets });
    },
    async close() {
      handler.cleanup();
      connectionHost.shutdown();
      try {
        await session.shutdown();
        await provider.dispose?.();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    detach: () => {
      handler.cleanup();
    },
  };
}

function expectNoSecrets(f: Awaited<ReturnType<typeof fixture>>): void {
  const outward = JSON.stringify({ settings: f.readSettings(), frames: f.frames });
  for (const secret of [BROWSER_KEY, MANUAL_KEY, AUTHORIZATION_CODE, OLD_KEY, ...f.verifiers]) {
    expect(outward).not.toContain(secret);
  }
}

describe('OpenRouter connection through the App session protocol', () => {
  it.each(['browser', 'api-key'] as const)(
    'restarts an active %s reconnection and gives later subagents the newly resolved connection',
    async (method) => {
      const f = await fixture(previousSettings());
      try {
        await f.command('reconnect router', {
          'provider-connection-method': method,
          ...(method === 'api-key' ? { 'provider-connection-key': MANUAL_KEY } : {}),
        });
        expect(f.requestRestart).toHaveBeenCalledOnce();
        expect(f.runtimeSession.swapProvider).not.toHaveBeenCalled();
        expect(f.readSettings().currentProvider).toBe('router');
        expect(f.readSettings().providers?.duplicate?.apiKeyRef).toEqual(OLD_REFERENCE);
        const reference = f.readSettings().providers?.router?.apiKeyRef;
        expect(reference).not.toEqual(OLD_REFERENCE);
        const restarted = await f.restart();
        try {
          const config = restarted.bootstrap.config!;
          expect(config.apiKeyRef).toEqual(reference);
          expect(config.apiKey).toBe(method === 'browser' ? BROWSER_KEY : MANUAL_KEY);
          expect(restarted.network).not.toHaveBeenCalled();
          const runtime = createTestProductRuntime('test-product', { HOME: restarted.directory });
          const runnerFactory = createProductSubagentRunnerFactory({
            productRuntime: runtime,
            packContext: { cwd: restarted.directory },
            providerConfig: config,
            providerDefinitions: [restarted.bootstrap.definition],
            reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
            notice: () => {},
          });
          expect(runnerFactory).toBe(createInProcessSubagentRunner);
          const chat = vi.spyOn(restarted.bootstrap.provider, 'chat').mockResolvedValue({
            id: 'new-connection-child-reply',
            role: 'assistant',
            content: 'new connection child completed',
            timestamp: new Date(),
            state: 'complete',
          });
          const runner = runnerFactory({
            config: {
              defaultTrustLevel: 'moderate',
              provider: config,
              permissions: { allow: [], deny: [] },
              env: {},
            },
            context: { agentsMd: '', projectNotesMd: '' },
            tools: [],
            terminal: new PrintTerminal(),
            provider: restarted.bootstrap.provider,
            customAgentRegistry: () => ({
              name: 'connection-test',
              description: 'Fixture child',
              systemPrompt: 'Reply once.',
            }),
          } as never);
          const child = runner.start({
            taskId: 'connection-child',
            request: {
              agentType: 'connection-test',
              prompt: 'Reply with the fixture result.',
              parentSessionId: 'restarted-parent',
              depth: 1,
              cwd: restarted.directory,
            },
          } as never);
          await expect(child.result).resolves.toMatchObject({
            output: 'new connection child completed',
          });
          expect(chat).toHaveBeenCalled();
          expectNoSecrets(restarted);
        } finally {
          await restarted.close();
        }
        expectNoSecrets(f);
      } finally {
        await f.close();
      }
    },
  );
  it('completes browser callback, exchange, validation and host storage before activating the saved service', async () => {
    const f = await fixture();
    try {
      const asks = await f.command('add openrouter', { 'provider-connection-method': 'browser' });
      expect(f.operations).toEqual(['browser', 'exchange', 'validate']);
      expect(asks.some((frame) => frame.event.request.id === 'provider-connection-key')).toBe(
        false,
      );
      expect(asks.some((frame) => frame.event.request.id === 'provider-setup-baseURL')).toBe(false);
      expect(f.readSettings()).toMatchObject({
        currentProvider: 'openrouter',
        providers: {
          openrouter: {
            type: 'openrouter',
            model: MODEL,
            baseURL: ENDPOINT,
            apiKeyRef: { service: 'robota.provider.openrouter' },
          },
        },
      });
      const reference = f.readSettings().providers?.openrouter?.apiKeyRef;
      expect(reference).toBeDefined();
      expect(f.secrets.get(storeKey(reference!))).toBe(BROWSER_KEY);
      expect(f.store.set).toHaveBeenCalledOnce();
      expect(f.runtimeSession.swapProvider).toHaveBeenCalledOnce();
      const [active, activeModel] = f.runtimeSession.swapProvider.mock.calls[0]!;
      expect(active.endpointIsVendorDefault?.()).toBe(false);
      expect(activeModel).toBe(MODEL);
      expect(f.session.getStatusSnapshot().setupRequired).toBeUndefined();
      expectNoSecrets(f);
      await expect(
        visit(new URL(f.opened[0]!.searchParams.get('callback_url')!)),
      ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
      const restarted = await f.restart();
      try {
        expect(restarted.store.get).toHaveBeenCalledWith(reference);
        expect(restarted.network).not.toHaveBeenCalled();
        expect(restarted.openBrowser).not.toHaveBeenCalled();
        await restarted.command('current');
        expect(restarted.runtimeSession.getModelId()).toBe(MODEL);
        expect(restarted.readSettings().currentProvider).toBe('openrouter');
        expect(restarted.runtimeSession.swapProvider).not.toHaveBeenCalled();
        expectNoSecrets(restarted);
      } finally {
        await restarted.close();
      }
    } finally {
      await f.close();
    }
  });

  it('accepts a masked API key in the same service without opening a browser or leaking the answer', async () => {
    const f = await fixture();
    try {
      const asks = await f.command('add openrouter', {
        'provider-connection-method': 'api-key',
        'provider-connection-key': MANUAL_KEY,
      });
      expect(
        asks.find((frame) => frame.event.request.id === 'provider-connection-key')?.event.request,
      ).toMatchObject({ masked: true });
      expect(f.operations).toEqual(['validate']);
      expect(f.openBrowser).not.toHaveBeenCalled();
      expect(f.opened).toEqual([]);
      const reference = f.readSettings().providers?.openrouter?.apiKeyRef;
      expect(reference).toBeDefined();
      expect(f.secrets.get(storeKey(reference!))).toBe(MANUAL_KEY);
      expect(f.runtimeSession.swapProvider).toHaveBeenCalledOnce();
      expectNoSecrets(f);
    } finally {
      await f.close();
    }
  });

  it('requests a restart when adding to a configured session and reuses stored keys in the restarted session', async () => {
    const f = await fixture(previousSettings());
    try {
      await f.command('add openrouter', {
        'provider-connection-method': 'api-key',
        'provider-connection-key': MANUAL_KEY,
      });
      expect(f.requestRestart).toHaveBeenCalledOnce();
      expect(f.runtimeSession.swapProvider).not.toHaveBeenCalled();
      expect(f.readSettings().providers?.router?.apiKeyRef).toEqual(OLD_REFERENCE);
      const restarted = await f.restart();
      try {
        expect(restarted.network).not.toHaveBeenCalled();
        expect(restarted.openBrowser).not.toHaveBeenCalled();
        await restarted.command('switch router');
        expect(restarted.runtimeSession.swapProvider).toHaveBeenCalledOnce();
        expect(restarted.store.get).toHaveBeenCalledWith(OLD_REFERENCE);
        expectNoSecrets(restarted);
      } finally {
        await restarted.close();
      }
      expectNoSecrets(f);
    } finally {
      await f.close();
    }
  });

  it.each(['cancel-button', 'detach'] as const)(
    'closes an unapproved browser callback on %s and preserves the existing connection',
    async (how) => {
      const initial = previousSettings();
      const f = await fixture(initial, { approveBrowser: false });
      try {
        const seen = f.begin('reconnect router');
        const method = await f.waitForAsk('provider-connection-method', seen);
        f.answer(method, { type: 'answer', values: ['browser'] });
        await vi.waitFor(
          () => {
            expect(f.opened).toHaveLength(1);
          },
          { interval: 10 },
        );
        const progress = await f.waitForAsk('provider-connection-progress-', seen);
        if (how === 'detach') {
          f.detach();
        } else {
          const next = f.frames.length;
          f.answer(progress, { type: 'answer', values: ['cancel'] });
          const retry = await f.waitForAsk('provider-connection-method', next);
          f.answer(retry, { type: 'cancelled' });
          await f.waitForResult(seen);
        }
        const callback = new URL(f.opened[0]!.searchParams.get('callback_url')!);
        await vi.waitFor(
          async () => {
            await expect(visit(callback)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
          },
          { interval: 10 },
        );
        expect(f.readSettings()).toEqual(initial);
        expect(f.secrets).toEqual(new Map([[storeKey(OLD_REFERENCE), OLD_KEY]]));
        expect(f.network).not.toHaveBeenCalled();
        expect(f.store.set).not.toHaveBeenCalled();
        expect(f.runtimeSession.swapProvider).not.toHaveBeenCalled();
        expectNoSecrets(f);
      } finally {
        await f.close();
      }
    },
  );
});
