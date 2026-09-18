import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BundlePluginLoader } from '../bundle-plugin-loader.js';
import { loadHostBundlePluginInspectionFromScopes } from '../host-bundle-plugin-loader.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function pluginsDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'robota-plugin-inspection-'));
  roots.push(root);
  return root;
}

function install(
  dir: string,
  name: string,
  files: Record<string, string>,
  marketplace = 'fixture-market',
): string {
  const versionDir = join(dir, 'cache', marketplace, name, '1.0.0');
  for (const [relative, content] of Object.entries(files)) {
    const path = join(versionDir, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
  return versionDir;
}

const MANIFEST = (name: string) =>
  JSON.stringify({ name, version: '1.0.0', description: 'doctor fixture' });

describe('BundlePluginLoader.inspectPluginsSync (OBSERVABILITY-1991 TC-05)', () => {
  it('reports an absent cache directory without inventing plugins', () => {
    const dir = pluginsDir();
    const inspection = new BundlePluginLoader(dir).inspectPluginsSync();
    expect(inspection.cacheDirPresent).toBe(false);
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped).toEqual([]);
  });

  it('names each skipped plugin with its manifest path and reason, and still loads the others', () => {
    const dir = pluginsDir();
    const broken = install(dir, 'broken-plugin', { '.claude-plugin/plugin.json': '{' });
    install(dir, 'shapeless', { '.claude-plugin/plugin.json': '{"name":"shapeless"}' });
    install(dir, 'good', { '.claude-plugin/plugin.json': MANIFEST('good') });
    install(dir, 'off', { '.claude-plugin/plugin.json': MANIFEST('off') });

    const loader = new BundlePluginLoader(dir, { 'off@fixture-market': false });
    const inspection = loader.inspectPluginsSync();
    expect(inspection.loaded.map((plugin) => plugin.manifest.name)).toEqual(['good']);
    expect(inspection.skipped).toEqual([
      expect.objectContaining({
        pluginId: 'broken-plugin@fixture-market',
        manifestPath: join(broken, '.claude-plugin', 'plugin.json'),
        reason: 'manifest-unreadable',
      }),
      expect.objectContaining({ pluginId: 'off@fixture-market', reason: 'disabled' }),
      expect.objectContaining({ pluginId: 'shapeless@fixture-market', reason: 'manifest-invalid' }),
    ]);
    // The projection is unchanged: loadPluginsSync returns exactly the loaded set.
    expect(loader.loadPluginsSync().map((plugin) => plugin.manifest.name)).toEqual(['good']);
  });

  it('types .mcp.json servers with env KEY names only and validates hooks.json report-only', () => {
    const dir = pluginsDir();
    const versionDir = install(dir, 'mcp-plugin', {
      '.claude-plugin/plugin.json': MANIFEST('mcp-plugin'),
      '.mcp.json': JSON.stringify({
        mcpServers: {
          ghost: {
            command: 'robota-doctor-missing-binary',
            env: { GHOST_TOKEN: 'sk-doctor-marker-mcp-9f8e7d' },
          },
          remote: { url: 'https://mcp.example/sse' },
        },
      }),
      'hooks/hooks.json': JSON.stringify({
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command' }] }],
      }),
    });
    const inspection = new BundlePluginLoader(dir).inspectPluginsSync();
    expect(inspection.loaded).toHaveLength(1);
    expect(inspection.mcpServers).toEqual([
      {
        pluginId: 'mcp-plugin@fixture-market',
        mcpPath: join(versionDir, '.mcp.json'),
        name: 'ghost',
        transport: 'stdio',
        command: 'robota-doctor-missing-binary',
        envKeys: ['GHOST_TOKEN'],
      },
      {
        pluginId: 'mcp-plugin@fixture-market',
        mcpPath: join(versionDir, '.mcp.json'),
        name: 'remote',
        transport: 'http',
        url: 'https://mcp.example/sse',
        envKeys: [],
      },
    ]);
    // `loaded` is the runtime shape (its raw `mcpConfig` is what the session consumes); the
    // inspection's OWN fields carry keys only.
    const { loaded: _loaded, ...facts } = inspection;
    expect(JSON.stringify(facts)).not.toContain('sk-doctor-marker');
    expect(inspection.hookIssues).toEqual([
      {
        pluginId: 'mcp-plugin@fixture-market',
        hooksPath: join(versionDir, 'hooks', 'hooks.json'),
        issues: [{ path: 'PreToolUse.0.hooks.0.command', code: 'invalid_type' }],
      },
    ]);
  });

  it('inspects every scope directory in order without deduplicating shadowed plugins', () => {
    const project = pluginsDir();
    const user = pluginsDir();
    install(project, 'dup', { '.claude-plugin/plugin.json': MANIFEST('dup') });
    install(user, 'dup', { '.claude-plugin/plugin.json': MANIFEST('dup') });
    const inspections = loadHostBundlePluginInspectionFromScopes([project, user], {
      enabledPlugins: {},
    });
    expect(inspections.map((inspection) => inspection.pluginsDir)).toEqual([project, user]);
    expect(inspections.map((inspection) => inspection.loaded.length)).toEqual([1, 1]);
  });
});
