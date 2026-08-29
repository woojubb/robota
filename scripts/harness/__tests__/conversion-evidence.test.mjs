import { describe, expect, it } from 'vitest';

import { parseConversionEvidence } from '../conversion-evidence.mjs';

const issueNumber = 2514;
const taskId = 'PROC-017';
const baseOid = 'f14b164ba7ef402458f0cf08c69ff920dce9966c';

function text({
  priority = 'P0',
  evidence = true,
  issue = issueNumber,
  markerIssue = issueNumber,
} = {}) {
  return [
    evidence
      ? `Conversion evidence: issue=https://github.com/woojubb/robota/issues/${issue}; task=${taskId}; marker=https://github.com/woojubb/robota/issues/${markerIssue}#issuecomment-5462112669; marker-readback=2026-08-29T11:29:05Z; priority-removed=2026-08-29T11:29:16Z; base=develop; base-oid=${baseOid}`
      : '',
    `Combined lifecycle eligibility: eligible; work-kind=enhancement; priority=${priority}; issue-state=OPEN; child-causes=0; security=none; data-correctness=none; user-decision=none; contract-change=none; owner-count=1`,
  ].join('\n');
}

function parse(taskText, options = {}) {
  return parseConversionEvidence({
    taskText,
    specText: taskText,
    issueNumber,
    taskId,
    baseOid,
    ...options,
  });
}

describe('parseConversionEvidence', () => {
  it('rejects missing evidence', () => {
    const result = parse(text({ evidence: false }));
    expect(result).toEqual({ kind: 'refused', reason: 'conversion-evidence-missing' });
  });

  it.each(['P0', 'P1'])('accepts eligible %s', (priority) => {
    expect(parse(text({ priority })).kind).toBe('eligible');
  });

  it('marker evidence is pure', () => {
    const result = parse(text());
    expect(result).toMatchObject({
      kind: 'eligible',
      conversion: {
        issue: `https://github.com/woojubb/robota/issues/${issueNumber}`,
        task: taskId,
        marker: `https://github.com/woojubb/robota/issues/${issueNumber}#issuecomment-5462112669`,
        'base-oid': baseOid,
      },
      eligibility: { eligible: 'eligible', priority: 'P0' },
    });
  });

  it('refuses each eligibility field', () => {
    for (const field of [
      'work-kind=bug',
      'priority=P2',
      'issue-state=CLOSED',
      'child-causes=1',
      'security=present',
      'data-correctness=present',
      'user-decision=present',
      'contract-change=present',
      'owner-count=2',
    ]) {
      const key = field.slice(0, field.indexOf('='));
      const result = parse(text().replace(new RegExp(`${key}=[^;\\n]+`), field));
      expect(result.kind, field).toBe('refused');
    }
  });

  it('refuses duplicate evidence', () => {
    expect(parse(`${text()}\n${text()}`)).toEqual({
      kind: 'refused',
      reason: 'conversion-evidence-duplicate',
    });
  });

  it('refuses malformed evidence', () => {
    expect(
      parse(text().replace('marker-readback=2026-08-29T11:29:05Z', 'marker-readback=nope')),
    ).toEqual({
      kind: 'refused',
      reason: 'conversion-evidence-malformed',
    });
  });

  it('refuses subject mismatch', () => {
    expect(parse(text({ markerIssue: 2512 }))).toEqual({
      kind: 'refused',
      reason: 'conversion-evidence-subject-mismatch',
    });
  });

  it('refuses unreachable base', () => {
    expect(parse(text().replace(baseOid, '0000000000000000000000000000000000000000'))).toEqual({
      kind: 'refused',
      reason: 'conversion-evidence-base-mismatch',
    });
  });
});
