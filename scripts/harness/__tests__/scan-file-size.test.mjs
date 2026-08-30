import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { loadHarnessConfig } from '../harness-config.mjs';
import {
  baselineDriftFindings,
  evaluateFileSizes,
  isPureReexportBarrel,
  matchesConfiguredHarnessScope,
} from '../scan-file-size.mjs';

/**
 * HARNESS-DIET-003 — the file-size RATCHET. The scan was warn-only (vacuous) for a year; these tests
 * lock in the enforcing semantics: new violators fail, frozen debt may not grow, shrinking tightens.
 */
describe('scan-file-size ratchet (HARNESS-DIET-003)', () => {
  const MAX = 300;

  it('a NEW file over the limit (not baselined) fails', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/big.ts', lineCount: 301 }],
      {},
      MAX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('file-too-large');
  });

  it('a file at or under the limit passes regardless of baseline', () => {
    const { findings } = evaluateFileSizes(
      [
        { relPath: 'packages/x/src/ok.ts', lineCount: 300 },
        { relPath: 'packages/x/src/small.ts', lineCount: 10 },
      ],
      {},
      MAX,
    );
    expect(findings).toHaveLength(0);
  });

  it('a baselined file AT its frozen count passes (debt frozen, not licensed to grow)', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 500 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(0);
  });
});

describe('scan-file-size baseline ratchet transitions', () => {
  const MAX = 300;

  it('a baselined file that GREW past its frozen count fails', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 501 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('file-grew-past-baseline');
  });

  it('a baselined file that SHRANK is reported as ratchet-tightenable, not a finding', () => {
    const { findings, tightenable } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 400 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual(['packages/x/src/legacy.ts']);
  });

  it('a baselined file burned down BELOW the limit is tightenable (drop from baseline)', () => {
    const { findings, tightenable } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/legacy.ts', lineCount: 250 }],
      { 'packages/x/src/legacy.ts': 500 },
      MAX,
    );
    expect(findings).toHaveLength(0);
    expect(tightenable).toEqual(['packages/x/src/legacy.ts']);
  });

  it('a deleted baselined file is reported stale', () => {
    const { stale } = evaluateFileSizes([], { 'packages/x/src/gone.ts': 500 }, MAX);
    expect(stale).toEqual(['packages/x/src/gone.ts']);
  });
});

describe('config-driven harness scope', () => {
  const MAX = 300;
  const scope = loadHarnessConfig().fileSizeAdditionalScope;
  const baseline = JSON.parse(
    readFileSync(new URL('../file-size-baseline.json', import.meta.url), 'utf8'),
  );

  it('adopts an oversized work-run production module into the enforcing scope', () => {
    const files = [
      { relPath: 'scripts/harness/work-run-validation.mjs', lineCount: 301 },
      { relPath: 'scripts/harness/gate.mjs', lineCount: 900 },
    ].filter(({ relPath }) => matchesConfiguredHarnessScope(relPath, scope));

    expect(evaluateFileSizes(files, {}, MAX).findings).toEqual([
      expect.objectContaining({
        file: 'scripts/harness/work-run-validation.mjs',
        type: 'file-too-large',
      }),
      expect.objectContaining({
        file: 'scripts/harness/gate.mjs',
        type: 'file-too-large',
      }),
    ]);
  });

  it('adopts every top-level harness production module while excluding tests', () => {
    expect(
      matchesConfiguredHarnessScope('scripts/harness/scan-work-run-measurement.mjs', scope),
    ).toBe(true);
    expect(matchesConfiguredHarnessScope('scripts/harness/gate.mjs', scope)).toBe(true);
    expect(
      matchesConfiguredHarnessScope(
        'scripts/harness/__tests__/work-run-validation.test.mjs',
        scope,
      ),
    ).toBe(false);
  });

  it('adopts the findings authorization module through the live exact scope', () => {
    expect(scope.exactFiles).toContain('scripts/harness/post-findings-authorization.mjs');
    expect(
      matchesConfiguredHarnessScope('scripts/harness/post-findings-authorization.mjs', scope),
    ).toBe(true);
  });

  it('ratchets the changed non-work-run harness production files', () => {
    const scanner = 'scripts/harness/scan-file-size.mjs';
    const receipt = 'scripts/harness/verification-receipt.mjs';
    expect(scope.exactFiles).toEqual(expect.arrayContaining([scanner, receipt]));
    expect(matchesConfiguredHarnessScope(scanner, scope)).toBe(true);
    expect(matchesConfiguredHarnessScope(receipt, scope)).toBe(true);
    expect(baseline[scanner]).toBeUndefined();
    expect(baseline[receipt]).toBeUndefined();
  });
});

describe('configured harness debt policy', () => {
  const MAX = 300;
  const scope = loadHarnessConfig().fileSizeAdditionalScope;
  const baseline = JSON.parse(
    readFileSync(new URL('../file-size-baseline.json', import.meta.url), 'utf8'),
  );

  it('keeps every newly adopted harness module strict', () => {
    const files = [
      {
        relPath: 'scripts/harness/verification-receipt.mjs',
        lineCount: 301,
      },
      { relPath: 'scripts/harness/work-run-new-module.mjs', lineCount: 301 },
    ].filter(({ relPath }) => matchesConfiguredHarnessScope(relPath, scope));

    expect(evaluateFileSizes(files, baseline, MAX).findings).toEqual([
      expect.objectContaining({ type: 'file-too-large' }),
      expect.objectContaining({ type: 'file-too-large' }),
    ]);
  });
});

