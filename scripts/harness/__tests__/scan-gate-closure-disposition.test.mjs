import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { CLOSED_UNDER, dispositionFindings } from '../scan-gate-closure-disposition.mjs';
import { makeTemp } from './make-temp.mjs';

// allow-missing-artifact-file: fixtures synthesize governed spec paths inside isolated temp roots

const AUTHORITY = 'https://github.com/woojubb/robota/issues/2664#issuecomment-5749275194';
const SPEC =
  '.agents/spec-docs/done/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md';
const DISPOSITION =
  '**Closed under:** `orchestration-skip` — RULE-2665; gate `GATE-WRITE`; non-compliance `2026-09-07`; retrospective judgement `.agents/spec-docs/done/HARNESS-2660-a-filter-must-name-a-package-that-declares-the-script.md`; authority `' +
  AUTHORITY +
  '`';

function fixture({
  verdict = '🔴 NON-COMPLIANCE',
  date = '2026-09-07',
  line = DISPOSITION,
  extra = '',
  spec = SPEC,
  status = 'done',
  beforeEvidence = '',
} = {}) {
  const root = makeTemp('robota-gate-closure-');
  const file = path.join(root, spec);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `---
status: ${status}
---

# Historical spec

${beforeEvidence}

## Evidence Log

### [GATE-WRITE] — ${verdict} | ${date}

**Status remains:** verifying
**Violation:** orchestration skipped the guardian
**Required action:** disclose the irreversible skip

${extra}${line}
`,
  );
  return { root, file };
}

describe('gate-closure-disposition', () => {
  it('accepts the exact tool-defect evidence form', () => {
    expect(
      CLOSED_UNDER.test(
        '**Closed under:** `tool-defect` — G1; gate `GATE-DONE`; defect record `scripts/harness/scan-gate-closure-disposition.mjs`; evidence `logs/gate.txt`',
      ),
    ).toBe(true);
  });

  it('accepts an orchestration-skip backed by the same gate NON-COMPLIANCE and durable evidence', () => {
    const { root } = fixture();

    expect(dispositionFindings(root)).toEqual([]);
  });

  it.each([
    [
      'wrong gate',
      () => fixture({ line: DISPOSITION.replace('gate `GATE-WRITE`', 'gate `GATE-APPROVAL`') }),
      'matching NON-COMPLIANCE',
    ],
    [
      'wrong date',
      () => fixture({ line: DISPOSITION.replace('2026-09-07', '2026-09-08') }),
      'matching NON-COMPLIANCE',
    ],
    ['ordinary failure', () => fixture({ verdict: '❌ FAIL' }), 'matching NON-COMPLIANCE'],
    [
      'same-gate ordinary failure beside non-compliance',
      () =>
        fixture({
          extra: '### [GATE-WRITE] — ❌ FAIL | 2026-09-06\n\n**Status remains:** draft\n\n',
        }),
      'also has an ordinary FAIL',
    ],
    [
      'existing same-gate PASS',
      () =>
        fixture({
          extra:
            '### [GATE-WRITE] — ✅ PASS | 2026-09-06\n\n**Status upgrade:** draft → review-ready\n\n',
        }),
      'already has a PASS',
    ],
    [
      'missing judgement path',
      () => fixture({ line: DISPOSITION.replace(SPEC, '.agents/spec-docs/done/MISSING.md') }), // allow-missing-artifact: negative fixture validates unresolved judgement paths
      'retrospective judgement path does not resolve',
    ],
    [
      'non-terminal lifecycle',
      () =>
        fixture({
          spec: SPEC.replace('/done/', '/active/'),
          status: 'in-progress',
        }),
      'terminal done spec',
    ],
    [
      'disposition outside the Evidence Log',
      () => fixture({ line: '', beforeEvidence: `${DISPOSITION}\n` }),
      'outside the Evidence Log',
    ],
    [
      'malformed authority',
      () => fixture({ line: DISPOSITION.replace(AUTHORITY, 'this conversation') }),
      'malformed Closed under disposition',
    ],
    [
      'tool-defect label with orchestration-skip fields',
      () => fixture({ line: DISPOSITION.replace('`orchestration-skip`', '`tool-defect`') }),
      'malformed Closed under disposition',
    ],
    [
      'duplicate disposition',
      () => fixture({ extra: `${DISPOSITION}\n` }),
      'more than one Closed under disposition',
    ],
  ])('rejects %s evidence', (_name, makeFixture, detail) => {
    const { root } = makeFixture();

    expect(dispositionFindings(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining(detail) }),
      ]),
    );
  });

  it('rejects retrospective judgement traversal outside spec-docs', () => {
    const traversal = '.agents/spec-docs/done/../../../AGENTS.md';
    const { root } = fixture({ line: DISPOSITION.replace(SPEC, traversal) });
    writeFileSync(path.join(root, 'AGENTS.md'), '# Outside the governed spec root\n');

    expect(dispositionFindings(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining('retrospective judgement path does not resolve'),
        }),
      ]),
    );
  });

  it('rejects a retrospective judgement reached through a symlinked parent', () => {
    const linkedJudgement = '.agents/spec-docs/done/linked/JUDGEMENT.md';
    const { root } = fixture({ line: DISPOSITION.replace(SPEC, linkedJudgement) });
    const outside = path.join(root, 'outside-spec-docs');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'JUDGEMENT.md'), '# Outside the governed spec root\n');
    symlinkSync(outside, path.join(root, '.agents/spec-docs/done/linked'), 'dir');

    expect(dispositionFindings(root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detail: expect.stringContaining('retrospective judgement path does not resolve'),
        }),
      ]),
    );
  });

  it('ignores Closed under examples inside fenced code', () => {
    const { root } = fixture({
      beforeEvidence: `\`\`\`markdown\n${DISPOSITION}\n\`\`\`\n`,
    });

    expect(dispositionFindings(root)).toEqual([]);
  });

  it('rejects incomplete exception evidence', () => {
    expect(CLOSED_UNDER.test('**Closed under:** `tool-defect` — G1')).toBe(false);
  });
});
