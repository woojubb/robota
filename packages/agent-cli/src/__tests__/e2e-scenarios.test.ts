/**
 * End-to-end scenario tests — simulate complete user workflows
 * crossing all package boundaries (agent-cli, agent-sdk, agent-core).
 *
 * Uses REAL filesystem operations and REAL imports from actual packages.
 * Only external I/O (network, git) is mocked.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildSystemPrompt, loadConfig, BundlePluginLoader, runHooks } from '@robota-sdk/agent-sdk';
import type { ISystemPromptParams, THooksConfig, IHookInput } from '@robota-sdk/agent-sdk';

import { SkillCommandSource } from '../commands/skill-source.js';
import { PluginCommandSource } from '../commands/plugin-source.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { BuiltinCommandSource } from '../commands/builtin-source.js';
import { executeSkill } from '../commands/skill-executor.js';
import type { IForkExecutionOptions } from '../commands/skill-executor.js';
import { substituteVariables } from '../utils/skill-prompt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDirs: string[] = [];

function createTempDir(prefix = 'e2e-'): string {
  const dir = mkdtempSync(join(tmpdir(), `robota-${prefix}`));
  tempDirs.push(dir);
  return dir;
}

function createFile(filePath: string, content: string): void {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

function createSkill(
  base: string,
  dirName: string,
  frontmatter: Record<string, string>,
  body: string,
): void {
  const dir = join(base, '.claude', 'skills', dirName);
  mkdirSync(dir, { recursive: true });

  const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  const content = ['---', ...fmLines, '---', body].join('\n');
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

// ===========================================================================
// Scenario 1: Skill lifecycle — from file creation to system prompt
// ===========================================================================

describe('E2E: Skill lifecycle', () => {
  it('should make a .claude/skills skill available as slash command and in system prompt', () => {
    // 1. Create temp project with a skill
    const projectDir = createTempDir('skill-lifecycle-');
    createSkill(
      projectDir,
      'lint-code',
      {
        name: 'lint-code',
        description: 'Run linting on the codebase',
        'allowed-tools': 'Read,Grep',
      },
      '# Lint Code\nAnalyze the code for lint issues using $ARGUMENTS.',
    );

    // 2. Create SkillCommandSource pointing at temp dir
    const source = new SkillCommandSource(projectDir, projectDir);

    // 3. Verify skill appears in getCommands()
    const commands = source.getCommands();
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('lint-code');
    expect(commands[0]!.description).toBe('Run linting on the codebase');
    expect(commands[0]!.source).toBe('skill');

    // 4. Verify skill appears in getUserInvocableSkills()
    const userSkills = source.getUserInvocableSkills();
    expect(userSkills).toHaveLength(1);
    expect(userSkills[0]!.name).toBe('lint-code');

    // 5. Verify skill appears in getModelInvocableSkills()
    const modelSkills = source.getModelInvocableSkills();
    expect(modelSkills).toHaveLength(1);
    expect(modelSkills[0]!.name).toBe('lint-code');

    // 6. Build system prompt with the skill
    const params: ISystemPromptParams = {
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: ['bash: Execute shell commands'],
      trustLevel: 'moderate',
      projectInfo: { type: 'node', language: 'typescript' },
      skills: modelSkills.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        disableModelInvocation: cmd.disableModelInvocation,
      })),
    };
    const prompt = buildSystemPrompt(params);

    // 7. Verify system prompt contains skill name + description
    expect(prompt).toContain('lint-code');
    expect(prompt).toContain('Run linting on the codebase');

    // 8. Verify allowed-tools are parsed in the command object
    expect(commands[0]!.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('should respect disable-model-invocation flag end-to-end', () => {
    const projectDir = createTempDir('disable-model-');

    // 1. Create skill with disable-model-invocation: true
    createSkill(
      projectDir,
      'internal-tool',
      {
        name: 'internal-tool',
        description: 'For human use only',
        'disable-model-invocation': 'true',
      },
      '# Internal Tool\nThis tool is for human operators.',
    );

    const source = new SkillCommandSource(projectDir, projectDir);

    // 2. Verify it appears in getUserInvocableSkills() (visible in menu)
    const userSkills = source.getUserInvocableSkills();
    expect(userSkills).toHaveLength(1);
    expect(userSkills[0]!.name).toBe('internal-tool');

    // 3. Verify it does NOT appear in getModelInvocableSkills()
    const modelSkills = source.getModelInvocableSkills();
    expect(modelSkills).toHaveLength(0);

    // 4. Verify it does NOT appear in system prompt
    const prompt = buildSystemPrompt({
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: [],
      trustLevel: 'moderate',
      projectInfo: { type: 'unknown', language: 'unknown' },
      skills: modelSkills.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        disableModelInvocation: cmd.disableModelInvocation,
      })),
    });

    expect(prompt).not.toContain('internal-tool');
    expect(prompt).not.toContain('For human use only');
  });

  it('should process skill content with variable substitution', () => {
    const projectDir = createTempDir('var-subst-');
    const skillDir = join(projectDir, '.claude', 'skills', 'analyze');
    mkdirSync(skillDir, { recursive: true });

    // 1. Create skill with content using variables
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: analyze',
        'description: Analyze a file',
        '---',
        '# Analysis',
        'Analyze $ARGUMENTS in ${CLAUDE_SKILL_DIR}',
        'First arg: $ARGUMENTS[0], second arg: $ARGUMENTS[1]',
      ].join('\n'),
    );

    // 2. Discover skill
    const source = new SkillCommandSource(projectDir, projectDir);
    const skill = source.getCommands().find((c) => c.name === 'analyze');
    expect(skill).toBeDefined();

    // 3. Call substituteVariables with args
    const result = substituteVariables(skill!.skillContent!, 'src/index.ts src/utils.ts', {
      skillDir: '/project/.claude/skills/analyze',
    });

    // 4. Verify output has real values substituted
    expect(result).toContain(
      'Analyze src/index.ts src/utils.ts in /project/.claude/skills/analyze',
    );
    expect(result).toContain('First arg: src/index.ts, second arg: src/utils.ts');
  });
});

// ===========================================================================
// Scenario 2: Hook configuration and execution
// ===========================================================================

describe('E2E: Hook configuration to execution', () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  it('should load hooks from .claude/settings.json and execute on matching event', async () => {
    const tempDir = createTempDir('hooks-exec-');
    const projectDir = join(tempDir, 'project');
    process.env.HOME = join(tempDir, 'fake-home');
    mkdirSync(process.env.HOME, { recursive: true });

    // 1. Create .claude/settings.json with PreToolUse hook that blocks Bash
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo blocked >&2 && exit 2' }],
          },
        ],
      },
    };
    createFile(join(projectDir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));

    // 2. Load config from temp dir
    const config = await loadConfig(projectDir);

    // 3. Extract hooks from resolved config
    expect(config.hooks).toBeDefined();
    const hooksConfig = config.hooks as THooksConfig;

    // 4. Run runHooks with PreToolUse event, tool_name: "Bash"
    const bashInput: IHookInput = {
      session_id: 'test-session',
      cwd: projectDir,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    };
    const bashResult = await runHooks(hooksConfig, 'PreToolUse', bashInput);

    // 5. Verify hook fired and returned exit code 2 (blocked)
    expect(bashResult.blocked).toBe(true);
    expect(bashResult.reason).toContain('blocked');

    // 6. Run runHooks with PreToolUse event, tool_name: "Read"
    const readInput: IHookInput = {
      session_id: 'test-session',
      cwd: projectDir,
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
    };
    const readResult = await runHooks(hooksConfig, 'PreToolUse', readInput);

    // 7. Verify hook did NOT fire (matcher doesn't match)
    expect(readResult.blocked).toBe(false);
  });

  it('should merge hooks from .claude/settings.json and .claude/settings.local.json', async () => {
    const tempDir = createTempDir('hooks-merge-');
    const projectDir = join(tempDir, 'project');
    process.env.HOME = join(tempDir, 'fake-home');
    mkdirSync(process.env.HOME, { recursive: true });

    // 1. Create base settings with a Bash hook
    const baseSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo base-hook' }],
          },
        ],
      },
    };

    // 2. Create local settings with a Read hook (should override)
    const localSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Read',
            hooks: [{ type: 'command', command: 'echo local-hook' }],
          },
        ],
      },
    };

    createFile(join(projectDir, '.claude', 'settings.json'), JSON.stringify(baseSettings, null, 2));
    createFile(
      join(projectDir, '.claude', 'settings.local.json'),
      JSON.stringify(localSettings, null, 2),
    );

    // 3. Load config
    const config = await loadConfig(projectDir);

    // 4. Verify local settings take precedence
    expect(config.hooks).toBeDefined();
    expect(config.hooks!.PreToolUse).toHaveLength(1);
    expect(config.hooks!.PreToolUse![0]!.matcher).toBe('Read');
  });
});

// ===========================================================================
// Scenario 3: Plugin installation and discovery
// ===========================================================================

describe('E2E: Plugin install and discover', () => {
  it('should install a local plugin and discover its skills', async () => {
    const tempDir = createTempDir('plugin-install-');

    // 1. Create a "marketplace" source dir with a plugin directory structure
    const sourcePluginDir = join(tempDir, 'marketplace', 'code-helper');
    createFile(
      join(sourcePluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'code-helper',
        version: '1.0.0',
        description: 'Helps with code analysis',
        features: { skills: true },
      }),
    );
    createFile(
      join(sourcePluginDir, 'skills', 'review', 'SKILL.md'),
      [
        '---',
        'description: Review code for issues',
        '---',
        '# Code Review',
        'Review the code.',
      ].join('\n'),
    );
    createFile(
      join(sourcePluginDir, 'skills', 'explain', 'SKILL.md'),
      [
        '---',
        'description: Explain code in plain English',
        '---',
        '# Explain',
        'Explain the code.',
      ].join('\n'),
    );

    // 2. Simulate install to cache/<marketplace>/<plugin>/<version>/
    const pluginsDir = join(tempDir, 'installed-plugins');
    const targetDir = join(pluginsDir, 'cache', 'local', 'code-helper', '1.0.0');
    mkdirSync(targetDir, { recursive: true });
    cpSync(sourcePluginDir, targetDir, { recursive: true });

    // 3. Use BundlePluginLoader to discover installed plugins
    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    // 4. Verify plugin skills are loaded with correct namespace
    expect(plugins).toHaveLength(1);
    const plugin = plugins[0]!;
    expect(plugin.manifest.name).toBe('code-helper');
    expect(plugin.skills).toHaveLength(2);

    const skillNames = plugin.skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['explain@code-helper', 'review@code-helper']);

    // 5. Use PluginCommandSource to expose as commands
    const source = new PluginCommandSource(plugins);
    const commands = source.getCommands();

    // 6. Verify commands appear
    expect(commands).toHaveLength(2);
    expect(commands.every((c) => c.source === 'plugin')).toBe(true);
    const cmdNames = commands.map((c) => c.name).sort();
    expect(cmdNames).toEqual(['explain@code-helper', 'review@code-helper']);
  });

  it('should disable a plugin and verify its skills disappear', async () => {
    const tempDir = createTempDir('plugin-disable-');

    // 1. Create a plugin in the cache directory structure
    const pluginsDir = join(tempDir, 'plugins');
    const pluginDir = join(pluginsDir, 'cache', 'market', 'temp-plugin', '1.0.0');
    createFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'temp-plugin',
        version: '1.0.0',
        description: 'A temporary plugin',
        features: { skills: true },
      }),
    );
    createFile(
      join(pluginDir, 'skills', 'hello', 'SKILL.md'),
      ['---', 'description: Say hello', '---', '# Hello'].join('\n'),
    );

    // 2. Verify skills are visible (enabled by default)
    const enabledLoader = new BundlePluginLoader(pluginsDir);
    const enabledPlugins = await enabledLoader.loadAll();
    expect(enabledPlugins).toHaveLength(1);
    expect(enabledPlugins[0]!.skills).toHaveLength(1);
    expect(enabledPlugins[0]!.skills[0]!.name).toBe('hello@temp-plugin');

    const enabledSource = new PluginCommandSource(enabledPlugins);
    expect(enabledSource.getCommands()).toHaveLength(1);

    // 3. Disable the plugin by passing enabledPlugins config (using pluginName@marketplace key)
    const disabledLoader = new BundlePluginLoader(pluginsDir, {
      'temp-plugin@market': false,
    });

    // 4. Reload plugins
    const disabledPlugins = await disabledLoader.loadAll();

    // 5. Verify skills are gone
    expect(disabledPlugins).toHaveLength(0);

    const disabledSource = new PluginCommandSource(disabledPlugins);
    expect(disabledSource.getCommands()).toHaveLength(0);
  });
});

// ===========================================================================
// Scenario 4: Full skill invocation with fork
// ===========================================================================

describe('E2E: Skill invocation', () => {
  it('should execute a non-fork skill as prompt injection', async () => {
    const projectDir = createTempDir('invoke-inject-');

    // 1. Create skill without context: fork
    createSkill(
      projectDir,
      'summarize',
      {
        name: 'summarize',
        description: 'Summarize the given file',
      },
      '# Summarize\nProvide a concise summary of $ARGUMENTS.',
    );

    const source = new SkillCommandSource(projectDir, projectDir);
    const skill = source.getCommands().find((c) => c.name === 'summarize');
    expect(skill).toBeDefined();

    // 2. Discover and invoke via executeSkill
    const result = await executeSkill(skill!, 'src/index.ts', {});

    // 3. Verify result mode is 'inject' with processed content
    expect(result.mode).toBe('inject');
    expect(result.prompt).toBeDefined();
    expect(result.prompt).toContain('summarize');
    expect(result.prompt).toContain('Provide a concise summary of src/index.ts');
    expect(result.result).toBeUndefined();
  });

  it('should execute a fork skill via callback', async () => {
    const projectDir = createTempDir('invoke-fork-');

    // 1. Create skill with context: fork, agent: Explore, allowed-tools: Read,Grep
    createSkill(
      projectDir,
      'deep-review',
      {
        name: 'deep-review',
        description: 'Deep review with subagent',
        context: 'fork',
        agent: 'Explore',
        'allowed-tools': 'Read,Grep',
      },
      '# Deep Review\nPerform deep analysis of $ARGUMENTS.',
    );

    const source = new SkillCommandSource(projectDir, projectDir);
    const skill = source.getCommands().find((c) => c.name === 'deep-review');
    expect(skill).toBeDefined();
    expect(skill!.context).toBe('fork');
    expect(skill!.agent).toBe('Explore');
    expect(skill!.allowedTools).toEqual(['Read', 'Grep']);

    // 2. Create mock runInFork callback to capture what's passed
    let capturedContent = '';
    let capturedOptions: IForkExecutionOptions = {};
    const mockRunInFork = vi.fn(
      async (content: string, options: IForkExecutionOptions): Promise<string> => {
        capturedContent = content;
        capturedOptions = options;
        return 'Subagent completed the deep review successfully.';
      },
    );

    // 3. Invoke via executeSkill with mock runInFork callback
    const result = await executeSkill(skill!, 'src/main.ts', {
      runInFork: mockRunInFork,
    });

    // 4. Verify callback received correct content, agent type, and allowed tools
    expect(result.mode).toBe('fork');
    expect(result.result).toBe('Subagent completed the deep review successfully.');
    expect(result.prompt).toBeUndefined();

    expect(mockRunInFork).toHaveBeenCalledOnce();
    expect(capturedContent).toContain('Perform deep analysis of src/main.ts');
    expect(capturedOptions.agent).toBe('Explore');
    expect(capturedOptions.allowedTools).toEqual(['Read', 'Grep']);
  });

  it('should fall back to inject mode when fork callback is not provided', async () => {
    const projectDir = createTempDir('fork-fallback-');

    // Create a fork skill but don't provide runInFork callback
    createSkill(
      projectDir,
      'fork-skill',
      {
        name: 'fork-skill',
        description: 'A fork skill without callback',
        context: 'fork',
      },
      '# Fork Skill\nDo something with $ARGUMENTS.',
    );

    const source = new SkillCommandSource(projectDir, projectDir);
    const skill = source.getCommands().find((c) => c.name === 'fork-skill');
    expect(skill).toBeDefined();

    // No runInFork callback provided — should fall back to inject
    const result = await executeSkill(skill!, 'test-arg', {});

    expect(result.mode).toBe('inject');
    expect(result.prompt).toBeDefined();
    expect(result.prompt).toContain('fork-skill');
  });
});

// ===========================================================================
// Scenario 5: Full registry aggregation across all sources
// ===========================================================================

describe('E2E: CommandRegistry aggregation', () => {
  it('should aggregate skills from builtin, filesystem, and plugin sources end-to-end', async () => {
    const projectDir = createTempDir('registry-full-');

    // Create a filesystem skill
    createSkill(
      projectDir,
      'fs-skill',
      { name: 'fs-skill', description: 'Filesystem skill' },
      '# FS Skill',
    );

    // Create a plugin with a skill (in cache directory structure)
    const pluginsDir = join(projectDir, '.plugins');
    const pluginDir = join(pluginsDir, 'cache', 'market', 'my-plugin', '1.0.0');
    createFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'my-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        features: { skills: true },
      }),
    );
    createFile(
      join(pluginDir, 'skills', 'plugin-skill', 'SKILL.md'),
      ['---', 'description: Plugin skill', '---', '# Plugin'].join('\n'),
    );

    // Load plugin
    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();
    expect(plugins).toHaveLength(1);

    // Build registry with all three sources
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registry.addSource(new SkillCommandSource(projectDir, projectDir));
    registry.addSource(new PluginCommandSource(plugins));

    const allCommands = registry.getCommands();

    // Verify all three sources are represented
    const sources = new Set(allCommands.map((c) => c.source));
    expect(sources.has('builtin')).toBe(true);
    expect(sources.has('skill')).toBe(true);
    expect(sources.has('plugin')).toBe(true);

    // Verify specific commands
    const names = allCommands.map((c) => c.name);
    expect(names).toContain('fs-skill');
    expect(names).toContain('plugin-skill@my-plugin');

    // Build system prompt from the combined result
    const modelSkills = allCommands
      .filter((c) => c.source === 'skill' || c.source === 'plugin')
      .filter((c) => c.disableModelInvocation !== true)
      .map((c) => ({
        name: c.name,
        description: c.description,
      }));

    const prompt = buildSystemPrompt({
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: [],
      trustLevel: 'moderate',
      projectInfo: { type: 'node', language: 'typescript' },
      skills: modelSkills,
    });

    expect(prompt).toContain('fs-skill');
    expect(prompt).toContain('plugin-skill@my-plugin');
  });
});
