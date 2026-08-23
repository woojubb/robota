import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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
  'Whether a finding is in scope or a separate root item is owned by the finding-depth rule.',
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

  it('registers the architecture-refresh signals and applies finding-depth only to producers', () => {
    for (const token of ['AUDIT-DIM-COMPLETE', 'SYNTH', 'VERIFY', 'RECONCILE']) {
      expect(CLOSED_SIGNAL_VOCAB.has(token)).toBe(true);
    }
    const fixture = (token, body = `${token}: fixture`) =>
      [
        '---',
        `name: fixture-${token.toLowerCase()}`,
        'description: Independent, read-only fixture guardian.',
        'tools: Read, Grep, Glob',
        `signal: ${token}`,
        '---',
        '',
        body,
      ].join('\n');
    expect(analyzeAgent(fixture('SYNTH'), { referencedInIndex: true })).toContainEqual(
      expect.stringMatching(/finding-depth/),
    );
    expect(analyzeAgent(fixture('AUDIT-DIM-COMPLETE'), { referencedInIndex: true })).toContainEqual(
      expect.stringMatching(/finding-depth/),
    );
    expect(analyzeAgent(fixture('VERIFY'), { referencedInIndex: true })).toEqual([]);
    expect(analyzeAgent(fixture('RECONCILE'), { referencedInIndex: true })).toEqual([]);
  });

  // INFRA-048-D. Two HARNESS-049 increments shipped agents that end on a terminal signal but could
  // not register it (`scripts/**` was outside their file ownership), so the token stayed outside the
  // closed vocabulary and the agent had to omit its `signal:` field — a machine contract nothing
  // could check. Each pair is asserted BOTH ways so the entry cannot rot into dead vocabulary: the
  // token is registered, AND the agent that emits it still emits it.
  it.each([
    ['CI TRIAGE', 'ci-failure-triager.md'],
    ['GATE VERDICT', 'backlog-gate-guard.md'],
    ['SCENARIO DRAFTED', 'user-execution-scenario-author.md'],
  ])('registers %s and its emitting agent %s still emits it', (token, agentFile) => {
    expect(CLOSED_SIGNAL_VOCAB.has(token)).toBe(true);
    const agentPath = path.resolve(import.meta.dirname, '../../../.claude/agents', agentFile);
    expect(existsSync(agentPath)).toBe(true);
    expect(readFileSync(agentPath, 'utf8')).toContain(`${token}:`);
  });
});

/**
 * HARNESS-046 — `tools:` may legitimately be a YAML flow array, and prettier (lint-staged's `*.md`
 * formatter) then reflows it past printWidth onto one indented line per tool. The byte-exact shape
 * below is the repo prettier's own output for
 * `tools: [Read, Grep, Glob, Bash, Edit, Write, WebSearch, WebFetch, NotebookEdit, TodoWrite]`.
 *
 * A per-line frontmatter regex reads that as `tools: ''`, which (a) reports a bogus
 * "missing frontmatter field: tools" and, far worse, (b) makes the read-only/edit-tool check blind:
 * a read-only agent carrying `Write` sails straight through. Both are covered here end-to-end.
 */
const WRAPPED_TOOLS = [
  'tools:',
  '  [',
  '    Read,',
  '    Grep,',
  '    Glob,',
  '    Bash,',
  '    Edit,',
  '    Write,',
  '    WebSearch,',
  '    WebFetch,',
  '    NotebookEdit,',
  '    TodoWrite,',
  '  ]',
].join('\n');

const WRAPPED_TOOLS_READONLY_AGENT = [
  '---',
  'name: wrapped-tools-auditor',
  'description: Independent, read-only auditor. Never edits.',
  WRAPPED_TOOLS,
  '---',
  '',
  '# Wrapped Tools Auditor',
  '',
  'Never run tree-mutating git in the working tree.',
].join('\n');

