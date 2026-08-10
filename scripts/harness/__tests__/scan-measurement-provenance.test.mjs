import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  examinedModuleCount,
  examinedReaderCount,
  findMeasurementProvenanceFindings,
} from '../scan-measurement-provenance.mjs';

async function createFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-measurement-provenance-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

/** A module shaped like every harness scan: one finder, one exported size reader. */
const MODULE = `
export function findThings(root) {
  return [];
}
export function examinedThingCount() {
  return 0;
}
`;

function types(findings) {
  return findings.map((f) => f.type);
}

describe('a size reader with no test is a claim nothing checks', () => {
  it('flags a module whose reader has no sibling test file at all', async () => {
    const root = await createFixture({ 'scripts/harness/scan-a.mjs': MODULE });
    expect(types(await findMeasurementProvenanceFindings(root))).toEqual(['missing-counter-test']);
  });

  it('does not treat a module without a size reader as a subject', async () => {
    const root = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': GREEN_TEST,
      'scripts/harness/helper.mjs': 'export function listFiles() {\n  return [];\n}\n',
    });
    expect(await findMeasurementProvenanceFindings(root)).toEqual([]);
  });
});

/** Two runs over DIFFERENT inputs, then an exact assertion — the shape the floor requires. */
const GREEN_TEST = `
it('counts what the walk opened', () => {
  findThings(big);
  expect(examinedThingCount()).toBe(3);
});
it('starts from zero on the next run', () => {
  findThings(big);
  findThings(small);
  expect(examinedThingCount()).toBe(1);
});
`;

describe('a bound is not an exact value', () => {
  it('flags a counter asserted only by a lower bound, which every over-count satisfies', async () => {
    const root = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  findThings(small);
  expect(examinedThingCount()).toBeGreaterThanOrEqual(3);
});
`,
    });
    const found = types(await findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    // The reset case is judged on the same assertion, so a bound loses both — one defect, and the
    // report says which two properties are unproven rather than only the first.
    expect(found).toContain('no-reset-case');
  });
});

describe('a reset is proven by a second, DIFFERENT input', () => {
  it('flags a case that runs the finder twice over the same input', async () => {
    const root = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  findThings(big);
  expect(examinedThingCount()).toBe(3);
});
`,
    });
    // A same-size second run passes whether the counter resets or not, so it proves nothing.
    expect(types(await findMeasurementProvenanceFindings(root))).toEqual(['no-reset-case']);
  });

  it('accepts a reset proven by shape, whatever the case is called', async () => {
    const root = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': GREEN_TEST,
    });
    expect(await findMeasurementProvenanceFindings(root)).toEqual([]);
  });

  it('does not accept a case that only SAYS it resets', async () => {
    const root = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': `
it('RESETS between runs, so a later run cannot inherit an earlier tree size', () => {
  findThings(big);
  expect(examinedThingCount()).toBe(3);
});
`,
    });
    expect(types(await findMeasurementProvenanceFindings(root))).toEqual(['no-reset-case']);
  });
});

describe('the floor refuses rather than passing over nothing', () => {
  it('throws when the harness directory is not there', async () => {
    const root = await createFixture({ 'package.json': '{}\n' });
    expect(() => findMeasurementProvenanceFindings(root)).toThrow(
      /scripts\/harness does not exist/,
    );
  });

  it('throws when the tree holds no size reader at all, rather than reporting a clean pass', async () => {
    const root = await createFixture({
      'scripts/harness/helper.mjs': 'export function listFiles() {\n  return [];\n}\n',
    });
    expect(() => findMeasurementProvenanceFindings(root)).toThrow(/No size reader found/);
  });
});

describe('the live harness tree satisfies its own floor', () => {
  it('has no size reader whose value nothing asserts', async () => {
    expect(await findMeasurementProvenanceFindings()).toEqual([]);
  });
});

describe('this scan measures its own subjects the way it requires of others', () => {
  it('counts the modules the walk opened and the readers found in them', async () => {
    const root = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': GREEN_TEST,
      'scripts/harness/scan-b.mjs': `${MODULE}\nexport function examinedOtherCount() {\n  return 0;\n}\n`,
      'scripts/harness/__tests__/scan-b.test.mjs': `${GREEN_TEST}\nit('counts the other subject', () => {\n  findThings(big);\n  findThings(small);\n  expect(examinedOtherCount()).toBe(1);\n});\n`,
      // Not a module: the walk is depth-1 over `.mjs`, so neither the test directory nor a
      // non-module file is a subject.
      'scripts/harness/notes.md': '# notes\n',
    });

    await findMeasurementProvenanceFindings(root);

    expect(examinedModuleCount(), 'the module walk was miscounted').toBe(2);
    expect(examinedReaderCount(), 'the reader count did not follow the walk').toBe(3);
  });

  it('starts both counters from zero on the next run', async () => {
    const big = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': GREEN_TEST,
      'scripts/harness/scan-b.mjs': MODULE,
      'scripts/harness/__tests__/scan-b.test.mjs': GREEN_TEST,
    });
    // Smaller rather than empty: a second fixture of the same size passes whether the counters
    // reset or not, and an empty one cannot be used here because this scan refuses it.
    const small = await createFixture({
      'scripts/harness/scan-a.mjs': MODULE,
      'scripts/harness/__tests__/scan-a.test.mjs': GREEN_TEST,
    });

    await findMeasurementProvenanceFindings(big);
    expect(examinedModuleCount()).toBe(2);
    expect(examinedReaderCount()).toBe(2);

    await findMeasurementProvenanceFindings(small);

    expect(examinedModuleCount(), 'the module count carried over').toBe(1);
    expect(examinedReaderCount(), 'the reader count carried over').toBe(1);
  });
});
