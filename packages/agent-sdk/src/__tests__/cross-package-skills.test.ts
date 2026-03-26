/**
 * Cross-package integration tests: CLI skill discovery -> SDK system prompt.
 *
 * Verifies:
 * - SkillCommandSource discovers skills from .claude/skills directories
 * - Discovered skills flow into buildSystemPrompt from agent-sdk
 * - Skills with disable-model-invocation are excluded from system prompt
 * - PluginCommandSource exposes loaded plugin skills as slash commands
 * - CommandRegistry aggregates builtin + skill + plugin sources
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import type { ILoadedBundlePlugin } from '../plugins/index.js';

import { SkillCommandSource } from '../commands/skill-source.js';
import { PluginCommandSource } from '../commands/plugin-source.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { BuiltinCommandSource } from '../commands/builtin-source.js';

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cross-pkg-skills-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('Cross-package: skill discovery -> system prompt', () => {
  it('should discover skills from .claude/skills and include in system prompt', () => {
    const tempDir = createTempDir();
    const skillDir = join(tempDir, '.claude', 'skills', 'my-skill');
    mkdirSync(skillDir, { recursive: true });

    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: my-skill',
        'description: A custom development skill',
        '---',
        '# My Skill',
        'This skill does something useful.',
      ].join('\n'),
    );

    // Use SkillCommandSource with the temp dir as cwd
    const source = new SkillCommandSource(tempDir, tempDir);
    const commands = source.getCommands();

    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe('my-skill');
    expect(commands[0]!.description).toBe('A custom development skill');

    // Get model-invocable skills
    const invocable = source.getModelInvocableSkills();
    expect(invocable).toHaveLength(1);

    // Pass to buildSystemPrompt from @robota-sdk/agent-sdk
    const params: ISystemPromptParams = {
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: ['bash: Execute shell commands'],
      trustLevel: 'moderate',
      projectInfo: { type: 'node', language: 'typescript' },
      skills: invocable.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        disableModelInvocation: cmd.disableModelInvocation,
      })),
    };

    const prompt = buildSystemPrompt(params);

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('my-skill');
    expect(prompt).toContain('A custom development skill');
  });

  it('should exclude disable-model-invocation skills from system prompt', () => {
    const tempDir = createTempDir();

    // Skill with disable-model-invocation: true
    const disabledDir = join(tempDir, '.claude', 'skills', 'internal-only');
    mkdirSync(disabledDir, { recursive: true });
    writeFileSync(
      join(disabledDir, 'SKILL.md'),
      [
        '---',
        'name: internal-only',
        'description: Internal skill not for AI',
        'disable-model-invocation: true',
        '---',
        '# Internal Only',
      ].join('\n'),
    );

    // Skill without disable-model-invocation
    const normalDir = join(tempDir, '.claude', 'skills', 'normal-skill');
    mkdirSync(normalDir, { recursive: true });
    writeFileSync(
      join(normalDir, 'SKILL.md'),
      [
        '---',
        'name: normal-skill',
        'description: Regular skill for AI',
        '---',
        '# Normal Skill',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, tempDir);

    // All commands include both
    const allCommands = source.getCommands();
    expect(allCommands).toHaveLength(2);

    // Model-invocable excludes the disabled one
    const invocable = source.getModelInvocableSkills();
    expect(invocable).toHaveLength(1);
    expect(invocable[0]!.name).toBe('normal-skill');

    // Build system prompt with invocable skills only
    const prompt = buildSystemPrompt({
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: [],
      trustLevel: 'moderate',
      projectInfo: { type: 'unknown', language: 'unknown' },
      skills: invocable.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
        disableModelInvocation: cmd.disableModelInvocation,
      })),
    });

    expect(prompt).toContain('normal-skill');
    expect(prompt).toContain('Regular skill for AI');
    expect(prompt).not.toContain('internal-only');
    expect(prompt).not.toContain('Internal skill not for AI');
  });

  it('should discover skills from multiple directories with priority', () => {
    const tempDir = createTempDir();

    // Project .claude/skills (priority 1)
    const projectSkillDir = join(tempDir, '.claude', 'skills', 'shared-skill');
    mkdirSync(projectSkillDir, { recursive: true });
    writeFileSync(
      join(projectSkillDir, 'SKILL.md'),
      [
        '---',
        'name: shared-skill',
        'description: Project version of shared skill',
        '---',
        '# Shared',
      ].join('\n'),
    );

    // .agents/skills (priority 4)
    const agentsSkillDir = join(tempDir, '.agents', 'skills', 'shared-skill');
    mkdirSync(agentsSkillDir, { recursive: true });
    writeFileSync(
      join(agentsSkillDir, 'SKILL.md'),
      [
        '---',
        'name: shared-skill',
        'description: Agents version should be overridden',
        '---',
        '# Override me',
      ].join('\n'),
    );

    const source = new SkillCommandSource(tempDir, tempDir);
    const commands = source.getCommands();

    // Only one instance (project version wins)
    const shared = commands.filter((c) => c.name === 'shared-skill');
    expect(shared).toHaveLength(1);
    expect(shared[0]!.description).toBe('Project version of shared skill');
  });
});

describe('Cross-package: BundlePlugin -> CLI commands', () => {
  function createMockPlugin(
    name: string,
    skills: Array<{ name: string; description: string; skillContent: string }>,
  ): ILoadedBundlePlugin {
    return {
      manifest: {
        name,
        version: '1.0.0',
        description: `Plugin ${name}`,
        features: { skills: true },
      },
      skills,
      commands: [],
      hooks: {},
      agents: [],
      pluginDir: `/plugins/${name}`,
    };
  }

  it('should expose loaded plugin skills as slash commands with base name and hint', () => {
    const plugin = createMockPlugin('code-tools', [
      {
        name: 'refactor',
        description: 'Refactor code',
        skillContent: '# Refactor steps',
      },
      {
        name: 'optimize',
        description: 'Optimize perf',
        skillContent: '# Optimize steps',
      },
    ]);

    const source = new PluginCommandSource([plugin]);
    const commands = source.getCommands();

    expect(commands).toHaveLength(2);
    expect(commands[0]!.name).toBe('refactor');
    expect(commands[0]!.description).toBe('(code-tools) Refactor code');
    expect(commands[0]!.source).toBe('plugin');
    expect(commands[0]!.skillContent).toBe('# Refactor steps');
    expect(commands[1]!.name).toBe('optimize');
  });

  it('should aggregate builtin + skill + plugin sources in CommandRegistry', () => {
    const tempDir = createTempDir();

    // Create a skill
    const skillDir = join(tempDir, '.claude', 'skills', 'local-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      ['---', 'name: local-skill', 'description: A local skill', '---', '# Local'].join('\n'),
    );

    // Create a plugin
    const plugin = createMockPlugin('ext-plugin', [
      { name: 'ext-skill', description: 'External skill', skillContent: '# External' },
    ]);

    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registry.addSource(new SkillCommandSource(tempDir, tempDir));
    registry.addSource(new PluginCommandSource([plugin]));

    const allCommands = registry.getCommands();

    // Should contain commands from all 3 sources
    const sources = new Set(allCommands.map((c) => c.source));
    expect(sources.has('builtin')).toBe(true);
    expect(sources.has('skill')).toBe(true);
    expect(sources.has('plugin')).toBe(true);

    // Verify specific commands exist
    const names = allCommands.map((c) => c.name);
    expect(names).toContain('local-skill');
    expect(names).toContain('ext-skill');

    // Registry filter should work across sources
    const filtered = registry.getCommands('local');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.name).toBe('local-skill');
  });

  it('should make plugin skills available for system prompt injection', () => {
    const plugin = createMockPlugin('ai-tools', [
      { name: 'summarize', description: 'Summarize text', skillContent: '# Summarize' },
    ]);

    const source = new PluginCommandSource([plugin]);
    const commands = source.getCommands();

    // Transform to system prompt skill format
    const skills = commands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));

    const prompt = buildSystemPrompt({
      agentsMd: '',
      claudeMd: '',
      toolDescriptions: [],
      trustLevel: 'moderate',
      projectInfo: { type: 'unknown', language: 'unknown' },
      skills,
    });

    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('summarize');
    expect(prompt).toContain('(ai-tools) Summarize text');
  });
});
