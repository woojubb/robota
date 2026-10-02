import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const path = mkdtempSync(join(tmpdir(), 'bundle-compatibility-'));
  roots.push(path);
  return path;
}
function json(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value));
}
function bundle(pluginsDir: string, revision: string, manifest: unknown = { name: 'external' }) {
  const path = join(pluginsDir, 'cache', 'market', 'external', revision);
  mkdirSync(join(path, '.claude-plugin'), { recursive: true });
  json(join(path, '.claude-plugin', 'plugin.json'), manifest);
  return path;
}
describe('external bundle compatibility', () => {
  it('loads a name-only manifest without inventing a version', () => {
    const pluginsDir = root();
    const path = bundle(pluginsDir, 'source-abc');
    mkdirSync(join(path, 'skills', 'observe'), { recursive: true });
    writeFileSync(
      join(path, 'skills', 'observe', 'SKILL.md'),
      '---\ndescription: Observe fixture state\n---\nRead current state.',
    );
    const loaded = new BundlePluginLoader(pluginsDir).loadPluginsSync();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.manifest.version).toBeUndefined();
    expect(loaded[0]!.skills[0]!.description).toBe('Observe fixture state');
  });
  it('loads the installed revision even when a lexically later cache exists', () => {
    const pluginsDir = root();
    const installed = bundle(pluginsDir, '1.10', {
      name: 'external',
      version: '1.10',
      description: 'installed',
    });
    bundle(pluginsDir, '9.0', { name: 'external', version: '9.0', description: 'unselected' });
    json(join(pluginsDir, 'installed_plugins.json'), {
      'external@market': {
        pluginName: 'external',
        marketplace: 'market',
        version: '1.10',
        installPath: installed,
        installedAt: 'fixture',
      },
    });
    const loaded = new BundlePluginLoader(pluginsDir).loadPluginsSync();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.pluginDir).toBe(installed);
  });
  it('refuses ambiguous unselected revisions instead of guessing', () => {
    const pluginsDir = root();
    for (const revision of ['1.0', '2.0'])
      bundle(pluginsDir, revision, { name: 'external', version: revision, description: 'fixture' });
    const inspection = new BundlePluginLoader(pluginsDir).inspectPluginsSync();
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped[0]!.reason).toBe('revision-unselected');
  });
  it.each(['corrupt', 'wrong-path', 'missing-source', 'orphan'])(
    'refuses %s installed records without falling back to cache',
    (variant) => {
      const pluginsDir = root();
      const path = bundle(pluginsDir, 'source-abc', {
        name: 'external',
        version: 'fixture',
        description: 'fixture',
      });
      const registryPath = join(pluginsDir, 'installed_plugins.json');
      if (variant === 'corrupt') writeFileSync(registryPath, '{');
      else
        json(
          registryPath,
          variant === 'orphan'
            ? {}
            : {
                'external@market': {
                  pluginName: 'external',
                  marketplace: 'market',
                  version: variant === 'missing-source' ? 'missing' : 'source-abc',
                  installPath: variant === 'wrong-path' ? root() : path,
                },
              },
        );
      const inspection = new BundlePluginLoader(pluginsDir).inspectPluginsSync();
      expect(inspection.loaded).toEqual([]);
      expect(inspection.skipped[0]!.reason).toBe('revision-unselected');
    },
  );
  it('refuses a cached source symlink outside its plugin cache', () => {
    const pluginsDir = root();
    const external = root();
    mkdirSync(join(external, '.claude-plugin'));
    json(join(external, '.claude-plugin', 'plugin.json'), {
      name: 'external',
      version: 'fixture',
      description: 'fixture',
    });
    const parent = join(pluginsDir, 'cache', 'market', 'external');
    mkdirSync(parent, { recursive: true });
    symlinkSync(external, join(parent, 'source-abc'), 'dir');
    const inspection = new BundlePluginLoader(pluginsDir).inspectPluginsSync();
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped[0]!.reason).toBe('revision-unselected');
  });
  it('respects disabled installed identity even when a foreign manifest uses another name', () => {
    const pluginsDir = root();
    bundle(pluginsDir, 'source-abc', {
      name: 'renamed',
      version: 'fixture',
      description: 'fixture',
    });
    const inspection = new BundlePluginLoader(pluginsDir, {
      'external@market': false,
    }).inspectPluginsSync();
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped[0]!.reason).toBe('disabled');
  });
  it.each(['manifest', 'plugin-directory'])('diagnoses a missing selected %s', (missing) => {
    const pluginsDir = root();
    const path = bundle(pluginsDir, 'source-abc');
    json(join(pluginsDir, 'installed_plugins.json'), {
      'external@market': {
        pluginName: 'external',
        marketplace: 'market',
        version: 'source-abc',
        installPath: path,
      },
    });
    rmSync(
      missing === 'manifest' ? join(path, '.claude-plugin', 'plugin.json') : join(path, '..'),
      { recursive: true, force: true },
    );
    const inspection = new BundlePluginLoader(pluginsDir).inspectPluginsSync();
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped).toEqual([
      expect.objectContaining({
        pluginId: 'external@market',
        reason: missing === 'manifest' ? 'manifest-unreadable' : 'revision-unselected',
      }),
    ]);
  });
});
