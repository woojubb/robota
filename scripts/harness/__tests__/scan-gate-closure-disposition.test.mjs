import { mkdirSync, writeFileSync } from 'node:fs';
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
} = {}) {
  const root = makeTemp('robota-gate-closure-');
  const file = path.join(root, SPEC);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `# Historical spec

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

  it('rejects incomplete exception evidence', () => {
    expect(CLOSED_UNDER.test('**Closed under:** `tool-defect` — G1')).toBe(false);
  });
});
