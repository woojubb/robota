import { describe, it, expect } from 'vitest';

import {
  getSubagentSuffix,
  getForkWorkerSuffix,
  assembleSubagentPrompt,
} from '../subagent-prompts.js';

describe('Subagent prompts', () => {
  it('getSubagentSuffix returns non-empty string', () => {
    expect(getSubagentSuffix().length).toBeGreaterThan(0);
  });

  it('getForkWorkerSuffix returns non-empty string', () => {
    expect(getForkWorkerSuffix().length).toBeGreaterThan(0);
  });

  it('standard and fork suffixes are different', () => {
    expect(getSubagentSuffix()).not.toBe(getForkWorkerSuffix());
  });

  it('assembles prompt with agent body and standard suffix', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'You are a code reviewer.',
      isForkWorker: false,
    });
    expect(prompt).toContain('You are a code reviewer.');
    expect(prompt).toContain(getSubagentSuffix());
    expect(prompt).not.toContain(getForkWorkerSuffix());
  });

  it('uses fork worker suffix when isForkWorker is true', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Analyze the code.',
      isForkWorker: true,
    });
    expect(prompt).toContain('Analyze the code.');
    expect(prompt).toContain(getForkWorkerSuffix());
    expect(prompt).not.toContain(getSubagentSuffix());
  });

  it('includes CLAUDE.md and AGENTS.md when provided', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Agent body.',
      projectNotesMd: '# Project Rules\nUse TypeScript.',
      agentsMd: '# Agent Guidelines\nFollow TDD.',
      isForkWorker: false,
    });
    expect(prompt).toContain('# Project Rules');
    expect(prompt).toContain('# Agent Guidelines');
  });

  it('omits CLAUDE.md/AGENTS.md sections when empty', () => {
    const withEmpty = assembleSubagentPrompt({
      agentBody: 'Body.',
      projectNotesMd: '',
      agentsMd: '',
      isForkWorker: false,
    });
    // Should NOT have empty sections (no triple newlines)
    expect(withEmpty).not.toContain('\n\n\n\n');
  });

  it('assembly order: body → projectNotesMd → agentsMd → suffix', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'BODY_MARKER',
      projectNotesMd: 'CLAUDE_MARKER',
      agentsMd: 'AGENTS_MARKER',
      isForkWorker: false,
    });

    const bodyIdx = prompt.indexOf('BODY_MARKER');
    const claudeIdx = prompt.indexOf('CLAUDE_MARKER');
    const agentsIdx = prompt.indexOf('AGENTS_MARKER');

    expect(bodyIdx).toBeLessThan(claudeIdx);
    expect(claudeIdx).toBeLessThan(agentsIdx);
  });

  it('parts separated by double newline', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      projectNotesMd: 'Claude.',
      agentsMd: 'Agents.',
      isForkWorker: false,
    });
    expect(prompt).toContain('Body.\n\nClaude.\n\nAgents.\n\n');
  });

  it('no extra spacing when projectNotesMd/agentsMd are undefined', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      isForkWorker: false,
    });
    expect(prompt).toMatch(/^Body\.\n\n/);
    expect(prompt).not.toContain('\n\n\n');
  });

  it('NEUT-003: a caller-supplied string suffix replaces the default suffix', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      isForkWorker: false,
      suffix: 'CUSTOM SUFFIX TEXT',
    });
    expect(prompt).toContain('CUSTOM SUFFIX TEXT');
    expect(prompt).not.toContain(getSubagentSuffix());
  });

  it('NEUT-003: a caller-supplied suffix function receives the fork context', () => {
    const prompt = assembleSubagentPrompt({
      agentBody: 'Body.',
      isForkWorker: true,
      suffix: (ctx) => (ctx.isForkWorker ? 'FORK SUFFIX' : 'STANDARD SUFFIX'),
    });
    expect(prompt).toContain('FORK SUFFIX');
    expect(prompt).not.toContain(getForkWorkerSuffix());
  });
});
