import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';
import type { IBundlePluginManifest, TEnabledPlugins } from '../bundle-plugin-types.js';

const TMP_BASE = join(tmpdir(), 'robota-bundle-plugin-test-' + process.pid);

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
    commands?: Array<{ name: string; content: string }>;
    hooks?: Record<string, unknown>;
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

  if (options?.commands) {
    const commandsDir = join(pluginDir, 'commands');
    setupDir(commandsDir);
    for (const cmd of options.commands) {
      writeFile(join(commandsDir, cmd.name), cmd.content);
    }
  }

  if (options?.hooks) {
    const hooksDir = join(pluginDir, 'hooks');
    setupDir(hooksDir);
    writeJson(join(hooksDir, 'hooks.json'), options.hooks);
  }

  return pluginDir;
}

describe('BundlePluginLoader', () => {
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

  it('should discover plugins in the cache directory', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      features: { skills: true },
    };
    createPluginInCache(pluginsDir, 'test-market', 'test-plugin', '1.0.0', manifest);

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('test-plugin');
    expect(plugins[0].manifest.version).toBe('1.0.0');
  });

  it('should load the latest version directory for a plugin', async () => {
    const manifestV1: IBundlePluginManifest = {
      name: 'ver-plugin',
      version: '1.0.0',
      description: 'Version 1',
      features: {},
    };
    const manifestV2: IBundlePluginManifest = {
      name: 'ver-plugin',
      version: '2.0.0',
      description: 'Version 2',
      features: {},
    };
    createPluginInCache(pluginsDir, 'market', 'ver-plugin', '1.0.0', manifestV1);
    createPluginInCache(pluginsDir, 'market', 'ver-plugin', '2.0.0', manifestV2);

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.version).toBe('2.0.0');
    expect(plugins[0].manifest.description).toBe('Version 2');
  });

  it('should load skills from plugin skills/ directory with namespacing', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'my-plugin',
      version: '1.0.0',
      description: 'Plugin with skills',
      features: { skills: true },
    };
    const skillContent = `---
description: A greeting skill
tags: [greeting, hello]
---

# Greeting Skill

Say hello to the user.
`;
    createPluginInCache(pluginsDir, 'market', 'my-plugin', '1.0.0', manifest, {
      skills: [{ name: 'greet', content: skillContent }],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].skills).toHaveLength(1);
    expect(plugins[0].skills[0].name).toBe('greet');
    expect(plugins[0].skills[0].description).toBe('A greeting skill');
    expect(plugins[0].skills[0].skillContent).toContain('# Greeting Skill');
  });

  it('should parse frontmatter tags from skills', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'tagged-plugin',
      version: '1.0.0',
      description: 'Plugin with tagged skills',
      features: { skills: true },
    };
    const skillContent = `---
description: A tagged skill
tags: [alpha, beta]
---

Content here.
`;
    createPluginInCache(pluginsDir, 'market', 'tagged-plugin', '1.0.0', manifest, {
      skills: [{ name: 'tagged-skill', content: skillContent }],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins[0].skills[0].tags).toEqual(['alpha', 'beta']);
  });

  it('should load hooks from plugin hooks/hooks.json', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'hook-plugin',
      version: '1.0.0',
      description: 'Plugin with hooks',
      features: { hooks: true },
    };
    const hooks = {
      PreToolUse: [{ type: 'command', command: 'echo pre-hook' }],
    };
    createPluginInCache(pluginsDir, 'market', 'hook-plugin', '1.0.0', manifest, { hooks });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].hooks).toEqual(hooks);
  });

  it('should skip disabled plugins using pluginName@marketplace key', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'disabled-plugin',
      version: '1.0.0',
      description: 'A disabled plugin',
      features: { skills: true },
    };
    createPluginInCache(pluginsDir, 'market', 'disabled-plugin', '1.0.0', manifest);

    const enabledPlugins: TEnabledPlugins = {
      'disabled-plugin@market': false,
    };

    const loader = new BundlePluginLoader(pluginsDir, enabledPlugins);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(0);
  });

  it('should load enabled plugins when enabledPlugins is provided', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'enabled-plugin',
      version: '1.0.0',
      description: 'An enabled plugin',
      features: {},
    };
    createPluginInCache(pluginsDir, 'market', 'enabled-plugin', '1.0.0', manifest);

    const enabledPlugins: TEnabledPlugins = {
      'enabled-plugin@market': true,
    };

    const loader = new BundlePluginLoader(pluginsDir, enabledPlugins);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('enabled-plugin');
  });

  it('should load plugins not listed in enabledPlugins (default enabled)', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'unlisted-plugin',
      version: '1.0.0',
      description: 'Not in the enabled list',
      features: {},
    };
    createPluginInCache(pluginsDir, 'market', 'unlisted-plugin', '1.0.0', manifest);

    const enabledPlugins: TEnabledPlugins = {
      'other-plugin@market': false,
    };

    const loader = new BundlePluginLoader(pluginsDir, enabledPlugins);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
  });

  it('should handle missing optional directories gracefully', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'minimal-plugin',
      version: '0.1.0',
      description: 'Minimal plugin with no skills or hooks',
      features: {},
    };
    createPluginInCache(pluginsDir, 'market', 'minimal-plugin', '0.1.0', manifest);

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].skills).toEqual([]);
    expect(plugins[0].commands).toEqual([]);
    expect(plugins[0].hooks).toEqual({});
    expect(plugins[0].agents).toEqual([]);
    expect(plugins[0].mcpConfig).toBeUndefined();
  });

  it('should discover plugins across multiple marketplaces', async () => {
    for (const [mp, name] of [
      ['mp-a', 'plugin-a'],
      ['mp-b', 'plugin-b'],
      ['mp-a', 'plugin-c'],
    ] as const) {
      createPluginInCache(pluginsDir, mp, name, '1.0.0', {
        name,
        version: '1.0.0',
        description: `Plugin ${name}`,
        features: {},
      });
    }

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(3);
    const names = plugins.map((p) => p.manifest.name).sort();
    expect(names).toEqual(['plugin-a', 'plugin-b', 'plugin-c']);
  });

  it('should skip directories without .claude-plugin/plugin.json', async () => {
    // Valid plugin
    createPluginInCache(pluginsDir, 'market', 'valid-plugin', '1.0.0', {
      name: 'valid-plugin',
      version: '1.0.0',
      description: 'Valid',
      features: {},
    });

    // Invalid directory (no .claude-plugin)
    const badDir = join(pluginsDir, 'cache', 'market', 'not-a-plugin', '1.0.0');
    setupDir(badDir);
    writeFile(join(badDir, 'README.md'), '# Not a plugin');

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('valid-plugin');
  });

  it('should return empty array when cache directory does not exist', async () => {
    const loader = new BundlePluginLoader(join(pluginsDir, 'nonexistent'));
    const plugins = await loader.loadAll();

    expect(plugins).toEqual([]);
  });

  it('should handle skills without frontmatter', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'no-fm-plugin',
      version: '1.0.0',
      description: 'Plugin with frontmatter-less skill',
      features: { skills: true },
    };
    const skillContent = `# Simple Skill

Just content, no frontmatter.
`;
    createPluginInCache(pluginsDir, 'market', 'no-fm-plugin', '1.0.0', manifest, {
      skills: [{ name: 'simple', content: skillContent }],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins[0].skills).toHaveLength(1);
    expect(plugins[0].skills[0].name).toBe('simple');
    expect(plugins[0].skills[0].description).toBe('');
    expect(plugins[0].skills[0].skillContent).toContain('# Simple Skill');
  });

  it('should skip plugins with invalid plugin.json', async () => {
    // Valid plugin
    createPluginInCache(pluginsDir, 'market', 'good-plugin', '1.0.0', {
      name: 'good-plugin',
      version: '1.0.0',
      description: 'Good',
      features: {},
    });

    // Plugin with invalid JSON
    const badDir = join(pluginsDir, 'cache', 'market', 'bad-plugin', '1.0.0', '.claude-plugin');
    setupDir(badDir);
    writeFile(join(badDir, 'plugin.json'), '{ invalid json }');

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('good-plugin');
  });

  it('should load MCP config from .mcp.json at plugin root (primary location)', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'mcp-primary-plugin',
      version: '1.0.0',
      description: 'Plugin with .mcp.json at root',
      features: { mcp: true },
    };
    const pluginDir = createPluginInCache(
      pluginsDir,
      'market',
      'mcp-primary-plugin',
      '1.0.0',
      manifest,
    );

    // Write .mcp.json at plugin root (primary location)
    writeJson(join(pluginDir, '.mcp.json'), {
      mcpServers: { 'my-server': { command: 'node', args: ['server.js'] } },
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].mcpConfig).toEqual({
      mcpServers: { 'my-server': { command: 'node', args: ['server.js'] } },
    });
  });

  it('should fall back to .claude-plugin/mcp.json when .mcp.json is absent', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'mcp-fallback-plugin',
      version: '1.0.0',
      description: 'Plugin with legacy mcp.json location',
      features: { mcp: true },
    };
    const pluginDir = createPluginInCache(
      pluginsDir,
      'market',
      'mcp-fallback-plugin',
      '1.0.0',
      manifest,
    );

    // Write mcp.json at legacy location (.claude-plugin/mcp.json)
    writeJson(join(pluginDir, '.claude-plugin', 'mcp.json'), {
      mcpServers: { 'legacy-server': { command: 'python', args: ['serve.py'] } },
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].mcpConfig).toEqual({
      mcpServers: { 'legacy-server': { command: 'python', args: ['serve.py'] } },
    });
  });

  it('should prefer .mcp.json over .claude-plugin/mcp.json when both exist', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'mcp-both-plugin',
      version: '1.0.0',
      description: 'Plugin with both MCP config locations',
      features: { mcp: true },
    };
    const pluginDir = createPluginInCache(
      pluginsDir,
      'market',
      'mcp-both-plugin',
      '1.0.0',
      manifest,
    );

    // Write both locations
    writeJson(join(pluginDir, '.mcp.json'), { primary: true });
    writeJson(join(pluginDir, '.claude-plugin', 'mcp.json'), { primary: false });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].mcpConfig).toEqual({ primary: true });
  });

  it('should also disable by plain name key in enabledPlugins', async () => {
    createPluginInCache(pluginsDir, 'market', 'name-disabled', '1.0.0', {
      name: 'name-disabled',
      version: '1.0.0',
      description: 'Disabled by name',
      features: {},
    });

    const enabledPlugins: TEnabledPlugins = {
      'name-disabled': false,
    };

    const loader = new BundlePluginLoader(pluginsDir, enabledPlugins);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(0);
  });

  it('should load commands from plugin commands/ directory with plugin:name format', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'cmd-plugin',
      version: '1.0.0',
      description: 'Plugin with commands',
      features: { commands: true },
    };
    const initCmd = `---
name: init
description: Initialize harness
---

# Init Command

Initialize the harness.
`;
    const auditCmd = `---
name: audit
description: Run audit
---

# Audit Command

Run the audit.
`;
    createPluginInCache(pluginsDir, 'market', 'cmd-plugin', '1.0.0', manifest, {
      commands: [
        { name: 'init.md', content: initCmd },
        { name: 'audit.md', content: auditCmd },
      ],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].commands).toHaveLength(2);

    const names = plugins[0].commands.map((c) => c.name).sort();
    expect(names).toEqual(['cmd-plugin:audit', 'cmd-plugin:init']);

    const initCommand = plugins[0].commands.find((c) => c.name === 'cmd-plugin:init');
    expect(initCommand?.description).toBe('Initialize harness');
    expect(initCommand?.skillContent).toContain('# Init Command');
  });

  it('should use filename as command name when frontmatter name is missing', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'no-name-plugin',
      version: '1.0.0',
      description: 'Plugin with nameless command',
      features: { commands: true },
    };
    const cmdContent = `---
description: A command without a name field
---

Content here.
`;
    createPluginInCache(pluginsDir, 'market', 'no-name-plugin', '1.0.0', manifest, {
      commands: [{ name: 'my-cmd.md', content: cmdContent }],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins[0].commands).toHaveLength(1);
    expect(plugins[0].commands[0].name).toBe('no-name-plugin:my-cmd');
  });

  it('should ignore non-.md files and subdirectories in commands/', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'filter-plugin',
      version: '1.0.0',
      description: 'Plugin to test filtering',
      features: { commands: true },
    };
    const cmdContent = `---
name: valid
description: Valid command
---

Content.
`;
    const pluginDir = createPluginInCache(
      pluginsDir,
      'market',
      'filter-plugin',
      '1.0.0',
      manifest,
      {
        commands: [{ name: 'valid.md', content: cmdContent }],
      },
    );

    // Add non-.md file and subdirectory
    writeFile(join(pluginDir, 'commands', 'notes.txt'), 'not a command');
    setupDir(join(pluginDir, 'commands', 'subdir'));

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins[0].commands).toHaveLength(1);
    expect(plugins[0].commands[0].name).toBe('filter-plugin:valid');
  });
});
