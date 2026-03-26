import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../context/system-prompt-builder.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';

const BASE_PARAMS: ISystemPromptParams = {
  agentsMd: '',
  claudeMd: '',
  toolDescriptions: [],
  trustLevel: 'moderate',
  projectInfo: {
    type: 'node',
    name: 'my-project',
    language: 'typescript',
    packageManager: 'pnpm',
  },
};

describe('buildSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const result = buildSystemPrompt(BASE_PARAMS);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('includes base role description', () => {
    const result = buildSystemPrompt(BASE_PARAMS);
    expect(result).toMatch(/assistant|agent|coding/i);
  });

  it('includes AGENTS.md content when provided', () => {
    const result = buildSystemPrompt({ ...BASE_PARAMS, agentsMd: '## Custom Rules\nNo foo.' });
    expect(result).toContain('## Custom Rules');
    expect(result).toContain('No foo.');
  });

  it('includes CLAUDE.md content when provided', () => {
    const result = buildSystemPrompt({ ...BASE_PARAMS, claudeMd: '## Project Notes\nUse pnpm.' });
    expect(result).toContain('## Project Notes');
    expect(result).toContain('Use pnpm.');
  });

  it('includes tool descriptions', () => {
    const result = buildSystemPrompt({
      ...BASE_PARAMS,
      toolDescriptions: ['Bash: execute shell commands', 'Read: read file contents'],
    });
    expect(result).toContain('Bash: execute shell commands');
    expect(result).toContain('Read: read file contents');
  });

  it('includes trust level', () => {
    const resultSafe = buildSystemPrompt({ ...BASE_PARAMS, trustLevel: 'safe' });
    expect(resultSafe).toMatch(/safe|plan|read.?only/i);

    const resultFull = buildSystemPrompt({ ...BASE_PARAMS, trustLevel: 'full' });
    expect(resultFull).toMatch(/full|acceptEdits/i);
  });

  it('includes project name and type in output', () => {
    const result = buildSystemPrompt(BASE_PARAMS);
    expect(result).toContain('my-project');
    expect(result).toMatch(/node|typescript/i);
  });

  it('includes package manager when present', () => {
    const result = buildSystemPrompt(BASE_PARAMS);
    expect(result).toContain('pnpm');
  });

  it('handles unknown project type gracefully', () => {
    const result = buildSystemPrompt({
      ...BASE_PARAMS,
      projectInfo: { type: 'unknown', language: 'unknown' },
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not include AGENTS.md section header when agentsMd is empty', () => {
    const result = buildSystemPrompt({ ...BASE_PARAMS, agentsMd: '' });
    // Should not have a prominent empty section
    expect(result).not.toMatch(/## Agent Instructions\s*\n\s*\n/);
  });

  it('AGENTS.md appears before CLAUDE.md in the prompt', () => {
    const result = buildSystemPrompt({
      ...BASE_PARAMS,
      agentsMd: 'AGENTS_MARKER',
      claudeMd: 'CLAUDE_MARKER',
    });
    const agentsIdx = result.indexOf('AGENTS_MARKER');
    const claudeIdx = result.indexOf('CLAUDE_MARKER');
    expect(agentsIdx).toBeGreaterThanOrEqual(0);
    expect(claudeIdx).toBeGreaterThanOrEqual(0);
    expect(agentsIdx).toBeLessThan(claudeIdx);
  });

  describe('System prompt skill injection', () => {
    it('should include skill list in system prompt', () => {
      const result = buildSystemPrompt({
        ...BASE_PARAMS,
        skills: [
          { name: 'my-skill', description: 'Does useful things' },
          { name: 'hidden', description: 'Secret', disableModelInvocation: true },
        ],
      });

      expect(result).toContain('The following skills are available');
      expect(result).toContain('my-skill: Does useful things');
      expect(result).not.toContain('hidden');
    });

    it('should not include skills section when no skills provided', () => {
      const result = buildSystemPrompt({ ...BASE_PARAMS });
      expect(result).not.toContain('The following skills are available');
    });

    it('should not include skills section when skills array is empty', () => {
      const result = buildSystemPrompt({ ...BASE_PARAMS, skills: [] });
      expect(result).not.toContain('The following skills are available');
    });

    it('should not include skills section when all skills are model-invocation disabled', () => {
      const result = buildSystemPrompt({
        ...BASE_PARAMS,
        skills: [{ name: 'hidden', description: 'Secret', disableModelInvocation: true }],
      });
      expect(result).not.toContain('The following skills are available');
    });

    it('should include multiple invocable skills', () => {
      const result = buildSystemPrompt({
        ...BASE_PARAMS,
        skills: [
          { name: 'skill-a', description: 'First skill' },
          { name: 'skill-b', description: 'Second skill' },
        ],
      });

      expect(result).toContain('- skill-a: First skill');
      expect(result).toContain('- skill-b: Second skill');
    });

    it('should place skills section after tools section', () => {
      const result = buildSystemPrompt({
        ...BASE_PARAMS,
        toolDescriptions: ['Bash: execute commands'],
        skills: [{ name: 'my-skill', description: 'Does things' }],
      });

      const toolsIdx = result.indexOf('## Available Tools');
      const skillsIdx = result.indexOf('The following skills are available');
      expect(toolsIdx).toBeGreaterThanOrEqual(0);
      expect(skillsIdx).toBeGreaterThan(toolsIdx);
    });
  });
});
