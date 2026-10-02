import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { describeBundleContribution } from '../../contributions/bundle-contribution-descriptor.js';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';

it('describes installed source identity without inventing a foreign manifest version or granting authority', () => {
  const root = mkdtempSync(join(tmpdir(), 'bundle-descriptor-'));
  try {
    const source = join(root, 'cache', 'market', 'installed-name', 'pinned-revision');
    mkdirSync(join(source, '.claude-plugin'), { recursive: true });
    mkdirSync(join(source, 'commands'), { recursive: true });
    writeFileSync(
      join(source, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'foreign-name', mcpServers: './transport.json' }),
    );
    writeFileSync(
      join(source, 'commands', 'observe.md'),
      '---\ndescription: Observe state\n---\nObserve only.',
    );
    writeFileSync(
      join(source, 'transport.json'),
      JSON.stringify({
        mcpServers: { observe: { command: 'fixture', env: { SECRET: 'private-value' } } },
      }),
    );
    const descriptor = new BundlePluginLoader(root).inspectPluginsSync().loaded[0]?.descriptor;
    expect(descriptor).toMatchObject({
      schemaVersion: 1,
      identity: 'installed-name@market',
      installedRevision: 'pinned-revision',
      source: { kind: 'bundle', location: source },
      lifecycle: { activation: 'unadmitted', activeCalls: 'host-owned' },
    });
    expect(descriptor?.contributions).toMatchObject([
      { identity: 'foreign-name:command:observe', kind: 'command' },
      { identity: 'foreign-name:mcp:observe', kind: 'mcp' },
    ]);
    expect(descriptor?.contributions[1]?.source).toBe(join(source, 'transport.json'));
    expect(JSON.stringify(descriptor)).not.toContain('private-value');
    expect(JSON.stringify(descriptor)).not.toContain('SECRET');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('classifies unconsumed declarations and unavailable agents without exposing declaration values', () => {
  const descriptor = describeBundleContribution(
    {
      manifest: { name: 'example', features: {}, commands: './private-value.md' },
      commands: [],
      skills: [],
      hooks: {},
      agents: ['review'],
      pluginDir: '/cache/pinned',
      mcpConfig: { mcpServers: { unusable: { private: 'private-value' } } },
    },
    'example@market',
  );
  expect(descriptor.contributions).toMatchObject([
    { identity: 'example:agent:review', disposition: 'unavailable' },
    { identity: 'example:mcp:unusable', disposition: 'unsupported' },
    { identity: 'example:declaration:commands', disposition: 'unsupported' },
  ]);
  expect(descriptor.diagnostics).toEqual([
    { component: 'mcp', code: 'unsupported-transport' },
    { component: 'commands', code: 'unsupported-component-declaration' },
  ]);
  expect(JSON.stringify(descriptor)).not.toContain('private-value');
});

it('keeps declaration diagnostics distinct from real assets named declared', () => {
  const descriptor = describeBundleContribution(
    {
      manifest: { name: 'fixture', features: {}, commands: './custom', skills: './custom' },
      commands: [{ name: 'fixture:declared', description: 'Observe', skillContent: 'Observe.' }],
      skills: [{ name: 'declared', description: 'Observe', skillContent: 'Observe.' }],
      hooks: {},
      agents: [],
      pluginDir: '/cache/pinned',
    },
    'fixture@market',
  );
  const identities = descriptor.contributions.map((item) => item.identity);
  expect(identities).toEqual([
    'fixture:command:declared',
    'fixture:skill:declared',
    'fixture:declaration:commands',
    'fixture:declaration:skills',
  ]);
  expect(new Set(identities).size).toBe(identities.length);
});
