import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  examinedClaimCount,
  extractClaims,
  findContradictions,
  scanRules,
} from '../scan-rule-contradictions.mjs';

describe('rule-to-rule normative contradiction detection', () => {
  it('fails on a weaker claim about the same subject and predicate', () => {
    const claims = [
      ...extractClaims('- **Workspace access** MUST use the session policy.\n', 'a.md'),
      ...extractClaims('- **Workspace access** SHOULD use the session policy.\n', 'b.md'),
    ];
    const findings = findContradictions(claims);
    expect(findings).toHaveLength(1);
    expect(findings[0].suppressed).toBe(false);
  });

  it('fails on opposite polarity but ignores equal claims and unrelated subjects', () => {
    const claims = [
      ...extractClaims('- **Secrets** MUST NOT cross the boundary.\n', 'a.md'),
      ...extractClaims('- **Secrets** MUST cross the boundary.\n', 'b.md'),
      ...extractClaims('- **Secrets** MUST NOT cross the boundary.\n', 'c.md'),
      ...extractClaims('- **Logs** MUST cross the boundary.\n', 'd.md'),
    ];
    expect(findContradictions(claims)).toHaveLength(2);
  });

  it('requires a non-empty, same-line suppression reason', () => {
    const claims = [
      ...extractClaims(
        '- **Workspace access** MUST use the policy. allow-rule-contradiction: legacy wording\n',
        'a.md',
      ),
      ...extractClaims('- **Workspace access** MAY use the policy.\n', 'b.md'),
    ];
    expect(findContradictions(claims)[0].suppressed).toBe(true);
    expect(
      extractClaims(
        '- **Workspace access** MUST use the policy. allow-rule-contradiction:\n',
        'a.md',
      )[0].suppressed,
    ).toBe(false);
  });

  it('ignores fenced code and quoted examples', () => {
    const claims = extractClaims(
      '```\n- **x** MUST do it.\n```\n> **x** MAY do it.\n',
      'fixture.md',
    );
    expect(claims).toEqual([]);
  });

  it('refuses a missing or empty rule corpus', () => {
    const root = makeTemp('rule-contradictions-');
    expect(() => scanRules(root)).toThrow(/is missing/);
    mkdirSync(path.join(root, '.agents/rules'), { recursive: true });
    expect(() => scanRules(root)).toThrow(/no rule documents/);
    writeFileSync(path.join(root, '.agents/rules/rule.md'), 'plain prose\n', 'utf8');
    expect(() => scanRules(root)).toThrow(/no explicit normative claims/);
  });

  it('publishes the exact claim count and resets it for a second sweep', () => {
    const first = makeTemp('rule-contradictions-first-');
    mkdirSync(path.join(first, '.agents/rules'), { recursive: true });
    writeFileSync(path.join(first, '.agents/rules/a.md'), '- **A** MUST do this.\n', 'utf8');
    writeFileSync(path.join(first, '.agents/rules/b.md'), '- **B** MAY do that.\n', 'utf8');
    scanRules(first);
    expect(examinedClaimCount()).toBe(2);

    const second = makeTemp('rule-contradictions-second-');
    mkdirSync(path.join(second, '.agents/rules'), { recursive: true });
    writeFileSync(path.join(second, '.agents/rules/a.md'), '- **A** MUST do this.\n', 'utf8');
    scanRules(second);
    expect(examinedClaimCount()).toBe(1);
  });
});
