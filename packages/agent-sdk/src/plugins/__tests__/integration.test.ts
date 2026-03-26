import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';
import type { IBundlePluginManifest } from '../bundle-plugin-types.js';

const TMP_BASE = join(tmpdir(), 'robota-bundle-integration-' + process.pid);

function setupDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function writeFile(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
}

/**
 * Create a plugin structure in the cache directory.
 * Path: `<pluginsDir>/cache/<marketplace>/<pluginName>/<version>/`
 */
function createPluginInCache(
  pluginsDir: string,
  marketplace: string,
  pluginName: string,
  version: string,
  manifest: IBundlePluginManifest,
  options?: {
    skills?: Array<{ name: string; content: string }>;
    hooks?: Record<string, unknown>;
    agents?: string[];
    mcpConfig?: Record<string, unknown>;
  },
): string {
  const pluginDir = join(pluginsDir, 'cache', marketplace, pluginName, version);
  const metaDir = join(pluginDir, '.claude-plugin');
  setupDir(metaDir);
  writeJson(join(metaDir, 'plugin.json'), manifest);

  if (options?.skills) {
    for (const skill of options.skills) {
      const skillDir = join(pluginDir, 'skills', skill.name);
      setupDir(skillDir);
      writeFile(join(skillDir, 'SKILL.md'), skill.content);
    }
  }

  if (options?.hooks) {
    const hooksDir = join(pluginDir, 'hooks');
    setupDir(hooksDir);
    writeJson(join(hooksDir, 'hooks.json'), options.hooks);
  }

  if (options?.agents) {
    const agentsDir = join(pluginDir, 'agents');
    setupDir(agentsDir);
    for (const agent of options.agents) {
      writeFile(join(agentsDir, `${agent}.md`), `# Agent: ${agent}`);
    }
  }

  if (options?.mcpConfig) {
    writeJson(join(metaDir, 'mcp.json'), options.mcpConfig);
  }

  return pluginDir;
}

describe('BundlePlugin flow integration', () => {
  let pluginsDir: string;

  beforeEach(() => {
    pluginsDir = join(TMP_BASE, 'run-' + Math.random().toString(36).slice(2), 'plugins');
    setupDir(pluginsDir);
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it('should discover and load a complete plugin from cache', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'full-plugin',
      version: '2.0.0',
      description: 'A fully-featured test plugin',
      features: { skills: true, hooks: true, agents: true, mcp: true },
    };

    const skillContent = `---
description: Code review skill
tags: [review, quality]
---

# Code Review

Perform thorough code reviews.
`;

    const hooks = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo pre-check' }],
        },
      ],
    };

    const mcpConfig = {
      server: { command: 'node', args: ['server.js'] },
    };

    createPluginInCache(pluginsDir, 'official', 'full-plugin', '2.0.0', manifest, {
      skills: [{ name: 'code-review', content: skillContent }],
      hooks,
      agents: ['reviewer', 'assistant'],
      mcpConfig,
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    const plugin = plugins[0];

    // Manifest
    expect(plugin.manifest.name).toBe('full-plugin');
    expect(plugin.manifest.version).toBe('2.0.0');
    expect(plugin.manifest.features.skills).toBe(true);
    expect(plugin.manifest.features.hooks).toBe(true);

    // Skills
    expect(plugin.skills).toHaveLength(1);
    expect(plugin.skills[0].name).toBe('code-review');
    expect(plugin.skills[0].description).toBe('Code review skill');
    expect(plugin.skills[0].skillContent).toContain('# Code Review');

    // Hooks
    expect(plugin.hooks).toEqual(hooks);

    // Agents
    expect(plugin.agents).toHaveLength(2);
    expect(plugin.agents).toContain('reviewer');
    expect(plugin.agents).toContain('assistant');

    // MCP config
    expect(plugin.mcpConfig).toEqual(mcpConfig);
  });

  it('should namespace plugin skills correctly', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'ns-plugin',
      version: '1.0.0',
      description: 'Plugin for namespace testing',
      features: { skills: true },
    };

    const skill1 = `---
description: First skill
---

Content for skill-one.
`;

    const skill2 = `---
description: Second skill
---

Content for skill-two.
`;

    createPluginInCache(pluginsDir, 'market', 'ns-plugin', '1.0.0', manifest, {
      skills: [
        { name: 'skill-one', content: skill1 },
        { name: 'skill-two', content: skill2 },
      ],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].skills).toHaveLength(2);

    const skillNames = plugins[0].skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['skill-one', 'skill-two']);

    // Verify each skill has the name@plugin format
    for (const skill of plugins[0].skills) {
      expect(skill.name).toMatch(/^skill-(one|two)$/);
    }
  });

  it('should load plugins from multiple marketplaces with isolated skills', async () => {
    const pluginA: IBundlePluginManifest = {
      name: 'plugin-alpha',
      version: '1.0.0',
      description: 'Alpha plugin',
      features: { skills: true },
    };

    const pluginB: IBundlePluginManifest = {
      name: 'plugin-beta',
      version: '1.0.0',
      description: 'Beta plugin',
      features: { skills: true, hooks: true },
    };

    const skillContent = `---
description: Shared skill name
---

Content.
`;

    createPluginInCache(pluginsDir, 'mp-alpha', 'plugin-alpha', '1.0.0', pluginA, {
      skills: [{ name: 'analyze', content: skillContent }],
    });

    createPluginInCache(pluginsDir, 'mp-beta', 'plugin-beta', '1.0.0', pluginB, {
      skills: [{ name: 'analyze', content: skillContent }],
      hooks: { PostToolUse: [{ matcher: '', hooks: [] }] },
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(2);

    // Both have a skill named 'analyze' but namespaced differently
    const allSkills = plugins.flatMap((p) => p.skills);
    const skillNames = allSkills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['analyze', 'analyze']);
  });

  it('should selectively disable plugins while loading others', async () => {
    for (const name of ['keep-a', 'skip-b', 'keep-c']) {
      createPluginInCache(pluginsDir, 'market', name, '1.0.0', {
        name,
        version: '1.0.0',
        description: `Plugin ${name}`,
        features: {},
      });
    }

    const loader = new BundlePluginLoader(pluginsDir, {
      'skip-b@market': false,
    });
    const plugins = await loader.loadAll();

    const names = plugins.map((p) => p.manifest.name).sort();
    expect(names).toEqual(['keep-a', 'keep-c']);
  });

  it('should handle plugin with hooks but no skills', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'hooks-only',
      version: '1.0.0',
      description: 'Plugin with only hooks',
      features: { hooks: true },
    };

    const hooks = {
      SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'echo init' }] }],
      PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo check' }] }],
    };

    createPluginInCache(pluginsDir, 'market', 'hooks-only', '1.0.0', manifest, { hooks });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].skills).toEqual([]);
    expect(plugins[0].hooks).toEqual(hooks);
  });

  it('should load latest version when multiple versions exist', async () => {
    createPluginInCache(pluginsDir, 'market', 'multi-ver', '1.0.0', {
      name: 'multi-ver',
      version: '1.0.0',
      description: 'Old version',
      features: {},
    });
    createPluginInCache(pluginsDir, 'market', 'multi-ver', '2.0.0', {
      name: 'multi-ver',
      version: '2.0.0',
      description: 'New version',
      features: {},
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.version).toBe('2.0.0');
    expect(plugins[0].manifest.description).toBe('New version');
  });
});
