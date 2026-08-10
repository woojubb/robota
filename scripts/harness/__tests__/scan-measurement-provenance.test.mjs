import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  examinedReaderCount,
  examinedSubjectCount,
  exportedNames,
  findMeasurementProvenanceFindings,
  pendingSubjectCount,
  stripNonCode,
  testCases,
} from '../scan-measurement-provenance.mjs';

/** A module shaped like every declaring scan: one finder, one exported reader, one declaration. */
const MODULE = `
export function findThings(root) {
  return [];
}
export function examinedThingCount() {
  return 0;
}
function main() {
  console.log('::examined:: 1 thing');
}
`;

/** Two runs, then an exact assertion after the second — the shape the floor requires. */
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

/**
 * A fixture repository: a registry naming its scans, the modules themselves, and their tests. The
 * registry is written rather than stubbed because the scan DERIVES its population from it.
 */
async function createFixture({ modules = {}, tests = {}, pending = null, registry = null }) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-measurement-provenance-'));
  const write = (relativePath, content) => {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  };
  for (const [name, source] of Object.entries(modules)) write(`scripts/harness/${name}`, source);
  for (const [name, source] of Object.entries(tests))
    write(`scripts/harness/__tests__/${name}`, source);
  const registered = registry ?? Object.keys(modules);
  write(
    'scripts/harness/run-all-scans.mjs',
    `const SCAN_COMMANDS = [\n${registered
      .map((name) => `  { name: '${name}', command: ['node', 'scripts/harness/${name}'] },`)
      .join('\n')}\n];\n`,
  );
  if (pending !== null)
    write('scripts/harness/measurement-provenance-pending.json', JSON.stringify(pending));
  return root;
}

function types(findings) {
  return findings.map((f) => f.type);
}

describe('the subject population is derived, not recognised by name', () => {
  it('flags a declaring scan whose counter is not exported at all', async () => {
    const root = await createFixture({
      modules: {
        'scan-a.mjs': MODULE,
        'scan-b.mjs': "function main() {\n  console.log('::examined:: 2 things');\n}\n",
      },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['no-exported-size-reader']);
  });

  it('recognises both reader spellings and the const form, so the name is no exemption', async () => {
    const readExamined = MODULE.replace('examinedThingCount', 'readExamined');
    const arrow = `
export const examinedThingCount = () => 0;
export function findThings(root) {
  return [];
}
function main() {
  console.log('::examined:: 1 thing');
}
`;
    const root = await createFixture({
      modules: { 'scan-a.mjs': readExamined, 'scan-b.mjs': arrow },
      tests: {
        'scan-a.test.mjs': GREEN_TEST.replaceAll('examinedThingCount', 'readExamined'),
        'scan-b.test.mjs': GREEN_TEST,
      },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
  });

  it('does not make a subject of a registered scan that declares no size', async () => {
    const root = await createFixture({
      modules: {
        'scan-a.mjs': MODULE,
        'helper.mjs': 'export function listFiles() {\n  return [];\n}\n',
      },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
    expect(examinedSubjectCount(), 'a non-declaring module entered the population').toBe(1);
  });

  it('does not see a declaring module the registry does not name — the stated ceiling', async () => {
    // The blind spot the header declares: an unregistered module publishing a size is invisible
    // here. Pinned so the boundary is a measured fact rather than a sentence in a comment.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE, 'scan-unregistered.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      registry: ['scan-a.mjs'],
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
    expect(examinedSubjectCount()).toBe(1);
  });
});

describe('an assertion is exact, and it comes after the second run', () => {
  it('flags a counter asserted only by a lower bound, which every over-count satisfies', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  findThings(small);
  expect(examinedThingCount()).toBeGreaterThanOrEqual(3);
});
`,
      },
    });
    const found = types(findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    expect(found).toContain('no-reset-case');
  });

  it('flags an assertion taken BEFORE the second run, which describes the first', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  expect(examinedThingCount()).toBe(3);
  findThings(small);
});
`,
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['no-reset-case']);
  });

  it('does not accept a commented-out second run', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  // findThings(small);
  expect(examinedThingCount()).toBe(3);
});
`,
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['no-reset-case']);
  });

  it('does not accept a second run that only appears inside a string', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  const fixture = 'findThings(small)';
  expect(examinedThingCount()).toBe(3);
});
`,
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['no-reset-case']);
  });

  it('accepts a second run over the same input, which an accumulating counter still fails', async () => {
    // n1 + n2 is not n2 whenever the first run counted anything, so repeating the input is a valid
    // proof of the reset. Refusing it would red correct work, and a floor that reds correct work is
    // the one that gets suppressed.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  findThings(big);
  expect(examinedThingCount()).toBe(3);
});
`,
      },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
  });

  it('flags a reader whose module exports nothing a test can run', async () => {
    const root = await createFixture({
      modules: {
        'scan-a.mjs': `
