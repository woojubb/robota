import { createTestProductRuntime } from './helpers/product-runtime.js';
/**
 * #3282 §1 — a `/provider switch` that fails must change nothing on disk.
 *
 * Before this change, `provider-command-profile-operations.ts`'s `buildProviderSwitch` wrote the new
 * `currentProvider` to the target settings file BEFORE the `provider-hot-swap` host action tried to
 * build the provider it names. A hot-swap that then failed (unknown provider, missing model, missing
 * credential — anything `resolveUserSettingsProviderSwitch` can throw) left the write standing: the
 * command reported failure while `settings.json` already pointed at the profile that could not load,
 * and the next daemon start would silently use it. Reproduced here with a profile whose provider type
 * `createDefaultProviderDefinitions()` does not know, the same shape of failure the issue reports
 * ("Unknown provider: anthropic. Currently supported: ").
 *
 * Runs the CLI's own command-setup composition root against a real settings file under a temporary
 * HOME (AGENTS.md: a script or test that runs the CLI points HOME at a temporary directory).
 */

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { buildCommandSetup } from '../startup/command-setup.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;
const homes: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function homeWithSettings(settings: unknown): { home: string; settingsPath: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'issue-3282-home-')));
  homes.push(home);
  mkdirSync(join(home, '.test-product'), { recursive: true });
  const settingsPath = join(home, '.test-product', 'settings.json');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  return { home, settingsPath };
}

describe('#3282: a failing /provider switch changes nothing on disk', () => {
  it('leaves settings.json exactly as it was, and does not claim success', async () => {
    const before = {
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6', apiKey: '$ENV:ANTHROPIC_API_KEY' },
        broken: { type: 'not-a-real-provider', model: 'whatever' },
      },
    };
    const { home, settingsPath } = homeWithSettings(before);
    const rawBefore = readFileSync(settingsPath, 'utf8');
    vi.stubEnv('HOME', home);

    const setup = buildCommandSetup(home, MINIMAL_ARGS, { productRuntime: createTestProductRuntime('test-product', { HOME: home }) }, '0.0.0-test');
    const provider = setup.baseCommandModules.find((m) => m.name === 'agent-command-provider');
    if (provider === undefined) throw new Error('the provider command module was not built');
    const executor = new SystemCommandExecutor([...(provider.systemCommands ?? [])]);

    const result = await executor.execute('provider', createTestCommandHost(), 'switch broken');

    expect(result?.success).toBe(false);
    expect(result?.message ?? '').not.toMatch(/Switched to/);
    expect(result?.hostActions).toBeUndefined();
    expect(readFileSync(settingsPath, 'utf8')).toBe(rawBefore);
  });
});
