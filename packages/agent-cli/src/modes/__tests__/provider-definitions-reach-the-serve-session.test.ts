/**
 * #3282 §1 — a served session (`robota daemon start`, `robota --serve`) needs the same provider
 * definitions the TUI gets.
 *
 * `buildServeSessionOptions` never forwarded `providerDefinitions`, so a served session's
 * `/provider switch` throws `Unknown provider: <name>. Currently supported: ` — an empty
 * supported-list — while `provider-command-profile-operations.ts` had ALREADY written the new
 * `currentProvider` to disk. The TUI carries this since #1844 (see
 * `packages/agent-ui-terminal/src/__tests__/provider-definitions-reach-the-session.test.ts` and the
 * comment on `providerDefinitions` in `tui-channel-options.ts`); this is the same gap in serve mode.
 *
 * Each hop is asserted separately, and the last case drives the actual host-action pipeline through
 * a session built the way `runServeMode` builds one — a forward that stops at either hop reproduces
 * exactly this bug, so an end-to-end assertion alone would not say WHERE it stopped.
 */

import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession, createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { createProviderCommandModule } from '@robota-sdk/agent-command';

import { buildServeSessionOptions } from '../serve-mode.js';

import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IProviderCommandSettingsAdapter,
  TProviderSettingsDocument,
} from '@robota-sdk/agent-framework';

const DEFINITIONS: readonly IProviderDefinition[] = [
  {
    type: 'acme-a',
    displayName: 'Acme A',
    createProvider: (config) => ({ name: 'acme-a', model: config.model }) as unknown as IAIProvider,
  },
  {
    type: 'acme-b',
    displayName: 'Acme B',
    createProvider: (config) => ({ name: 'acme-b', model: config.model }) as unknown as IAIProvider,
  },
];

describe('#3282 — provider definitions reach a served session', () => {
  it('buildServeSessionOptions forwards them into the session options', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
      providerDefinitions: DEFINITIONS,
    } as never);

    expect(options).toHaveProperty('providerDefinitions', DEFINITIONS);
  });

  it('omits the key entirely when none were supplied, rather than setting an empty list', () => {
    // An explicit `[]` would look like "the caller supplied none" and read as configured. Absent is
    // the honest shape for "this surface did not provide them" — see the identical reasoning in the
    // TUI's own version of this case.
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: { noSessionPersistence: true } as never,
      preset: {},
    } as never);

    expect('providerDefinitions' in options).toBe(false);
  });

  it('a session built like a served session switches profiles and the next turn uses the new one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'robota-3282-serve-switch-'));
    try {
      const settingsPath = join(dir, 'settings.json');
      const readDoc = (): TProviderSettingsDocument =>
        JSON.parse(readFileSync(settingsPath, 'utf8')) as TProviderSettingsDocument;
      writeFileSync(
        settingsPath,
        JSON.stringify({
          currentProvider: 'first',
          providers: {
            first: { type: 'acme-a', model: 'model-a' },
            second: { type: 'acme-b', model: 'model-b' },
          },
        }),
        'utf8',
      );

      const settingsAdapter: IProviderCommandSettingsAdapter = {
        readMergedSettings: readDoc,
        readTargetSettings: readDoc,
        writeTargetSettings: (next) => writeFileSync(settingsPath, JSON.stringify(next), 'utf8'),
      };

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
        getSessionId: () => 'sess-3282',
        getMessageCount: () => 0,
        getSystemMessage: vi.fn().mockReturnValue('system'),
        getToolSchemas: vi.fn().mockReturnValue([]),
        getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
        swapProvider: vi.fn(),
      };

      // Built exactly the way `runServeMode` builds a served session's options — `providerDefinitions`
      // included (the fix) and a `/provider` command module sharing the same definitions and the same
      // settings file the CLI composition root wires both to.
      const sessionOptions = buildServeSessionOptions({
        cwd: dir,
        args: { noSessionPersistence: true } as never,
        preset: {},
        provider: DEFINITIONS[0]!.createProvider({ name: 'acme-a', model: 'model-a' }),
        providerDefinitions: DEFINITIONS,
        commandModules: [
          createProviderCommandModule({ providerDefinitions: DEFINITIONS, settings: settingsAdapter }),
        ],
        commandHostAdapters: {},
        backgroundTaskRunners: [],
      } as never);

      const session = new InteractiveSession({
        ...sessionOptions,
        session: runtimeSession,
        userSettingsSources: [createNodeHostSettingsSource('user', settingsPath)],
      } as never);

      const result = await session.executeCommand('provider', 'switch second');

      expect(result?.success).toBe(true);
      expect(runtimeSession.swapProvider).toHaveBeenCalledTimes(1);
      const [swapped, model] = runtimeSession.swapProvider.mock.calls[0]!;
      expect(model).toBe('model-b');
      expect((swapped as { name: string }).name).toBe('acme-b');
      expect(readDoc().currentProvider).toBe('second');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
