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

function createPluginStructure(
  pluginsDir: string,
  pluginName: string,
  manifest: IBundlePluginManifest,
  options?: {
    skills?: Array<{ name: string; content: string }>;
    hooks?: Record<string, unknown>;
  },
): string {
  const pluginDir = join(pluginsDir, pluginName);
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

  it('should discover plugins in the plugins directory', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      features: { skills: true },
    };
    createPluginStructure(pluginsDir, 'test-plugin', manifest);

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('test-plugin');
    expect(plugins[0].manifest.version).toBe('1.0.0');
    expect(plugins[0].pluginDir).toBe(join(pluginsDir, 'test-plugin'));
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
    createPluginStructure(pluginsDir, 'my-plugin', manifest, {
      skills: [{ name: 'greet', content: skillContent }],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].skills).toHaveLength(1);
    expect(plugins[0].skills[0].name).toBe('greet@my-plugin');
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
    createPluginStructure(pluginsDir, 'tagged-plugin', manifest, {
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
    createPluginStructure(pluginsDir, 'hook-plugin', manifest, { hooks });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].hooks).toEqual(hooks);
  });

  it('should skip disabled plugins', async () => {
    const manifest: IBundlePluginManifest = {
      name: 'disabled-plugin',
      version: '1.0.0',
      description: 'A disabled plugin',
      features: { skills: true },
    };
    createPluginStructure(pluginsDir, 'disabled-plugin', manifest);

    const enabledPlugins: TEnabledPlugins = {
      'disabled-plugin@marketplace': false,
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
    createPluginStructure(pluginsDir, 'enabled-plugin', manifest);

    const enabledPlugins: TEnabledPlugins = {
      'enabled-plugin@marketplace': true,
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
    createPluginStructure(pluginsDir, 'unlisted-plugin', manifest);

    const enabledPlugins: TEnabledPlugins = {
      'other-plugin@marketplace': false,
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
    // Create only the manifest, no skills/ or hooks/
    createPluginStructure(pluginsDir, 'minimal-plugin', manifest);

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].skills).toEqual([]);
    expect(plugins[0].hooks).toEqual({});
    expect(plugins[0].agents).toEqual([]);
    expect(plugins[0].mcpConfig).toBeUndefined();
  });

  it('should discover multiple plugins', async () => {
    for (const name of ['plugin-a', 'plugin-b', 'plugin-c']) {
      createPluginStructure(pluginsDir, name, {
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
    createPluginStructure(pluginsDir, 'valid-plugin', {
      name: 'valid-plugin',
      version: '1.0.0',
      description: 'Valid',
      features: {},
    });
    // Invalid directory (no .claude-plugin)
    setupDir(join(pluginsDir, 'not-a-plugin'));
    writeFile(join(pluginsDir, 'not-a-plugin', 'README.md'), '# Not a plugin');

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('valid-plugin');
  });

  it('should return empty array when plugins directory does not exist', async () => {
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
    createPluginStructure(pluginsDir, 'no-fm-plugin', manifest, {
      skills: [{ name: 'simple', content: skillContent }],
    });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins[0].skills).toHaveLength(1);
    expect(plugins[0].skills[0].name).toBe('simple@no-fm-plugin');
    expect(plugins[0].skills[0].description).toBe('');
    expect(plugins[0].skills[0].skillContent).toContain('# Simple Skill');
  });

  it('should skip plugins with invalid plugin.json', async () => {
    // Valid plugin
    createPluginStructure(pluginsDir, 'good-plugin', {
      name: 'good-plugin',
      version: '1.0.0',
      description: 'Good',
      features: {},
    });

    // Plugin with invalid JSON
    const badDir = join(pluginsDir, 'bad-plugin', '.claude-plugin');
    setupDir(badDir);
    writeFile(join(badDir, 'plugin.json'), '{ invalid json }');

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.name).toBe('good-plugin');
  });
});
