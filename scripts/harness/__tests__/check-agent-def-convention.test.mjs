import { describe, expect, it } from 'vitest';

import {
  analyzeAgent,
  parseAgentFile,
  findAgentDefFindings,
  CLOSED_SIGNAL_VOCAB,
} from '../check-agent-def-convention.mjs';

/** A well-formed, conforming read-only signal-bearing agent (standalone fixture, not a real agent). */
const GOOD_READONLY_AGENT = [
  '---',
  'name: fixture-auditor',
  'description: Independent, read-only fixture auditor. Never edits.',
  'tools: Read, Grep, Glob, Bash',
  'signal: ACTIONABLE FINDINGS',
  '---',
  '',
  '# Fixture Auditor',
  '',
  'You are read-only: never run tree-mutating git in the working tree.',
  '',
  'End the report with the exact line `ACTIONABLE FINDINGS: <n>`.',
].join('\n');

describe('check-agent-def-convention (INFRA-030) — parse', () => {
  it('splits frontmatter and body', () => {
    const { frontmatter, body } = parseAgentFile(GOOD_READONLY_AGENT);
    expect(frontmatter.name).toBe('fixture-auditor');
    expect(frontmatter.signal).toBe('ACTIONABLE FINDINGS');
    expect(body).toContain('ACTIONABLE FINDINGS: <n>');
  });
});

describe('check-agent-def-convention (INFRA-030) — PASS', () => {
  it('accepts a conforming read-only signal-bearing agent', () => {
    expect(analyzeAgent(GOOD_READONLY_AGENT, { referencedInIndex: true })).toHaveLength(0);
  });

  it('accepts an edit agent (no signal, carries Edit/Write, not read-only)', () => {
    const agent = [
      '---',
      'name: fixture-fixer',
      'description: Applies findings precisely. Edits docs only.',
      'tools: Read, Grep, Glob, Bash, Edit, Write',
      '---',
      '',
      '# Fixture Fixer',
    ].join('\n');
    expect(analyzeAgent(agent, { referencedInIndex: true })).toHaveLength(0);
  });
});

describe('check-agent-def-convention (INFRA-030) — FAIL (standalone malformed fixtures)', () => {
  it('fails when a declared signal token is not enforced in the body', () => {
    const agent = [
      '---',
      'name: fixture-bad-signal',
      'description: Independent, read-only reviewer.',
      'tools: Read, Grep, Glob, Bash',
      'signal: REVIEW VERDICT',
      '---',
      '',
      '# Body never instructs ending with the token.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /does not instruct ending/.test(f))).toBe(true);
  });

  it('fails a read-only agent with Bash whose body lacks the tree-mutating-git guardrail (HARNESS-DIET-001)', () => {
    const agent = [
      '---',
      'name: unguarded-auditor',
      'description: Independent, read-only auditor.',
      'tools: Read, Grep, Glob, Bash',
      'signal: ACTIONABLE FINDINGS',
      '---',
      '',
      '# Unguarded',
      'End with `ACTIONABLE FINDINGS: <n>`.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /tree-mutating git/.test(f))).toBe(true);
  });

  it('a read-only agent WITHOUT Bash needs no git guardrail', () => {
    const agent = [
      '---',
      'name: no-bash-auditor',
      'description: Independent, read-only auditor.',
      'tools: Read, Grep, Glob',
      'signal: ACTIONABLE FINDINGS',
      '---',
      '',
      '# No Bash',
      'End with `ACTIONABLE FINDINGS: <n>`.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /tree-mutating git/.test(f))).toBe(false);
  });

  it('fails a read-only agent that carries Write', () => {
    const agent = [
      '---',
      'name: fixture-readonly-with-write',
      'description: Independent, read-only auditor.',
      'tools: Read, Grep, Glob, Bash, Write',
      '---',
      '',
      '# Body',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /read-only but carries edit tool/.test(f))).toBe(true);
  });

  it('fails when name/description/tools are missing', () => {
    const agent = ['---', 'name: fixture-missing', '---', '', '# Body'].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /missing frontmatter field: description/.test(f))).toBe(true);
    expect(findings.some((f) => /missing frontmatter field: tools/.test(f))).toBe(true);
  });

  it('fails a signal outside the closed vocabulary', () => {
    const agent = [
      '---',
      'name: fixture-bad-vocab',
      'description: A read-only agent.',
      'tools: Read, Grep, Glob, Bash',
      'signal: RANDOM TOKEN',
      '---',
      '',
      'RANDOM TOKEN: here',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /not in the closed vocabulary/.test(f))).toBe(true);
  });

  it('fails an unregistered agent (not referenced in the skills index)', () => {
    const findings = analyzeAgent(GOOD_READONLY_AGENT, { referencedInIndex: false });
    expect(findings.some((f) => /not referenced in .agents\/skills\/index\.md/.test(f))).toBe(true);
  });
});

describe('check-agent-def-convention (INFRA-030) — real corpus', () => {
  it('passes every real .claude/agents/*.md', () => {
    expect(findAgentDefFindings()).toEqual([]);
  });

  it('exposes the closed signal vocabulary including DECOMPOSITION', () => {
    expect(CLOSED_SIGNAL_VOCAB.has('DECOMPOSITION')).toBe(true);
    expect(CLOSED_SIGNAL_VOCAB.has('REVIEW VERDICT')).toBe(true);
  });
});
