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

  it('should include claudeMd only when agentsMd is undefined', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      claudeMd: '# CLAUDE rules',
      isForkWorker: false,
    });
    expect(prompt).toContain('Body.');
    expect(prompt).toContain('# CLAUDE rules');
    expect(prompt).toContain('concise report');
  });

  it('should include agentsMd only when claudeMd is undefined', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      agentsMd: '# AGENTS rules',
      isForkWorker: false,
    });
    expect(prompt).toContain('Body.');
    expect(prompt).toContain('# AGENTS rules');
    expect(prompt).toContain('concise report');
  });

  it('should maintain correct assembly order: body, claudeMd, agentsMd, suffix', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'BODY_MARKER',
      claudeMd: 'CLAUDE_MARKER',
      agentsMd: 'AGENTS_MARKER',
      isForkWorker: false,
    });

    const bodyIdx = prompt.indexOf('BODY_MARKER');
    const claudeIdx = prompt.indexOf('CLAUDE_MARKER');
    const agentsIdx = prompt.indexOf('AGENTS_MARKER');
    const suffixIdx = prompt.indexOf('concise report');

    expect(bodyIdx).toBeLessThan(claudeIdx);
    expect(claudeIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(suffixIdx);
  });

  it('should separate parts with double newline', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      claudeMd: 'Claude.',
      agentsMd: 'Agents.',
      isForkWorker: false,
    });
    // Each part separated by \n\n
    expect(prompt).toContain('Body.\n\nClaude.\n\nAgents.\n\n');
  });

  it('should handle undefined claudeMd and agentsMd (no extra spacing)', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      isForkWorker: false,
    });
    // Should start with Body.\n\n<suffix> — no claudeMd/agentsMd sections injected
    expect(prompt).toMatch(/^Body\.\n\n/);
    // Should NOT contain three consecutive newlines (would indicate empty section)
    expect(prompt).not.toContain('\n\n\n');
  });
});
