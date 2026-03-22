import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillCommandSource } from '../skill-source.js';

function createSkillDir(base: string, dirName: string, content: string): void {
  const dir = join(base, dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8');
}

function createMdFile(base: string, fileName: string, content: string): void {
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, fileName), content, 'utf-8');
}

describe('SkillCommandSource multi-path', () => {
  let tmpDir: string;
  let projectDir: string;
  let homeDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'skill-source-test-'));
    projectDir = join(tmpDir, 'project');
    homeDir = join(tmpDir, 'home');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(homeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should scan paths in priority order', () => {
    // .claude/skills (priority 1)
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(
      claudeSkills,
      'alpha',
      '---\nname: alpha\ndescription: from claude skills\n---\n',
    );

    // .claude/commands (priority 2)
    const claudeCommands = join(projectDir, '.claude', 'commands');
    mkdirSync(claudeCommands, { recursive: true });
    createMdFile(
      claudeCommands,
      'beta.md',
      '---\nname: beta\ndescription: from claude commands\n---\n',
    );

    // ~/.claude/skills (priority 3)
    const userSkills = join(homeDir, '.claude', 'skills');
    mkdirSync(userSkills, { recursive: true });
    createSkillDir(userSkills, 'gamma', '---\nname: gamma\ndescription: from user skills\n---\n');

    // .agents/skills (priority 4)
    const agentsSkills = join(projectDir, '.agents', 'skills');
    mkdirSync(agentsSkills, { recursive: true });
    createSkillDir(
      agentsSkills,
      'delta',
      '---\nname: delta\ndescription: from agents skills\n---\n',
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const commands = source.getCommands();
    const names = commands.map((c) => c.name);

    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('gamma');
    expect(names).toContain('delta');
  });

  it('should parse full Claude Code frontmatter', () => {
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(
      claudeSkills,
      'full-meta',
      [
        '---',
        'name: full-meta',
        'description: A fully annotated skill',
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
      ].join('\n'),
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const commands = source.getCommands();
    const cmd = commands.find((c) => c.name === 'full-meta');

    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe('A fully annotated skill');
    expect(cmd!.argumentHint).toBe('<file-path>');
    expect(cmd!.disableModelInvocation).toBe(true);
    expect(cmd!.userInvocable).toBe(false);
    expect(cmd!.allowedTools).toEqual(['Read', 'Edit', 'Grep']);
    expect(cmd!.model).toBe('claude-opus-4-6');
    expect(cmd!.effort).toBe('high');
    expect(cmd!.context).toBe('project');
    expect(cmd!.agent).toBe('researcher');
  });

  it('should filter model-invocable skills', () => {
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(
      claudeSkills,
      'invocable',
      '---\nname: invocable\ndescription: can be invoked by model\n---\n',
    );
    createSkillDir(
      claudeSkills,
      'not-invocable',
      '---\nname: not-invocable\ndescription: cannot be invoked by model\ndisable-model-invocation: true\n---\n',
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const filtered = source.getModelInvocableSkills();
    const names = filtered.map((c) => c.name);

    expect(names).toContain('invocable');
    expect(names).not.toContain('not-invocable');
  });

  it('should filter user-invocable skills', () => {
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(
      claudeSkills,
      'user-ok',
      '---\nname: user-ok\ndescription: user can invoke\n---\n',
    );
    createSkillDir(
      claudeSkills,
      'user-no',
      '---\nname: user-no\ndescription: user cannot invoke\nuser-invocable: false\n---\n',
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const filtered = source.getUserInvocableSkills();
    const names = filtered.map((c) => c.name);

    expect(names).toContain('user-ok');
    expect(names).not.toContain('user-no');
  });

  it('should deduplicate by name with higher-priority winning', () => {
    // Same name in .claude/skills (priority 1) and .agents/skills (priority 4)
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(
      claudeSkills,
      'shared',
      '---\nname: shared\ndescription: from claude skills (high priority)\n---\n',
    );

    const agentsSkills = join(projectDir, '.agents', 'skills');
    mkdirSync(agentsSkills, { recursive: true });
    createSkillDir(
      agentsSkills,
      'shared',
      '---\nname: shared\ndescription: from agents skills (low priority)\n---\n',
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const commands = source.getCommands();
    const shared = commands.filter((c) => c.name === 'shared');

    expect(shared).toHaveLength(1);
    expect(shared[0]!.description).toBe('from claude skills (high priority)');
  });

  it('should scan .claude/commands for .md files directly', () => {
    const claudeCommands = join(projectDir, '.claude', 'commands');
    mkdirSync(claudeCommands, { recursive: true });
    createMdFile(
      claudeCommands,
      'deploy.md',
      '---\nname: deploy\ndescription: Deploy the app\n---\n# Deploy\n',
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const commands = source.getCommands();
    const deploy = commands.find((c) => c.name === 'deploy');

    expect(deploy).toBeDefined();
    expect(deploy!.description).toBe('Deploy the app');
  });

  it('should handle boolean frontmatter values correctly', () => {
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(
      claudeSkills,
      'bool-test',
      '---\nname: bool-test\ndescription: bool test\ndisable-model-invocation: false\nuser-invocable: true\n---\n',
    );

    const source = new SkillCommandSource(projectDir, homeDir);
    const cmd = source.getCommands().find((c) => c.name === 'bool-test');

    expect(cmd!.disableModelInvocation).toBe(false);
    expect(cmd!.userInvocable).toBe(true);
  });

  it('should use directory name as fallback when no frontmatter name', () => {
    const claudeSkills = join(projectDir, '.claude', 'skills');
    mkdirSync(claudeSkills, { recursive: true });
    createSkillDir(claudeSkills, 'my-skill', '# No frontmatter here\nJust content.');

    const source = new SkillCommandSource(projectDir, homeDir);
    const cmd = source.getCommands().find((c) => c.name === 'my-skill');

    expect(cmd).toBeDefined();
    expect(cmd!.description).toBe('Skill: my-skill');
  });
});
