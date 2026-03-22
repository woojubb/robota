import { describe, it, expect } from 'vitest';
import { buildSkillPrompt, substituteVariables, preprocessShellCommands } from '../skill-prompt.js';
import { CommandRegistry } from '../../commands/command-registry.js';
import type { ICommandSource } from '../../commands/types.js';

function registryWithSkill(
  name: string,
  description: string,
  skillContent?: string,
): CommandRegistry {
  const registry = new CommandRegistry();
  const source: ICommandSource = {
    name: 'skill',
    getCommands: () => [{ name, description, source: 'skill', skillContent }],
  };
  registry.addSource(source);
  return registry;
}

describe('buildSkillPrompt', () => {
  it('returns null for unknown command', async () => {
    const registry = new CommandRegistry();
    expect(await buildSkillPrompt('/unknown', registry)).toBeNull();
  });

  it('returns null for builtin command', async () => {
    const registry = new CommandRegistry();
    const source: ICommandSource = {
      name: 'builtin',
      getCommands: () => [{ name: 'help', description: 'Help', source: 'builtin' }],
    };
    registry.addSource(source);
    expect(await buildSkillPrompt('/help', registry)).toBeNull();
  });

  it('builds prompt with SKILL.md content', async () => {
    const registry = registryWithSkill('deploy', 'Deploy app', '# Deploy\nRun deploy steps');
    const result = await buildSkillPrompt('/deploy', registry);
    expect(result).toContain('<skill name="deploy">');
    expect(result).toContain('# Deploy\nRun deploy steps');
    expect(result).toContain('Execute the "deploy" skill: Deploy app');
  });

  it('uses user args instead of description when provided', async () => {
    const registry = registryWithSkill('deploy', 'Deploy app', '# Deploy');
    const result = await buildSkillPrompt('/deploy to production', registry);
    expect(result).toContain('Execute the "deploy" skill: to production');
  });

  it('builds simple prompt without SKILL.md content', async () => {
    const registry = registryWithSkill('review', 'Code review');
    const result = await buildSkillPrompt('/review', registry);
    expect(result).toBe('Use the "review" skill: Code review');
  });

  it('is case-insensitive for command name', async () => {
    const registry = registryWithSkill('deploy', 'Deploy', '# content');
    const result = await buildSkillPrompt('/DEPLOY', registry);
    expect(result).toContain('<skill name="deploy">');
  });
});

describe('substituteVariables', () => {
  it('should substitute $ARGUMENTS with all args', () => {
    const result = substituteVariables('Run $ARGUMENTS', 'file.ts --fix');
    expect(result).toBe('Run file.ts --fix');
  });

  it('should substitute $ARGUMENTS[0] with first arg', () => {
    const result = substituteVariables('Open $ARGUMENTS[0]', 'file.ts --fix');
    expect(result).toBe('Open file.ts');
  });

  it('should substitute $ARGUMENTS[1] with second arg', () => {
    const result = substituteVariables('Flag: $ARGUMENTS[1]', 'file.ts --fix');
    expect(result).toBe('Flag: --fix');
  });

  it('should substitute $0 shorthand', () => {
    const result = substituteVariables('Open $0', 'file.ts');
    expect(result).toBe('Open file.ts');
  });

  it('should substitute $1 shorthand', () => {
    const result = substituteVariables('$0 with $1', 'a b');
    expect(result).toBe('a with b');
  });

  it('should substitute ${CLAUDE_SESSION_ID}', () => {
    const result = substituteVariables('Session: ${CLAUDE_SESSION_ID}', '', { sessionId: 'abc' });
    expect(result).toBe('Session: abc');
  });

  it('should substitute ${CLAUDE_SKILL_DIR}', () => {
    const result = substituteVariables('Dir: ${CLAUDE_SKILL_DIR}', '', {
      skillDir: '/path/to/skill',
    });
    expect(result).toBe('Dir: /path/to/skill');
  });

  it('should leave unknown variables as-is', () => {
    const result = substituteVariables('Keep ${UNKNOWN}', 'arg');
    expect(result).toBe('Keep ${UNKNOWN}');
  });

  it('should handle empty args for $ARGUMENTS', () => {
    const result = substituteVariables('Run $ARGUMENTS', '');
    expect(result).toBe('Run ');
  });

  it('should handle out-of-range $ARGUMENTS[N] as empty string', () => {
    const result = substituteVariables('Val: $ARGUMENTS[5]', 'only-one');
    expect(result).toBe('Val: ');
  });

  it('should handle multiple substitutions in one string', () => {
    const result = substituteVariables('$0 and $1 in $ARGUMENTS', 'a b');
    expect(result).toBe('a and b in a b');
  });

  it('should handle missing context gracefully', () => {
    const result = substituteVariables('Session: ${CLAUDE_SESSION_ID}', '');
    expect(result).toBe('Session: ');
  });
});

describe('preprocessShellCommands', () => {
  it('should execute !`command` and substitute output', async () => {
    const result = await preprocessShellCommands('Version: !`echo 1.0.0`');
    expect(result).toBe('Version: 1.0.0');
  });

  it('should handle multiple shell substitutions', async () => {
    const result = await preprocessShellCommands('!`echo a` and !`echo b`');
    expect(result).toBe('a and b');
  });

  it('should preserve content without shell commands', async () => {
    const result = await preprocessShellCommands('No commands here');
    expect(result).toBe('No commands here');
  });

  it('should trim trailing newline from command output', async () => {
    const result = await preprocessShellCommands('Val: !`printf "hello\\n"`');
    expect(result).toBe('Val: hello');
  });

  it('should handle command failure gracefully', async () => {
    const result = await preprocessShellCommands('Val: !`nonexistent_command_xyz 2>/dev/null`');
    // On failure, substitute empty string
    expect(result).toBe('Val: ');
  });
});

describe('buildSkillPrompt with preprocessing', () => {
  it('substitutes $ARGUMENTS in skill content', async () => {
    const registry = registryWithSkill('deploy', 'Deploy app', 'Deploy to $ARGUMENTS');
    const result = await buildSkillPrompt('/deploy production', registry);
    expect(result).toContain('Deploy to production');
  });

  it('substitutes context variables in skill content', async () => {
    const registry = registryWithSkill('info', 'Info', 'Session: ${CLAUDE_SESSION_ID}');
    const result = await buildSkillPrompt('/info', registry, { sessionId: 'sess-123' });
    expect(result).toContain('Session: sess-123');
  });

  it('handles shell commands in skill content', async () => {
    const registry = registryWithSkill('ver', 'Version', 'Version: !`echo 2.0.0`');
    const result = await buildSkillPrompt('/ver', registry);
    expect(result).toContain('Version: 2.0.0');
  });

  it('remains backward compatible without args or context', async () => {
    const registry = registryWithSkill('review', 'Code review');
    const result = await buildSkillPrompt('/review', registry);
    expect(result).toBe('Use the "review" skill: Code review');
  });
});
