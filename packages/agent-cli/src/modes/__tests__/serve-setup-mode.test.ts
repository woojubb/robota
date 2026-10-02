import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * #3282 §3 — a served runtime with no provider configured starts in setup mode instead of exiting:
 * `buildServeSessionOptions` forwards `setupRequired` into the session options, and a session built
 * that way refuses a submitted turn, reports `setupRequired` in its status, and — once `/provider add`
 * configures the first profile ever — hot-swaps into it and clears the flag, live, no restart.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createProviderCommandModule } from '@robota-sdk/agent-command';
import { InteractiveSession, createNodeHostSettingsSource } from '@robota-sdk/agent-framework';

import { buildServeSessionOptions } from '../serve-mode.js';
import { createSetupPlaceholderProvider } from '../../startup/setup-placeholder-provider.js';

import type { IProviderCommandSettingsAdapter, TProviderSettingsDocument } from '@robota-sdk/agent-framework';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type { TActionResponse } from '@robota-sdk/agent-core';

describe('#3282 §3 — a served runtime starts in setup mode with no provider', () => {
  it('buildServeSessionOptions forwards setupRequired', () => {
    const options = buildServeSessionOptions({productRuntime: createTestProductRuntime(),
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      setupRequired: true,
    } as never);

    expect(options).toHaveProperty('setupRequired', true);
  });

  it('omits the key entirely when setup is not required, rather than setting it false', () => {
    const options = buildServeSessionOptions({productRuntime: createTestProductRuntime(),
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
    } as never);

    expect('setupRequired' in options).toBe(false);
  });

  it('a session built like a served runtime refuses a turn, then hot-swaps live once /provider add configures the first profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-product-3282-setup-mode-'));
    try {
      const settingsPath = join(dir, 'settings.json');
      const readDoc = (): TProviderSettingsDocument =>
        JSON.parse(readFileSync(settingsPath, 'utf8')) as TProviderSettingsDocument;
      writeFileSync(settingsPath, JSON.stringify({}), 'utf8');

      const settingsAdapter: IProviderCommandSettingsAdapter = {
        readMergedSettings: readDoc,
        readTargetSettings: readDoc,
        writeTargetSettings: (next) => writeFileSync(settingsPath, JSON.stringify(next), 'utf8'),
      };
      const definitions: readonly IProviderDefinition[] = [
        {
          type: 'acme',
          displayName: 'Acme',
          defaults: { model: 'acme-default-model' },
          createProvider: (config) => ({ name: 'acme', model: config.model }) as unknown as IAIProvider,
        },
      ];

      const runtimeSession = {
        run: vi.fn(),
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
        getSessionId: () => 'sess-setup',
        getMessageCount: () => 0,
        getSystemMessage: vi.fn().mockReturnValue('system'),
        getToolSchemas: vi.fn().mockReturnValue([]),
        getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
        getModelId: () => 'setup-required',
        getPermissionMode: () => 'default',
        getModelEffort: () => 'auto',
        swapProvider: vi.fn(),
      };

      // Built exactly the way `runServeMode` builds a served session's options in setup mode: the
      // placeholder provider, `setupRequired: true`, and a `/provider` command module sharing the
      // same settings file this session reads its provider from.
      const sessionOptions = buildServeSessionOptions({productRuntime: createTestProductRuntime(),
        cwd: dir,
        args: { noSessionPersistence: true } as never,
        preset: {},
        provider: createSetupPlaceholderProvider(),
        providerDefinitions: definitions,
        setupRequired: true,
        commandModules: [
          createProviderCommandModule({ providerDefinitions: definitions, settings: settingsAdapter }),
        ],
        commandHostAdapters: {},
        backgroundTaskRunners: [],
      } as never);

      const session = new InteractiveSession({
        ...sessionOptions,
        session: runtimeSession,
        userSettingsSources: [createNodeHostSettingsSource('user', settingsPath)],
      } as never);

      expect(session.getStatusSnapshot().setupRequired).toBe(true);
      await expect(session.submit('are you there')).rejects.toThrow(
        'Connect a model provider to start.',
      );
      expect(runtimeSession.run).not.toHaveBeenCalled();

      // The setup flow's one step (model) has a default, so an empty answer completes it.
      session.on('ask_request', (event) => {
        const answer: TActionResponse = { type: 'answer', values: [], text: '' };
        session.resolveAsk(event.id, answer);
      });

      const result = await session.executeCommand('provider', 'add acme');

      expect(result?.success).toBe(true);
      // The first profile ever configured hot-swaps the running placeholder in — never a restart.
      expect(runtimeSession.swapProvider).toHaveBeenCalledTimes(1);
      const [swapped] = runtimeSession.swapProvider.mock.calls[0]!;
      expect((swapped as { name: string }).name).toBe('acme');
      expect(readDoc().currentProvider).toBe('acme');
      expect(session.getStatusSnapshot().setupRequired).toBeUndefined();
      // Setup mode is over: a submit no longer hits the guard (it now reaches the real, swapped-in
      // provider through the normal turn pipeline, which this minimal fixture does not drive further).
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