export function examinedThingCount() {
  return 0;
}
function main() {
  console.log('::examined:: 1 thing');
}
`,
      },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['no-exported-finder']);
  });

  it('flags a reader with no test file at all', async () => {
    const root = await createFixture({ modules: { 'scan-a.mjs': MODULE } });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['missing-counter-test']);
  });
});

describe('the pending ledger records debt and cannot grow quietly', () => {
  it('suppresses a recorded subject while it is still unmet', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      pending: { pending: ['scripts/harness/scan-a.mjs'] },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
    expect(pendingSubjectCount(), 'the entry was not counted as unmet').toBe(1);
  });

  it('flags a recorded subject that now meets the floor, so the list only shrinks', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      pending: { pending: ['scripts/harness/scan-a.mjs'] },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['stale-pending-entry']);
  });

  it('flags an entry naming something that is not a declaring registered scan (anti-rot)', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      pending: { pending: ['scripts/harness/scan-departed.mjs'] },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['stale-pending-entry']);
  });
});

describe('the floor refuses rather than passing over nothing', () => {
  it('throws when the registry it derives its population from is not there', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-measurement-provenance-bare-'));
    expect(() => findMeasurementProvenanceFindings(root)).toThrow(
      /run-all-scans\.mjs does not exist/,
    );
  });

  it('throws when no registered scan declares a size, rather than reporting a clean pass', async () => {
    const root = await createFixture({
      modules: { 'helper.mjs': 'export function listFiles() {\n  return [];\n}\n' },
    });
    expect(() => findMeasurementProvenanceFindings(root)).toThrow(/No registered scan/);
  });
});

describe('the source reader is not fooled by text that never runs', () => {
  it('removes comments, string bodies and regular-expression bodies', () => {
    const stripped = stripNonCode(
      "const re = /a'b\\/c/; // findThings(x)\nconst s = 'findThings(y)';\nfindThings(z);\n",
    );
    expect(stripped).not.toContain('findThings(x)');
    expect(stripped).not.toContain('findThings(y)');
    expect(stripped, 'a regular expression containing a quote swallowed the real call').toContain(
      'findThings(z)',
    );
  });

  it('splits cases on `it` and `test` alike, without reading their titles', () => {
    expect(
      testCases("it('a', () => {});\ntest('b', () => {});\nit.each([1])('c', () => {});\n"),
    ).toHaveLength(3);
  });

  it('reads every export form the harness uses', () => {
    const names = exportedNames(
      'export async function findA() {}\nexport const examinedBCount = () => 0;\nconst c = 1;\nexport { c as examinedCCount };\n',
    );
    expect(names).toContain('findA');
    expect(names).toContain('examinedBCount');
    expect(names).toContain('examinedCCount');
  });
});

describe('the live harness tree', () => {
  it('has no declared size that is neither checked nor recorded as unmet', () => {
    expect(findMeasurementProvenanceFindings()).toEqual([]);
  });

  it('records the unmet subjects rather than counting them as covered', () => {
    findMeasurementProvenanceFindings();
    // The ledger is debt, and a pass says so out loud: this number is the distance to the floor,
    // and HARNESS-087 is what closes it.
    expect(pendingSubjectCount()).toBeLessThan(examinedSubjectCount());
    expect(pendingSubjectCount()).toBeGreaterThan(0);
  });
});

describe('this scan measures its own subjects the way it requires of others', () => {
  it('counts the subjects the registry yielded and the readers they export', async () => {
    const root = await createFixture({
      modules: {
        'scan-a.mjs': MODULE,
        'scan-b.mjs': `${MODULE}\nexport function examinedOtherCount() {\n  return 0;\n}\n`,
        'helper.mjs': 'export function listFiles() {\n  return [];\n}\n',
      },
      tests: {
        'scan-a.test.mjs': GREEN_TEST,
        'scan-b.test.mjs': `${GREEN_TEST}\nit('counts the other subject', () => {\n  findThings(big);\n  findThings(small);\n  expect(examinedOtherCount()).toBe(1);\n});\n`,
      },
    });

    findMeasurementProvenanceFindings(root);

    expect(examinedSubjectCount(), 'the subject walk was miscounted').toBe(2);
    expect(examinedReaderCount(), 'the reader count did not follow the walk').toBe(3);
  });

  it('starts all three counters from zero on the next run', async () => {
    const big = await createFixture({
      modules: { 'scan-a.mjs': MODULE, 'scan-b.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      pending: { pending: ['scripts/harness/scan-b.mjs'] },
    });
    const small = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
    });

    findMeasurementProvenanceFindings(big);
    expect(examinedSubjectCount()).toBe(2);
    expect(examinedReaderCount()).toBe(2);
    expect(pendingSubjectCount()).toBe(1);

    findMeasurementProvenanceFindings(small);

    expect(examinedSubjectCount(), 'the subject count carried over').toBe(1);
    expect(examinedReaderCount(), 'the reader count carried over').toBe(1);
    expect(pendingSubjectCount(), 'the pending count carried over').toBe(0);
  });
});
