/**
 * PLG-021 / issue #2025 — a loader built through the composition root honours `enabledPlugins`.
 *
 * The defect these pin is not "the filter is broken". `BundlePluginLoader.isDisabled` was correct all
 * along, and `bundle-plugin-loader.test.ts` proves it. The defect is that every production site
 * constructed the loader WITHOUT the map, and a missing map defaults to `{}`, under which
 * "not listed" means enabled — so a disabled plugin loaded and the UI still said it was disabled.
 *
 * So these assert on the OUTCOME of a real load through the factory, not that the factory passes an
 * argument. "The map is forwarded" is satisfied by forwarding an empty one.
 */

import { writeFileSync, mkdirSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createHostBundlePluginLoader } from '../host-bundle-plugin-loader.js';

import type { IBundlePluginManifest } from '../bundle-plugin-types.js';

const TMP_BASE = mkdtempSync(join(tmpdir(), 'robota-host-plugin-loader-'));

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function createPlugin(pluginsDir: string, market: string, name: string): void {
  const manifest: IBundlePluginManifest = {
    name,
    version: '1.0.0',
    description: `${name} fixture`,
    features: { skills: true },
  };
  const metaDir = join(pluginsDir, 'cache', market, name, '1.0.0', '.claude-plugin');
  mkdirSync(metaDir, { recursive: true });
  writeJson(join(metaDir, 'plugin.json'), manifest);
}

describe('createHostBundlePluginLoader (PLG-021 / issue #2025)', () => {
  let root: string;
  let pluginsDir: string;
  let settingsPath: string;

  beforeEach(() => {
    root = join(TMP_BASE, 'run-' + Math.random().toString(36).slice(2));
    pluginsDir = join(root, 'plugins');
    settingsPath = join(root, 'settings.json');
    mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it('does not load a plugin the settings file records as disabled', async () => {
    createPlugin(pluginsDir, 'market', 'suspicious-plugin');
    writeJson(settingsPath, { enabledPlugins: { 'suspicious-plugin@market': false } });

    const plugins = await createHostBundlePluginLoader({ pluginsDir, settingsPath }).loadAll();

    expect(plugins).toHaveLength(0);
  });

  it('loads a plugin the settings file records as enabled', async () => {
    createPlugin(pluginsDir, 'market', 'wanted-plugin');
    writeJson(settingsPath, { enabledPlugins: { 'wanted-plugin@market': true } });

    const plugins = await createHostBundlePluginLoader({ pluginsDir, settingsPath }).loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('wanted-plugin');
  });

  it('re-enabling restores exactly the contribution that disabling removed', async () => {
    createPlugin(pluginsDir, 'market', 'toggled-plugin');

    writeJson(settingsPath, { enabledPlugins: { 'toggled-plugin@market': false } });
    const whileDisabled = await createHostBundlePluginLoader({
      pluginsDir,
      settingsPath,
    }).loadAll();

    writeJson(settingsPath, { enabledPlugins: { 'toggled-plugin@market': true } });
    const whileEnabled = await createHostBundlePluginLoader({ pluginsDir, settingsPath }).loadAll();

    expect(whileDisabled).toHaveLength(0);
    expect(whileEnabled.map((p) => p.manifest.name)).toEqual(['toggled-plugin']);
  });

  it('reads the map from disk each time, so a disable made after one load takes effect on the next', async () => {
    createPlugin(pluginsDir, 'market', 'later-disabled');
    writeJson(settingsPath, { enabledPlugins: {} });

    const before = await createHostBundlePluginLoader({ pluginsDir, settingsPath }).loadAll();
    writeJson(settingsPath, { enabledPlugins: { 'later-disabled@market': false } });
    const after = await createHostBundlePluginLoader({ pluginsDir, settingsPath }).loadAll();

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(0);
  });

  it('an absent settings file leaves plugins enabled, which is the documented default', async () => {
    createPlugin(pluginsDir, 'market', 'untouched-plugin');

    const plugins = await createHostBundlePluginLoader({ pluginsDir, settingsPath }).loadAll();

    expect(plugins).toHaveLength(1);
  });

  it('an explicitly supplied map is used instead of reading the file', async () => {
    createPlugin(pluginsDir, 'market', 'caller-disabled');
    // The file says enabled; the caller says disabled. The caller holds the newer answer — this is
    // the adapter's case, where the settings store was already read a few lines earlier.
    writeJson(settingsPath, { enabledPlugins: { 'caller-disabled@market': true } });

    const plugins = await createHostBundlePluginLoader({
      pluginsDir,
      settingsPath,
      enabledPlugins: { 'caller-disabled@market': false },
    }).loadAll();

    expect(plugins).toHaveLength(0);
  });
});
