import { describe, expect, it } from 'vitest';

import { evaluateEntries, evidenceEntries } from '../scan-gate-verdict-attribution.mjs';

const entry = (date, judgedBy = '') =>
  `### [GATE-VERIFY] — ✅ PASS | ${date}\n\n${judgedBy ? `**Judged by:** ${judgedBy}\n` : ''}`;

describe('gate verdict attribution scan', () => {
  it('counts every gate entry and detects the canonical field', () => {
    const entries = evidenceEntries(
      `## Evidence Log\n\n${entry('2026-09-06', '`gate.mjs`')}${entry('2026-09-06')}`,
      'fixture.md',
    );
    expect(evaluateEntries(entries, '2026-09-06')).toMatchObject({
      total: 2,
      attributed: 1,
      missing: 1,
      baselineMissing: 1,
      violations: [],
    });
  });

  it('rejects a post-baseline entry without attribution', () => {
    const entries = evidenceEntries(`## Evidence Log\n\n${entry('2026-09-07')}`);
    const result = evaluateEntries(entries, '2026-09-06');
    expect(result.violations).toHaveLength(1);
  });

  it('accepts an attributed post-baseline entry', () => {
    const entries = evidenceEntries(
      `## Evidence Log\n\n${entry('2026-09-07', '`backlog-gate-guard`')}`,
    );
    expect(evaluateEntries(entries, '2026-09-06').violations).toHaveLength(0);
  });
});