/**
 * HARNESS-052. Tightenable and stale entries were PRINTED and the scan exited 0 — 21 advisory lines
 * on every run, and 21 files licensed to grow back to a number they had already beaten. A ratchet
 * whose tightening step is optional is a ratchet that only ever loosens.
 */
describe('baseline drift is a failure, not a notice', () => {
  it('turns a shrunk file into a ratchet-tighten finding', () => {
    const findings = baselineDriftFindings({ tightenable: ['packages/x/src/legacy.ts'] });
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('ratchet-tighten');
    expect(findings[0].detail).toContain('--write-baseline');
  });

  it('turns a baseline entry for a deleted file into a stale-baseline finding', () => {
    const findings = baselineDriftFindings({ stale: ['packages/x/src/gone.ts'] });
    expect(findings.map((f) => f.type)).toEqual(['stale-baseline']);
  });

  it('reports nothing when the baseline is already tight', () => {
    expect(baselineDriftFindings({ tightenable: [], stale: [] })).toEqual([]);
    expect(baselineDriftFindings()).toEqual([]);
  });
});

/**
 * ARCH-038 (issue #1806) — the re-export-barrel exemption, and the fact that it is EARNED.
 *
 * The reason this needs its own cases rather than a config entry and a shrug: an exemption nothing
 * verifies is the same defect as a guard that cannot fire, one level up. Every case below asks either
 * "does it apply when it should" or "does it STOP applying when the file stops being a barrel".
 */
describe('scan-file-size re-export barrel exemption (ARCH-038)', () => {
  const MAX = 300;
  const BARREL = 'packages/x/src/index.ts';
  const exempt = new Map([[BARREL, 'the published surface']]);

  it('exempts a listed file that is genuinely a pure re-export list', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: BARREL, lineCount: 689, pureReexport: true }],
      {},
      MAX,
      exempt,
    );
    expect(findings).toEqual([]);
  });

  it('does NOT exempt a listed file that has grown real code', () => {
    // The half that makes the entry falsifiable. Without it the exemption is a licence keyed on a
    // filename, and the next thing added to that file rides in free.
    const { findings } = evaluateFileSizes(
      [{ relPath: BARREL, lineCount: 689, pureReexport: false }],
      {},
      MAX,
      exempt,
    );
    expect(findings.map((f) => f.type)).toEqual([
      'reexport-barrel-exemption-unearned',
      'file-too-large',
    ]);
  });

  it('reports an entry naming a file the scan never measured', () => {
    // A stale exemption protects nothing and reads in review as if it did — the same shape as a
    // stale baseline row, which this scan already reports.
    const { findings } = evaluateFileSizes([], {}, MAX, exempt);
    expect(findings.map((f) => f.type)).toEqual(['reexport-barrel-exemption-unused']);
  });

  it('drops an exempt file from the baseline rather than freezing a count for it', () => {
    const { tightenable } = evaluateFileSizes(
      [{ relPath: BARREL, lineCount: 689, pureReexport: true }],
      { [BARREL]: 689 },
      MAX,
      exempt,
    );
    expect(tightenable).toEqual([BARREL]);
  });

  it('leaves every unlisted file judged exactly as before', () => {
    const { findings } = evaluateFileSizes(
      [{ relPath: 'packages/x/src/other.ts', lineCount: 689, pureReexport: true }],
      {},
      MAX,
      exempt,
    );
    // Being a pure barrel is not itself an exemption — someone has to say so, with a reason.
    expect(findings.map((f) => f.type)).toContain('file-too-large');
  });
});

describe('isPureReexportBarrel (ARCH-038)', () => {
  it.each([
    ['a single-line named re-export', `export { a, b } from './m.js';`],
    ['a type re-export', `export type { A } from './m.js';`],
    ['a multi-line block', `export {\n  a,\n  b as c,\n} from './m.js';`],
    ['per-specifier type members', `export {\n  a,\n  type B,\n  type C,\n} from './m.js';`],
    [
      'a docblock above the exports',
      `/**\n * why this barrel exists\n */\nexport { a } from './m.js';`,
    ],
    ['a line comment', `// note\nexport { a } from './m.js';`],
    ['an empty file', ''],
  ])('accepts %s', (_name, content) => {
    expect(isPureReexportBarrel(content)).toBe(true);
  });

  it.each([
    ['an import', `import { x } from './m.js';\nexport { a } from './m.js';`],
    ['a local const', `export { a } from './m.js';\nconst x = 1;`],
    ['an exported function', `export function f() {}`],
    ['a local type alias', `export type T = string;`],
    ['an exported const', `export const X = 1;`],
    ['a re-export block that never closes', `export {\n  a,`],
  ])('rejects %s', (_name, content) => {
    expect(isPureReexportBarrel(content)).toBe(false);
  });
});
