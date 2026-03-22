/**
 * Filesystem smoke tests — verify Claude Code compatible extensions
 * work against REAL files. No mocks for filesystem operations.
 *
 * Tests cover:
 * - Skill discovery from real .claude/skills/ directories
 * - Variable substitution with real skill content
 * - Hook config loading from real .claude/settings.json
 * - BundlePlugin loading from real directory structure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SkillCommandSource } from '../commands/skill-source.js';
import { PluginCommandSource } from '../commands/plugin-source.js';
import { substituteVariables, preprocessShellCommands } from '../utils/skill-prompt.js';
import { loadConfig, BundlePluginLoader } from '@robota-sdk/agent-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSkillDir(base: string, dirName: string, content: string): void {
  const dir = join(base, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
}

function createFile(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// 1. Skill Discovery from real .claude/skills/ directory
// ---------------------------------------------------------------------------

describe('Filesystem smoke: skill discovery', () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'robota-smoke-'));
    homeDir = join(tempDir, 'fake-home');
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should discover SKILL.md from .claude/skills/', () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(
      skillsDir,
      'my-tool',
      [
        '---',
        'name: my-tool',
        'description: A useful tool for developers',
        '---',
        '# My Tool',
        'Run this tool to analyze code.',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const commands = source.getCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('my-tool');
    expect(commands[0]!.description).toBe('A useful tool for developers');
    expect(commands[0]!.source).toBe('skill');
    expect(commands[0]!.skillContent).toContain('# My Tool');
  });

  it('should discover .md files from .claude/commands/', () => {
    const commandsDir = join(tempDir, '.claude', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'my-command.md'),
      [
        '---',
        'name: my-command',
        'description: A legacy command format',
        '---',
        '# My Command',
        'Execute this command to deploy.',
      ].join('\n'),
      'utf-8',
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const commands = source.getCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('my-command');
    expect(commands[0]!.description).toBe('A legacy command format');
  });

  it('should respect priority: .claude/skills wins over .agents/skills', () => {
    // Create same skill name in .claude/skills (priority 1)
    const claudeSkills = join(tempDir, '.claude', 'skills');
    createSkillDir(
      claudeSkills,
      'shared',
      [
        '---',
        'name: shared',
        'description: Claude version wins',
        '---',
        '# From .claude/skills',
      ].join('\n'),
    );

    // Create same skill name in .agents/skills (priority 4)
    const agentsSkills = join(tempDir, '.agents', 'skills');
    createSkillDir(
      agentsSkills,
      'shared',
      [
        '---',
        'name: shared',
        'description: Agents version should lose',
        '---',
        '# From .agents/skills',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const commands = source.getCommands();
    const shared = commands.filter((c) => c.name === 'shared');

    expect(shared).toHaveLength(1);
    expect(shared[0]!.description).toBe('Claude version wins');
    expect(shared[0]!.skillContent).toContain('# From .claude/skills');
  });

  it('should parse all Claude Code frontmatter fields from a real file', () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(
      skillsDir,
      'full-meta',
      [
        '---',
        'name: full-meta',
        'description: Fully annotated skill with all fields',
        'argument-hint: <file-path>',
        'disable-model-invocation: true',
        'user-invocable: false',
        'allowed-tools: Read,Edit,Grep',
        'model: claude-opus-4-6',
        'effort: high',
        'context: project',
        'agent: researcher',
        '---',
        '# Full Meta Skill',
        'This skill has every frontmatter field populated.',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const commands = source.getCommands();
    const cmd = commands.find((c) => c.name === 'full-meta');

    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe('Fully annotated skill with all fields');
    expect(cmd!.argumentHint).toBe('<file-path>');
    expect(cmd!.disableModelInvocation).toBe(true);
    expect(cmd!.userInvocable).toBe(false);
    expect(cmd!.allowedTools).toEqual(['Read', 'Edit', 'Grep']);
    expect(cmd!.model).toBe('claude-opus-4-6');
    expect(cmd!.effort).toBe('high');
    expect(cmd!.context).toBe('project');
    expect(cmd!.agent).toBe('researcher');
  });

  it('should discover skills from multiple directories simultaneously', () => {
    // .claude/skills
    createSkillDir(
      join(tempDir, '.claude', 'skills'),
      'alpha',
      '---\nname: alpha\ndescription: First\n---\n',
    );

    // .claude/commands
    const commandsDir = join(tempDir, '.claude', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(
      join(commandsDir, 'beta.md'),
      '---\nname: beta\ndescription: Second\n---\n',
      'utf-8',
    );

    // ~/.robota/skills (user home)
    createSkillDir(
      join(homeDir, '.robota', 'skills'),
      'gamma',
      '---\nname: gamma\ndescription: Third\n---\n',
    );

    // .agents/skills
    createSkillDir(
      join(tempDir, '.agents', 'skills'),
      'delta',
      '---\nname: delta\ndescription: Fourth\n---\n',
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const names = source.getCommands().map((c) => c.name);

    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('gamma');
    expect(names).toContain('delta');
    expect(names).toHaveLength(4);
  });

  it('should use directory name as fallback when frontmatter has no name', () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(skillsDir, 'fallback-name', '# No frontmatter\nJust markdown content.');

    const source = new SkillCommandSource(tempDir, homeDir);
    const cmd = source.getCommands().find((c) => c.name === 'fallback-name');

    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe('Skill: fallback-name');
  });
});

// ---------------------------------------------------------------------------
// 2. Variable substitution with real skill content
// ---------------------------------------------------------------------------

describe('Filesystem smoke: variable substitution', () => {
  let tempDir: string;
  let homeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'robota-smoke-vars-'));
    homeDir = join(tempDir, 'fake-home');
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should substitute $ARGUMENTS in discovered skill content', () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(
      skillsDir,
      'run-tests',
      [
        '---',
        'name: run-tests',
        'description: Run tests on a file',
        '---',
        '# Run Tests',
        'Run tests on $ARGUMENTS',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const skill = source.getCommands().find((c) => c.name === 'run-tests');

    expect(skill).toBeDefined();
    const result = substituteVariables(skill!.skillContent!, 'src/index.ts');
    expect(result).toContain('Run tests on src/index.ts');
  });

  it('should substitute indexed $ARGUMENTS[N] in discovered skill content', () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(
      skillsDir,
      'compare',
      [
        '---',
        'name: compare',
        'description: Compare two files',
        '---',
        'Compare $ARGUMENTS[0] with $ARGUMENTS[1]',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const skill = source.getCommands().find((c) => c.name === 'compare');

    expect(skill).toBeDefined();
    const result = substituteVariables(skill!.skillContent!, 'file-a.ts file-b.ts');
    expect(result).toContain('Compare file-a.ts with file-b.ts');
  });

  it('should execute !`command` in skill content', async () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(
      skillsDir,
      'version-check',
      [
        '---',
        'name: version-check',
        'description: Check node version',
        '---',
        'Node version: !`node --version`',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const skill = source.getCommands().find((c) => c.name === 'version-check');

    expect(skill).toBeDefined();
    const processed = await preprocessShellCommands(skill!.skillContent!);
    // node --version outputs something like "v22.14.0"
    expect(processed).toMatch(/Node version: v\d+\.\d+\.\d+/);
    expect(processed).not.toContain('!`');
  });

  it('should substitute ${CLAUDE_SESSION_ID} in discovered skill content', () => {
    const skillsDir = join(tempDir, '.claude', 'skills');
    createSkillDir(
      skillsDir,
      'session-info',
      [
        '---',
        'name: session-info',
        'description: Show session info',
        '---',
        'Current session: ${CLAUDE_SESSION_ID}',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, homeDir);
    const skill = source.getCommands().find((c) => c.name === 'session-info');

    expect(skill).toBeDefined();
    const result = substituteVariables(skill!.skillContent!, '', {
      sessionId: 'sess-abc-123',
    });
    expect(result).toContain('Current session: sess-abc-123');
  });
});

// ---------------------------------------------------------------------------
// 3. Hook config from real .claude/settings.json
// ---------------------------------------------------------------------------

describe('Filesystem smoke: hook config loading', () => {
  let tempDir: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'robota-smoke-hooks-'));
    // Override HOME so loadConfig doesn't read user's real settings
    process.env.HOME = join(tempDir, 'fake-home');
    mkdirSync(process.env.HOME, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load hooks from a real .claude/settings.json file', async () => {
    const projectDir = join(tempDir, 'project');
    mkdirSync(projectDir, { recursive: true });

    const settingsContent = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo ok' }],
          },
        ],
      },
    };

    createFile(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify(settingsContent, null, 2),
    );

    const config = await loadConfig(projectDir);

    expect(config.hooks).toBeDefined();
    expect(config.hooks!.PreToolUse).toBeDefined();
    expect(config.hooks!.PreToolUse).toHaveLength(1);
    expect(config.hooks!.PreToolUse![0]!.matcher).toBe('Bash');
    expect(config.hooks!.PreToolUse![0]!.hooks).toHaveLength(1);
    expect(config.hooks!.PreToolUse![0]!.hooks[0]!.type).toBe('command');
  });

  it('should merge .claude/settings.local.json over .claude/settings.json', async () => {
    const projectDir = join(tempDir, 'project');
    mkdirSync(projectDir, { recursive: true });

    // Base settings with a hook
    const baseSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo base' }],
          },
        ],
      },
    };

    // Local settings override hooks entirely
    const localSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Read',
            hooks: [{ type: 'command', command: 'echo local-wins' }],
          },
        ],
      },
    };

    createFile(join(projectDir, '.claude', 'settings.json'), JSON.stringify(baseSettings, null, 2));
    createFile(
      join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify(localSettings, null, 2),
    );

    const config = await loadConfig(projectDir);

    expect(config.hooks).toBeDefined();
    expect(config.hooks!.PreToolUse).toHaveLength(1);
    // Local should win — matcher is "Read", not "Bash"
    expect(config.hooks!.PreToolUse![0]!.matcher).toBe('Read');
  });

  it('should load provider settings from .claude/settings.json', async () => {
    const projectDir = join(tempDir, 'project');
    mkdirSync(projectDir, { recursive: true });

    createFile(
      join(projectDir, '.claude', 'settings.json'),
      JSON.stringify(
        {
          provider: {
            name: 'openai',
            model: 'gpt-4o',
          },
        },
        null,
        2,
      ),
    );

    const config = await loadConfig(projectDir);

    expect(config.provider.name).toBe('openai');
    expect(config.provider.model).toBe('gpt-4o');
  });

  it('should handle empty project directory gracefully', async () => {
    const projectDir = join(tempDir, 'empty-project');
    mkdirSync(projectDir, { recursive: true });

    const config = await loadConfig(projectDir);

    // Should return defaults without errors
    expect(config.defaultTrustLevel).toBe('moderate');
    expect(config.provider.name).toBe('anthropic');
  });
});

// ---------------------------------------------------------------------------
// 4. BundlePlugin from real directory
// ---------------------------------------------------------------------------

describe('Filesystem smoke: BundlePlugin loading', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'robota-smoke-plugin-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should load a real plugin directory structure', async () => {
    const pluginsDir = join(tempDir, 'plugins');
    const pluginDir = join(pluginsDir, 'cache', 'market', 'test-plugin', '1.0.0');

    // Create plugin manifest
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin for smoke testing',
      features: { skills: true, hooks: true },
    };
    createFile(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest, null, 2));

    // Create a skill inside the plugin
    const skillContent = [
      '---',
      'description: Greet the user warmly',
      '---',
      '# Greet Skill',
      'Say hello to $ARGUMENTS',
    ].join('\n');
    createFile(join(pluginDir, 'skills', 'greet', 'SKILL.md'), skillContent);

    // Create hooks config
    const hooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo plugin-hook' }],
        },
      ],
    };
    createFile(join(pluginDir, 'hooks', 'hooks.json'), JSON.stringify(hooksConfig, null, 2));

    // Load via BundlePluginLoader
    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);

    const loaded = plugins[0]!;
    expect(loaded.manifest.name).toBe('test-plugin');
    expect(loaded.manifest.version).toBe('1.0.0');
    expect(loaded.manifest.description).toBe('A test plugin for smoke testing');

    // Skills discovered with namespace
    expect(loaded.skills).toHaveLength(1);
    expect(loaded.skills[0]!.name).toBe('greet');
    expect(loaded.skills[0]!.description).toBe('Greet the user warmly');
    expect(loaded.skills[0]!.skillContent).toContain('# Greet Skill');

    // Hooks loaded
    expect(loaded.hooks).toBeDefined();
    expect(loaded.hooks.PreToolUse).toBeDefined();
  });

  it('should expose plugin skills through PluginCommandSource', async () => {
    const pluginsDir = join(tempDir, 'plugins');
    const pluginDir = join(pluginsDir, 'cache', 'market', 'code-tools', '2.0.0');

    createFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'code-tools',
        version: '2.0.0',
        description: 'Code analysis tools',
        features: { skills: true },
      }),
    );

    createFile(
      join(pluginDir, 'skills', 'lint', 'SKILL.md'),
      ['---', 'description: Run linter on the codebase', '---', '# Lint', 'Execute linting.'].join(
        '\n',
      ),
    );

    createFile(
      join(pluginDir, 'skills', 'format', 'SKILL.md'),
      ['---', 'description: Format code', '---', '# Format', 'Run formatter.'].join('\n'),
    );

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    // Wire loaded plugins into PluginCommandSource
    const source = new PluginCommandSource(plugins);
    const commands = source.getCommands();

    expect(commands).toHaveLength(2);
    const names = commands.map((c) => c.name).sort();
    // PluginCommandSource strips @plugin suffix and uses base name
    expect(names).toEqual(['format', 'lint']);
    expect(commands.every((c) => c.source === 'plugin')).toBe(true);
  });

  it('should skip plugins without valid manifest', async () => {
    const pluginsDir = join(tempDir, 'plugins');

    // Valid plugin
    createFile(
      join(pluginsDir, 'cache', 'market', 'valid', '1.0.0', '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'valid',
        version: '1.0.0',
        description: 'Valid plugin',
        features: {},
      }),
    );

    // Invalid plugin (missing required fields)
    createFile(
      join(pluginsDir, 'cache', 'market', 'invalid', '1.0.0', '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'invalid' }),
    );

    // Directory without manifest
    mkdirSync(join(pluginsDir, 'cache', 'market', 'no-manifest', '1.0.0'), { recursive: true });

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.manifest.name).toBe('valid');
  });

  it('should respect enabled/disabled plugin configuration', async () => {
    const pluginsDir = join(tempDir, 'plugins');

    // Create two plugins
    for (const name of ['enabled-plugin', 'disabled-plugin']) {
      createFile(
        join(pluginsDir, 'cache', 'market', name, '1.0.0', '.claude-plugin', 'plugin.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          description: `Plugin: ${name}`,
          features: {},
        }),
      );
    }

    const loader = new BundlePluginLoader(pluginsDir, {
      'disabled-plugin@market': false,
    });
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.manifest.name).toBe('enabled-plugin');
  });

  it('should load MCP config from plugin when present', async () => {
    const pluginsDir = join(tempDir, 'plugins');
    const pluginDir = join(pluginsDir, 'cache', 'market', 'mcp-plugin', '1.0.0');

    createFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'mcp-plugin',
        version: '1.0.0',
        description: 'Plugin with MCP config',
        features: { mcp: true },
      }),
    );

    const mcpConfig = {
      servers: [
        {
          name: 'test-server',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      ],
    };
    createFile(join(pluginDir, '.claude-plugin', 'mcp.json'), JSON.stringify(mcpConfig, null, 2));

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    expect(plugins).toHaveLength(1);
    expect(plugins[0]!.mcpConfig).toBeDefined();
    const mcp = plugins[0]!.mcpConfig as Record<string, unknown>;
    expect(mcp.servers).toBeDefined();
  });
});
