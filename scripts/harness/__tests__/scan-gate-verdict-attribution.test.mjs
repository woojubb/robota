import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  collectEntries,
  examinedGateEvidenceCount,
  evaluateEntries,
  evidenceEntries,
  main,
} from '../scan-gate-verdict-attribution.mjs';
import { isPostMergeCompletionBatch } from '../scan-user-execution-plan-order.mjs';
import { makeTemp } from './make-temp.mjs';

const entry = (date, judgedBy = '') =>
  `### [GATE-VERIFY] — ✅ PASS | ${date}\n\n${judgedBy ? `**Judged by:** ${judgedBy}\n` : ''}`;

describe('gate verdict attribution scan', () => {
  it('recognizes an explicit manual guardian without rewriting the entry', () => {
    const declaration = 'Independent guardian: Nash. This entry records GATE-WRITE only.';
    const original = `${entry('2026-09-13')}\n${declaration}\n`;
    const entries = evidenceEntries(`## Evidence Log\n\n${original}`);
    expect(entries[0].judgedBy).toBe(declaration);
    expect(entries[0].text).toBe(original);
    expect(evaluateEntries(entries, '2026-09-06').violations).toHaveLength(0);
  });

  it('does not obtain a guardian from hidden or quoted examples', () => {
    const declaration = 'Independent guardian: Hume.';
    for (const example of [
      `\`\`\`markdown\n${declaration}\n\`\`\``,
      `<!--\n${declaration}\n-->`,
      `> ${declaration}`,
      `> Example paragraph\n${declaration}`,
      `    ${declaration}`,
      `\`${declaration}\``,
      `<pre>\n${declaration}\n</pre>`,
    ]) {
      const entries = evidenceEntries(`## Evidence Log\n\n${entry('2026-09-13')}\n${example}\n`);
      expect(evaluateEntries(entries, '2026-09-06').violations, example).toHaveLength(1);
    }
  });

  it('rejects missing, malformed, duplicate or conflicting declarations', () => {
    for (const declarations of [
      'Independent guardian: .',
      'Independent guardian: Nash or Hume.',
      'Independent guardian: Nash, Hume.',
      'Independent guardian: unknown.',
      'Independent guardian: Nash',
      'Mention of Independent guardian: Nash.',
      'Independent guardian: Nash.\n\nIndependent guardian: Nash.',
      'Independent guardian: Nash.\n\nIndependent guardian: Hume.',
      '**Judged by:** Hume\n\nIndependent guardian: Nash.',
      '**Judged by:** Nash\n\nIndependent guardian: .',
    ]) {
      const entries = evidenceEntries(
        `## Evidence Log\n\n${entry('2026-09-13')}\n${declarations}\n`,
      );
      expect(evaluateEntries(entries, '2026-09-06').violations, declarations).toHaveLength(1);
    }
  });

  it('preserves existing canonical entries with multiple recorded judging mechanisms', () => {
    const first = '**Judged by:** inline independent review';
    const records = evidenceEntries(
      `## Evidence Log\n\n${entry('2026-09-13')}\n${first}\n\n**Judged by:** \`gate.mjs\` mechanical evaluator\n`,
    );
    expect(records[0].judgedBy).toBe(first);
    expect(evaluateEntries(records, '2026-09-06').violations).toHaveLength(0);
  });

  it('isolates real entries and preserves canonical attribution and original text', () => {
    const first = `${entry('2026-09-13')}\nIndependent guardian: Carson.\n\n`;
    const hidden =
      '```markdown\n### [GATE-WRITE] — ✅ PASS | 2026-09-13\nIndependent guardian: Nash.\n```\n';
    const second = `${entry('2026-09-13')}${hidden}`;
    const third = `${entry('2026-09-13', '`gate.mjs` mechanical evaluator')}`;
    const records = evidenceEntries(
      `## Evidence Log\n\n${first}${second}${third}\n## Other\n\nIndependent guardian: Nash.\n`,
    );
    expect(records).toHaveLength(3);
    expect(records[0].judgedBy).toBe('Independent guardian: Carson.');
    expect(records[1].judgedBy).toBeNull();
    expect(records[1].text).toBe(second.trimEnd());
    expect(records[2].judgedBy).toBe('**Judged by:** `gate.mjs` mechanical evaluator');
    expect(evaluateEntries(records, '2026-09-06').violations).toEqual([records[1]]);
  });

  it('does not borrow a guardian from a later non-gate subsection', () => {
    const records = evidenceEntries(
      `## Evidence Log\n\n${entry('2026-09-13')}\n### Example\n\nIndependent guardian: Nash.\n`,
    );
    expect(evaluateEntries(records, '2026-09-06').violations).toHaveLength(1);
  });

  it('accepts the two original guardian entries without weakening archive immutability', () => {
    const basename = 'BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md';
    const root = new URL('../../../.agents/spec-docs/', import.meta.url);
    const sources = ['active', 'done']
      .map((stage) => new URL(`${stage}/${basename}`, root))
      .filter(existsSync);
    expect(sources).toHaveLength(1);
    const originals = evidenceEntries(readFileSync(sources[0], 'utf8')).filter((record) =>
      /^Independent guardian: Nash\./m.test(record.text),
    );
    expect(originals).toHaveLength(2);
    expect(evaluateEntries(originals, '2026-09-06').violations).toHaveLength(0);

    const task = `.agents/tasks/${basename}`;
    const archivedTask = `.agents/tasks/completed/${basename}`;
    const spec = `.agents/spec-docs/active/${basename}`;
    const archivedSpec = `.agents/spec-docs/done/${basename}`;
    const ledger = '.agents/loop-runs/post-merge-cycle.jsonl';
    const history = originals.map((record) => record.text).join('\n');
    const before = new Map([
      [
        task,
        `---\nstatus: in-progress\n---\n\nSpec: \`${spec}\`\n\n## Plan\n\n- [ ] Verify attribution\n`,
      ],
      [spec, `---\nstatus: in-progress\n---\n\n## Evidence Log\n\n${history}`],
      [ledger, ''],
    ]);
    const after = new Map([
      [
        archivedTask,
        before
          .get(task)
          .replace('status: in-progress', 'status: done')
          .replace(spec, archivedSpec)
          .replace('[ ]', '[x]'),
      ],
      [
        archivedSpec,
        `${before.get(spec).replace('status: in-progress', 'status: done')}\n\n${entry('2026-09-13', '`gate.mjs`').replace('GATE-VERIFY', 'GATE-COMPLETE')}`,
      ],
      [ledger, '{}\n'],
    ]);
    // This pure predicate proves metadata/history compatibility, not live merge ancestry or terminal gate validity.
    const options = {
      paths: [...new Set([...before.keys(), ...after.keys()])],
      basename,
      textBefore: (file) => before.get(file) ?? null,
      textAfter: (file) => after.get(file) ?? null,
      isPlainFile: () => true,
    };
    expect(isPostMergeCompletionBatch(options)).toBe(true);
    expect(
      evaluateEntries(evidenceEntries(after.get(archivedSpec)), '2026-09-06').violations,
    ).toHaveLength(0);
    const completed = after.get(archivedSpec);
    for (const altered of [
      completed.replace('✅ PASS', '❌ FAIL'),
      completed.replace('2026-09-13', '2026-09-14'),
      completed.replace('Independent guardian: Nash.', 'Independent guardian: Hume.'),
      completed.replace('This entry records', 'This entry changes'),
      completed.replace('**Review fingerprint:**', '**Changed fingerprint:**'),
      completed.replace(originals[0].text, ''),
      completed.replace(
        history,
        [...originals]
          .reverse()
          .map((record) => record.text)
          .join('\n'),
      ),
    ]) {
      expect(altered).not.toBe(completed);
      after.set(archivedSpec, altered);
      expect(isPostMergeCompletionBatch(options)).toBe(false);
    }
  });

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

  it('accepts only exact legacy entry fingerprints', () => {
    const original = evidenceEntries(`## Evidence Log\n\n${entry('2026-09-13')}`)[0];
    const fingerprint = createHash('sha256').update(original.text).digest('hex');
    expect(evaluateEntries([original], '2026-09-06', [fingerprint]).violations).toHaveLength(0);

    const altered = evidenceEntries(
      `## Evidence Log\n\n${entry('2026-09-13')}Historical text changed.\n`,
    )[0];
    expect(evaluateEntries([altered], '2026-09-06', [fingerprint]).violations).toEqual([altered]);
  });

  it('reports both supported attribution forms on the failing scanner path', () => {
    const root = makeTemp('robota-attribution-diagnostic-');
    mkdirSync(`${root}/.agents/spec-docs/done`, { recursive: true });
    mkdirSync(`${root}/scripts/harness`, { recursive: true });
    writeFileSync(
      `${root}/scripts/harness/gate-verdict-attribution-baseline.json`,
      JSON.stringify({ cutoffDate: '2026-09-06' }),
    );
    writeFileSync(
      `${root}/scripts/harness/immutable-attribution-legacy.json`,
      JSON.stringify({ entries: [] }),
    );
    writeFileSync(
      `${root}/.agents/spec-docs/done/a.md`,
      `## Evidence Log\n\n${entry('2026-09-13')}`,
    );
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(main(root)).toBe(1);
      expect(error.mock.calls.flat().join('\n')).toContain('Independent guardian: <name>.');
      expect(error.mock.calls.flat().join('\n')).toContain('**Judged by:**');
    } finally {
      output.mockRestore();
      error.mockRestore();
    }
  });

  it('resets the exported examined counter on each collection', () => {
    const root = makeTemp('robota-2269-counter-');
    mkdirSync(`${root}/.agents/spec-docs/done`, { recursive: true });
    writeFileSync(
      `${root}/.agents/spec-docs/done/a.md`,
      `## Evidence Log\n\n${entry('2026-09-06', '`test`')}`,
    );
    collectEntries(root);
    expect(examinedGateEvidenceCount()).toBe(1);
    writeFileSync(`${root}/.agents/spec-docs/done/a.md`, '# no log\n');
    collectEntries(root);
    expect(examinedGateEvidenceCount()).toBe(0);
  });
});
