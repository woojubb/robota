import { describe, it, expect } from 'vitest';
import {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
} from '../subagent-prompts.js';

describe('Subagent prompts', () => {
  it('should generate subagent suffix with concise report instruction', () => {
    const suffix = getSubagentSuffix();
    expect(suffix).toContain('concise report');
    expect(suffix).toContain('absolute');
    expect(suffix).toContain('emojis');
  });

  it('should generate fork worker suffix with 500 word limit', () => {
    const suffix = getForkWorkerSuffix();
    expect(suffix).toContain('500 words');
    expect(suffix).toContain('Scope');
    expect(suffix).toContain('Result');
    expect(suffix).toContain('Do NOT spawn sub-agents');
  });

  it('should assemble full prompt with agent body + suffix', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'You are a code reviewer.',
      isForkWorker: false,
    });
    expect(prompt).toContain('You are a code reviewer.');
    expect(prompt).toContain('concise report');
    expect(prompt).not.toContain('500 words');
  });

  it('should use fork worker suffix when isForkWorker is true', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Analyze the code.',
      isForkWorker: true,
    });
    expect(prompt).toContain('Analyze the code.');
    expect(prompt).toContain('500 words');
    expect(prompt).not.toContain('concise report');
  });

  it('should include CLAUDE.md and AGENTS.md when provided', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Agent body.',
      claudeMd: '# Project Rules\nUse TypeScript.',
      agentsMd: '# Agent Guidelines\nFollow TDD.',
      isForkWorker: false,
    });
    expect(prompt).toContain('Agent body.');
    expect(prompt).toContain('# Project Rules');
    expect(prompt).toContain('# Agent Guidelines');
    expect(prompt).toContain('concise report');
  });

  it('should omit CLAUDE.md/AGENTS.md sections when empty', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Agent body.',
      claudeMd: '',
      agentsMd: '',
      isForkWorker: false,
    });
    expect(prompt).toContain('Agent body.');
    expect(prompt).toContain('concise report');
    // Should NOT have empty sections
    expect(prompt).not.toContain('\n\n\n\n');
  });
});
