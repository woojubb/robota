import { describe, it, expect } from 'vitest';
import { buildSkillPrompt } from '../skill-prompt.js';
import { CommandRegistry } from '../../commands/command-registry.js';
import type { ICommandSource } from '../../commands/types.js';

function registryWithSkill(name: string, description: string, skillContent?: string): CommandRegistry {
  const registry = new CommandRegistry();
  const source: ICommandSource = {
    name: 'skill',
    getCommands: () => [{ name, description, source: 'skill', skillContent }],
  };
  registry.addSource(source);
  return registry;
}

describe('buildSkillPrompt', () => {
  it('returns null for unknown command', () => {
    const registry = new CommandRegistry();
    expect(buildSkillPrompt('/unknown', registry)).toBeNull();
  });

  it('returns null for builtin command', () => {
    const registry = new CommandRegistry();
    const source: ICommandSource = {
      name: 'builtin',
      getCommands: () => [{ name: 'help', description: 'Help', source: 'builtin' }],
    };
    registry.addSource(source);
    expect(buildSkillPrompt('/help', registry)).toBeNull();
  });

  it('builds prompt with SKILL.md content', () => {
    const registry = registryWithSkill('deploy', 'Deploy app', '# Deploy\nRun deploy steps');
    const result = buildSkillPrompt('/deploy', registry);
    expect(result).toContain('<skill name="deploy">');
    expect(result).toContain('# Deploy\nRun deploy steps');
    expect(result).toContain('Execute the "deploy" skill: Deploy app');
  });

  it('uses user args instead of description when provided', () => {
    const registry = registryWithSkill('deploy', 'Deploy app', '# Deploy');
    const result = buildSkillPrompt('/deploy to production', registry);
    expect(result).toContain('Execute the "deploy" skill: to production');
  });

  it('builds simple prompt without SKILL.md content', () => {
    const registry = registryWithSkill('review', 'Code review');
    const result = buildSkillPrompt('/review', registry);
    expect(result).toBe('Use the "review" skill: Code review');
  });

  it('is case-insensitive for command name', () => {
    const registry = registryWithSkill('deploy', 'Deploy', '# content');
    const result = buildSkillPrompt('/DEPLOY', registry);
    expect(result).toContain('<skill name="deploy">');
  });
});
