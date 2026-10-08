import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProviderCommandModule } from '@robota-sdk/agent-command';
import {
  createNodeHostSettingsSource,
  InteractiveSession,
  type IProviderCommandSettingsAdapter,
  type TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';
import { createGemmaProviderDefinition } from '@robota-sdk/agent-provider-openai-compatible';
import {
  createOutboundDelivery,
  createSessionMessageHandler,
  type TServerMessage,
} from '@robota-sdk/agent-transport';
import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createSetupPlaceholderProvider } from '../../startup/setup-placeholder-provider.js';
import { buildServeSessionOptions } from '../serve-mode.js';

type AskFrame = Extract<TServerMessage, { type: 'ask_request' }>;

function fixture(initialSettings: TProviderSettingsDocument = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'local-provider-setup-'));
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
    writeTargetSettings: (next) => writeFileSync(settingsPath, JSON.stringify(next)),
  };
  const definition = createGemmaProviderDefinition();
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
    getSessionId: () => 'local-setup-session',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
    getModelId: () => 'setup-required',
    getPermissionMode: () => 'default',
    getModelEffort: () => 'auto',
    swapProvider: vi.fn(),
  };
  const session = new InteractiveSession({
    ...buildServeSessionOptions({
      productRuntime: createTestProductRuntime('test-product', { HOME: home }),
      cwd: directory,
      args: { noSessionPersistence: true },
      preset: {},
      setupRequired: initialSettings.currentProvider === undefined,
      provider: createSetupPlaceholderProvider(),
      providerDefinitions: [definition],
      userSettingsSources: [createNodeHostSettingsSource('user', settingsPath)],
      commandModules: [
        createProviderCommandModule({ providerDefinitions: [definition], settings }),
      ],
      commandHostAdapters: {},
      backgroundTaskRunners: [],
    } as never),
    session: runtimeSession,
  } as never);
  const frames: TServerMessage[] = [];
  const handler = createSessionMessageHandler({
    session,
    deliver: createOutboundDelivery(
      (message) => frames.push(message),
      (error) => {
        throw error;
      },
    ),
    driverId: 'desktop-local-setup',
  });

  return {
    session,
    runtimeSession,
    readSettings,
    async command(args: string, answers: Readonly<Record<string, string>> = {}) {
      const seen = frames.length;
      handler.onMessage(JSON.stringify({ type: 'command', name: 'provider', args }));
      const answered = new Set<string>();
      await vi.waitFor(() => {
        for (const frame of frames.slice(seen)) {
          if (frame.type !== 'ask_request' || answered.has(frame.event.id)) continue;
          answered.add(frame.event.id);
          handler.onMessage(
            JSON.stringify({
              type: 'ask-response',
              id: frame.event.id,
              response: {
                type: 'answer',
                values: [],
                text: answers[frame.event.request.id] ?? '',
              },
            }),
          );
        }
        expect(frames.slice(seen).some((frame) => frame.type === 'command_result')).toBe(true);
      });
      const current = frames.slice(seen);
      const asks = current.filter((frame): frame is AskFrame => frame.type === 'ask_request');
      const result = current.find((frame) => frame.type === 'command_result');
      expect(result).toMatchObject({ type: 'command_result', success: true });
      expect(current.filter((frame) => frame.type === 'protocol_error')).toEqual([]);
      return asks;
    },
    async close() {
      handler.cleanup();
      try {
        await session.shutdown();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

describe('local provider setup through the App session protocol', () => {
  it('adds a local profile using only endpoint and model, then activates it without a key', async () => {
    const f = fixture();
    try {
      const asks = await f.command('add gemma', {
        'provider-setup-baseURL': 'http://127.0.0.1:1234/v1',
        'provider-setup-model': 'installed-local-model',
      });
      expect(asks.map((frame) => frame.event.request.id)).toEqual([
        'provider-setup-baseURL',
        'provider-setup-model',
      ]);
      expect(f.readSettings()).toMatchObject({
        currentProvider: 'gemma',
        providers: {
          gemma: {
            type: 'gemma',
            model: 'installed-local-model',
            baseURL: 'http://127.0.0.1:1234/v1',
          },
        },
      });
      expect(f.readSettings().providers?.gemma).not.toHaveProperty('apiKey');
      expect(f.runtimeSession.swapProvider).toHaveBeenCalledOnce();
      expect(f.session.getStatusSnapshot().setupRequired).toBeUndefined();
    } finally {
      await f.close();
    }
  });

  it('allows an empty optional masked key while editing a keyless local profile', async () => {
    const f = fixture({
      currentProvider: 'local',
      providers: {
        local: {
          type: 'gemma',
          model: 'installed-local-model',
          baseURL: 'http://127.0.0.1:1234/v1',
        },
      },
    });
    try {
      const asks = await f.command('edit local');
      const key = asks.find((frame) => frame.event.request.id === 'provider-setup-apiKey');
      expect(key?.event.request).toMatchObject({ masked: true, allowEmpty: true });
      expect(f.readSettings().providers?.local).not.toHaveProperty('apiKey');
      expect(f.readSettings().providers?.local?.baseURL).toBe('http://127.0.0.1:1234/v1');
      expect(f.runtimeSession.swapProvider).toHaveBeenCalledOnce();
    } finally {
      await f.close();
    }
  });

  it('stores an explicit local server token and retains it when a later edit leaves the masked field blank', async () => {
    const f = fixture({
      currentProvider: 'local',
      providers: {
        local: {
          type: 'gemma',
          model: 'installed-local-model',
          baseURL: 'http://127.0.0.1:1234/v1',
        },
      },
    });
    try {
      await f.command('edit local', { 'provider-setup-apiKey': 'synthetic-local-server-token' });
      expect(f.readSettings().providers?.local?.apiKey).toBe('synthetic-local-server-token');
      const asks = await f.command('edit local');
      const key = asks.find((frame) => frame.event.request.id === 'provider-setup-apiKey');
      expect(key?.event.request.placeholder).toBe('(unchanged)');
      expect(JSON.stringify(asks)).not.toContain('synthetic-local-server-token');
      expect(f.readSettings().providers?.local).toMatchObject({
        apiKey: 'synthetic-local-server-token',
        baseURL: 'http://127.0.0.1:1234/v1',
      });
    } finally {
      await f.close();
    }
  });
});
