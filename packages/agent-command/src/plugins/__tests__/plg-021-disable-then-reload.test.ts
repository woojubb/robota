/**
 * PLG-021 / issue #2025 — disabling a plugin and reloading in the SAME process must not load it.
 *
 * `packages/agent-framework` already pins that a loader built per call sees a disable made after the
 * previous load, and that a cached one does not. Neither of those proves that THIS adapter builds a
 * loader per call — and it did not: the first fix here cached one instance holding the enablement
 * snapshot taken when the services object was built, so `disable()` wrote to disk and
 * `reloadPlugins()` kept reporting the plugin as loaded.
 *
 * That is PLG-021 one step over: not a MISSING enablement map, a STALE one, with an identical
 * symptom. So this drives the real adapter end to end rather than asserting on its shape — a test
 * that checked "createLoader is a function" would pass against `() => cached`.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createDefaultPluginCommandAdapter } from '../default-plugin-command-adapter.js';

const PLUGIN = 'stale-map-plugin';
const MARKET = 'test-market';

let home: string;
let originalHome: string | undefined;

function writePluginBundle(): void {
  const metaDir = join(
    home,
    '.robota',
    'plugins',
    'cache',
    MARKET,
    PLUGIN,
    '1.0.0',
    '.claude-plugin',
  );
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, 'plugin.json'),
    JSON.stringify({ name: PLUGIN, version: '1.0.0', description: 'fixture', features: {} }),
    'utf-8',
  );
}

function settingsPath(): string {
  return join(home, '.robota', 'settings.json');
}

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-plg021-')));
  originalHome = process.env.HOME;
  process.env.HOME = home;
  writePluginBundle();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (existsSync(home)) rmSync(home, { recursive: true, force: true });
});

describe('PLG-021: disable then reload, in one process', () => {
  it('a plugin disabled through the adapter is not loaded by a later reload', async () => {
    const adapter = createDefaultPluginCommandAdapter(home);

    const before = await adapter.reloadPlugins();
    expect(before.loadedPluginCount).toBe(1);

    await adapter.disable(`${PLUGIN}@${MARKET}`);

    const after = await adapter.reloadPlugins();
    expect(after.loadedPluginCount).toBe(0);
  });

  it('the disable actually reached disk, so the assertion above is about the loader and not the write', async () => {
    const adapter = createDefaultPluginCommandAdapter(home);
    await adapter.disable(`${PLUGIN}@${MARKET}`);

    // Without this, `loadedPluginCount === 0` could mean "disable silently did nothing and the
    // bundle vanished" as easily as "the reload honoured the disable".
    const settings: unknown = JSON.parse(readFileSync(settingsPath(), 'utf-8'));
    expect(settings).toMatchObject({ enabledPlugins: { [`${PLUGIN}@${MARKET}`]: false } });
  });

  it('re-enabling in the same process brings it back', async () => {
    const adapter = createDefaultPluginCommandAdapter(home);
    await adapter.disable(`${PLUGIN}@${MARKET}`);
    expect((await adapter.reloadPlugins()).loadedPluginCount).toBe(0);

    await adapter.enable(`${PLUGIN}@${MARKET}`);
    expect((await adapter.reloadPlugins()).loadedPluginCount).toBe(1);
  });
});