describe('check-agent-def-convention (HARNESS-046) — prettier-wrapped tools array', () => {
  it('sees Edit/Write inside a wrapped tools array on a read-only agent', () => {
    const findings = analyzeAgent(WRAPPED_TOOLS_READONLY_AGENT, { referencedInIndex: true });
    expect(findings.some((f) => /read-only but carries edit tool\(s\): Edit, Write/.test(f))).toBe(
      true,
    );
    expect(findings.some((f) => /missing frontmatter field: tools/.test(f))).toBe(false);
  });

  it('accepts an INLINE flow array of tools', () => {
    const agent = [
      '---',
      'name: inline-flow-fixer',
      'description: Applies findings precisely. Edits docs only.',
      'tools: [Read, Grep, Glob, Bash, Edit, Write]',
      '---',
      '',
      '# Inline Flow Fixer',
    ].join('\n');
    expect(analyzeAgent(agent, { referencedInIndex: true })).toHaveLength(0);
  });

  it('still requires the tree-mutating-git guardrail when Bash arrives via a wrapped array', () => {
    const agent = [
      '---',
      'name: wrapped-unguarded-auditor',
      'description: Independent, read-only auditor.',
      'tools:',
      '  [',
      '    Read,',
      '    Grep,',
      '    Glob,',
      '    Bash,',
      '  ]',
      '---',
      '',
      '# No guardrail in the body.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /tree-mutating git/.test(f))).toBe(true);
  });

  it('still reports an EMPTY tools list as missing (the check is not weakened)', () => {
    const agent = [
      '---',
      'name: empty-tools',
      'description: An agent with no tools declared.',
      'tools: []',
      '---',
      '',
      '# Body',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /missing frontmatter field: tools/.test(f))).toBe(true);
  });

  it('reads a wrapped tools array end-to-end through findAgentDefFindings', async () => {
    const root = makeTemp('robota-agent-def-');
    const agentsDir = path.join(root, '.claude/agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      path.join(agentsDir, 'wrapped-tools-auditor.md'),
      WRAPPED_TOOLS_READONLY_AGENT,
      'utf8',
    );
    const indexPath = path.join(root, 'index.md');
    writeFileSync(indexPath, '- wrapped-tools-auditor — a registered fixture agent.\n', 'utf8');

    const results = findAgentDefFindings(agentsDir, indexPath);
    expect(results).toHaveLength(1);
    expect(results[0].findings.some((f) => /carries edit tool\(s\): Edit, Write/.test(f))).toBe(
      true,
    );
  });
  it('fails a finding-producing agent whose body never references the finding-depth rule', () => {
    const agent = [
      '---',
      'name: scope-creeping-reviewer',
      'description: Independent, read-only reviewer of a change proposal.',
      'tools: Read, Grep',
      'signal: REVIEW VERDICT',
      '---',
      '',
      '# Body',
      '',
      'End with the exact line `REVIEW VERDICT: <ENDORSE|REVISE|REJECT>`.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /never references the finding-depth rule/.test(f))).toBe(true);
  });

  it('passes the same agent once it references the finding-depth rule', () => {
    const agent = [
      '---',
      'name: scoped-reviewer',
      'description: Independent, read-only reviewer of a change proposal.',
      'tools: Read, Grep',
      'signal: REVIEW VERDICT',
      '---',
      '',
      '# Body',
      '',
      'Whether a finding is in scope or a separate root item is owned by the finding-depth rule.',
      '',
      'End with the exact line `REVIEW VERDICT: <ENDORSE|REVISE|REJECT>`.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /never references the finding-depth rule/.test(f))).toBe(false);
  });

  it('does not require the reference of a gate agent, which judges fixed criteria', () => {
    const agent = [
      '---',
      'name: some-gate',
      'description: Independent gate, read-only.',
      'tools: Read, Grep',
      'signal: GATE VERDICT',
      '---',
      '',
      '# Body',
      '',
      'End with the exact line `GATE VERDICT: <PASS|FAIL|NON-COMPLIANCE>`.',
    ].join('\n');
    const findings = analyzeAgent(agent, { referencedInIndex: true });
    expect(findings.some((f) => /never references the finding-depth rule/.test(f))).toBe(false);
  });
});
