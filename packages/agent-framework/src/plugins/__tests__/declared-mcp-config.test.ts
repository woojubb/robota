import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';

const roots: string[] = [];
function fixture(declaration: unknown) {
  const root = mkdtempSync(join(tmpdir(), 'declared-mcp-'));
  roots.push(root);
  const source = join(root, 'cache', 'market', 'fixture', 'installed');
  mkdirSync(join(source, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(source, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'fixture', mcpServers: declaration }),
  );
  return { root, source };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('declared MCP contributions', () => {
  it('loads inline servers without requiring a default file', () => {
    const { root, source } = fixture({
      observe: { command: 'fixture-command', args: ['--observe'] },
    });
    const inspection = new BundlePluginLoader(root).inspectPluginsSync();
    expect(inspection.loaded[0]?.mcpConfig).toEqual({
      mcpServers: { observe: { command: 'fixture-command', args: ['--observe'] } },
    });
    expect(inspection.mcpServers).toMatchObject([
      {
        pluginId: 'fixture@market',
        name: 'observe',
        transport: 'stdio',
        mcpPath: join(source, '.claude-plugin', 'plugin.json'),
      },
    ]);
  });
  it('loads default then declared files and inline entries with later names replacing earlier names', () => {
    const { root, source } = fixture(['./extra.json', { observe: { command: 'final-command' } }]);
    writeFileSync(
      join(source, '.mcp.json'),
      JSON.stringify({
        mcpServers: { base: { command: 'base-command' }, observe: { command: 'old-command' } },
      }),
    );
    writeFileSync(
      join(source, 'extra.json'),
      JSON.stringify({
        observe: { command: 'file-command' },
        remote: { url: 'https://fixture.example.test/mcp' },
      }),
    );
    const inspection = new BundlePluginLoader(root).inspectPluginsSync();
    expect(inspection.loaded[0]?.mcpConfig).toEqual({
      mcpServers: {
        base: { command: 'base-command' },
        observe: { command: 'final-command' },
        remote: { url: 'https://fixture.example.test/mcp' },
      },
    });
    expect(inspection.mcpServers.find((server) => server.name === 'remote')?.mcpPath).toBe(
      join(source, 'extra.json'),
    );
    expect(inspection.mcpServers.map((server) => server.name)).toEqual([
      'base',
      'observe',
      'remote',
    ]);
  });
  it('refuses a declared symlink escaping its selected installed revision', () => {
    const { root, source } = fixture('./escape.json');
    writeFileSync(
      join(root, 'outside.json'),
      JSON.stringify({ secret: { command: 'outside-command' } }),
    );
    symlinkSync(join(root, 'outside.json'), join(source, 'escape.json'));
    const inspection = new BundlePluginLoader(root).inspectPluginsSync();
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped).toMatchObject([{ reason: 'load-failed' }]);
  });
});

it.each(['../outside.json', '/absolute.json', './server.mcpb', 17, null])(
  'reports unsupported declarations %j without including raw config',
  (declaration) => {
    const { root } = fixture(declaration);
    const inspection = new BundlePluginLoader(root).inspectPluginsSync();
    expect(inspection.loaded).toEqual([]);
    expect(inspection.skipped[0]?.detail).toMatch(
      /McpContributionError.*(unsupported-path|invalid-object)/,
    );
  },
);

it('preserves an inline server literally named mcpServers', () => {
  const { root } = fixture({ mcpServers: { command: 'node', args: ['server.mjs'] } });
  const inspection = new BundlePluginLoader(root).inspectPluginsSync();
  expect(inspection.loaded[0]?.mcpConfig).toEqual({
    mcpServers: { mcpServers: { command: 'node', args: ['server.mjs'] } },
  });
  expect(inspection.mcpServers.map((server) => server.name)).toEqual(['mcpServers']);
});
