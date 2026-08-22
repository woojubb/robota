import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

import { describe, expect, it } from 'vitest';

import {
  coveredSubjectCount,
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
 * A fixture repository: harness modules, their tests, and the classification ledger. Nothing here
 * registers a scan, because the population is the tree rather than the registry.
 */
async function createFixture({ modules = {}, tests = {}, ledger = null }) {
  const root = makeTemp('robota-measurement-provenance-');
  const write = (relativePath, content) => {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  };
  for (const [name, source] of Object.entries(modules)) write(`scripts/harness/${name}`, source);
  for (const [name, source] of Object.entries(tests))
    write(`scripts/harness/__tests__/${name}`, source);
  // Classification is mandatory, so a fixture that does not care about the ledger gets every
  // declaring module listed as covered — the state in which a subject's own findings surface.
  const declaring = Object.entries(modules)
    .filter(([, source]) => source.includes('::examined::'))
    .map(([name]) => `scripts/harness/${name}`);
  write(
    'scripts/harness/measurement-provenance-pending.json',
    JSON.stringify(ledger ?? { covered: declaring, pending: [] }),
  );
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

  it('does not make a subject of a module that declares no size', async () => {
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

  it('sees a declaring module no registry names, and one a directory down', async () => {
    // A published size is evidence because it is published, not because a runner calls the module.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE, 'lib/helper.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: {
        covered: ['scripts/harness/scan-a.mjs'],
        pending: ['scripts/harness/lib/helper.mjs'],
      },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
    expect(examinedSubjectCount(), 'the nested module left the population').toBe(2);
    expect(pendingSubjectCount()).toBe(1);
  });

  it('makes a subject of a module that only NAMES the marker, rather than exempting it', async () => {
    // A module that holds the marker to parse someone else's output publishes no size of its own,
    // and this floor still calls it a subject. Over-inclusion costs an entry in the ledger someone
    // can argue with; the alternative — recognising the call that prints — drops every module whose
    // printing helper the test does not know, and drops it silently.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: {
        covered: ['scripts/harness/scan-a.mjs'],
        pending: ['scripts/harness/run-all-scans.mjs'],
      },
    });
    writeFileSync(
      path.join(root, 'scripts/harness/run-all-scans.mjs'),
      "const MARKER = '::examined::';\nconsole.log(MARKER);\n",
      'utf8',
    );
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
    expect(examinedSubjectCount(), 'the runner left the population').toBe(2);
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

  it('does not accept a conditional case, whose run is decided at run time', async () => {
    // `it.runIf(cond)` may not run and `describe.skipIf(cond)` may run; neither is proof, and a
    // reader cannot evaluate the condition. Both resolve to "not a check".
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs':
          "it.runIf(flag)('counts', () => {\n  findThings(big);\n  findThings(small);\n  expect(examinedThingCount()).toBe(3);\n});\n",
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toContain('no-exact-count-assertion');
  });

  it('does not accept a case under a tagged-template skipped suite', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs':
          "describe.skip.each`a`('the counter', () => {\n  it('counts', () => {\n    findThings(big);\n    findThings(small);\n    expect(examinedThingCount()).toBe(3);\n  });\n});\n",
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toContain('no-exact-count-assertion');
  });

  it('does not accept a test file the runner never runs', async () => {
    // `vitest` includes `*.test.{ts,mjs}` only; a `.spec.mjs` sibling is executed by nothing.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.spec.mjs': GREEN_TEST },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['missing-counter-test']);
  });

  it('does not accept a case the runner skips', async () => {
    // A counter checked only by a disabled test is checked by nothing, which is this floor's premise.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it.skip('counts what the walk opened', () => {
  findThings(big);
  findThings(small);
  expect(examinedThingCount()).toBe(3);
});
`,
      },
    });
    const found = types(findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    expect(found).toContain('no-reset-case');
  });

  it('does not accept a live case inside a suite the runner skips', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
describe.skip('the counter', () => {
  it('counts what the walk opened', () => {
    findThings(big);
    findThings(small);
    expect(examinedThingCount()).toBe(3);
  });
});
`,
      },
    });
    const found = types(findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    expect(found).toContain('no-reset-case');
  });

  it('does not accept a case under a curried skipped suite', async () => {
    // `describe.skipIf(cond)(title, body)` closes one argument list and opens another. A span that
    // balances only the first leaves the body live, which is the same false pass as a plain
    // `describe.skip` — and this spelling is already in use in this repository.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
describe.skipIf(true)('the counter', () => {
  it('counts what the walk opened', () => {
    findThings(big);
    findThings(small);
    expect(examinedThingCount()).toBe(3);
  });
});
`,
      },
    });
    const found = types(findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    expect(found).toContain('no-reset-case');
  });

  it('does not pair a reader call with an exact assertion from a later statement', async () => {
    // The reader call and the assertion have to be the same statement, or any nearby literal
    // satisfies any reader — which is how a counter gets certified by an assertion about something
    // else entirely.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  findThings(small);
  const n = examinedThingCount();
  expect(findings.length).toBe(3);
});
`,
      },
    });
    const found = types(findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    expect(found).toContain('no-reset-case');
  });

  it('bounds a terminator-less reader call at its own case, not at the next one', async () => {
    // A statement with no `;` ends where its case's text ends. Without that second bound it reaches
    // forward to the next terminator anywhere in the joined live-case text — which is another case's
    // assertion about something else entirely.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs':
          "it('reads the counter', () => {\n  findThings(big)\n  findThings(small)\n  const n = examinedThingCount()\n})\nit('asserts something else', () => {\n  expect(other.length).toBe(3)\n})\n",
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toContain('no-exact-count-assertion');
  });

  it('accepts a terminator-less assertion inside its own case', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs':
          "it('counts', () => {\n  findThings(big)\n  findThings(small)\n  expect(examinedThingCount()).toBe(3)\n})\n",
      },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
  });

  it('does not accept a negated assertion, which holds for every value but one', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs': `
it('counts what the walk opened', () => {
  findThings(big);
  findThings(small);
  expect(examinedThingCount()).not.toBe(0);
});
`,
      },
    });
    const found = types(findMeasurementProvenanceFindings(root));
    expect(found).toContain('no-exact-count-assertion');
    expect(found).toContain('no-reset-case');
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

  it('does not count an export that exists only in a comment or a string', async () => {
    // The module is read through the same stripper its test is, or a `find…` mentioned in prose
    // would suppress the finding that says nothing can be run to move the counter.
    const root = await createFixture({
      modules: {
        'scan-a.mjs': `
// export function findThings(root) {}
const doc = 'export function findOther(root) {}';
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
});

describe('the pending ledger records debt and cannot grow quietly', () => {
  it('suppresses a recorded subject while it is still unmet', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      ledger: { covered: [], pending: ['scripts/harness/scan-a.mjs'] },
    });
    expect(findMeasurementProvenanceFindings(root)).toEqual([]);
    expect(pendingSubjectCount(), 'the entry was not counted as unmet').toBe(1);
  });

  it('flags a recorded subject that now meets the floor, so the list only shrinks', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: { covered: [], pending: ['scripts/harness/scan-a.mjs'] },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['stale-pending-entry']);
  });

  it('flags an entry naming something that is not a declaring harness module (anti-rot)', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: {
        covered: ['scripts/harness/scan-a.mjs'],
        pending: ['scripts/harness/scan-departed.mjs'],
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['stale-ledger-entry']);
  });

  it('flags a subject in neither list, so a new declaring scan cannot enter unclassified', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: { covered: [], pending: [] },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['unclassified-subject']);
  });

  it('does NOT let the ledger absorb a regression: a covered subject that stops passing still fails', async () => {
    // Recording the debt is for what was never checked. Moving a module that WAS covered into
    // `pending` deletes it from `covered`, and this case is what makes that deletion the only way
    // — leaving it covered reports its findings, exactly as if it had never been listed.
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: {
        'scan-a.test.mjs':
          "it('counts', () => {\n  findThings(big);\n  expect(examinedThingCount()).toBe(3);\n});\n",
      },
      ledger: { covered: ['scripts/harness/scan-a.mjs'], pending: [] },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['no-reset-case']);
  });

  it('flags an entry repeated within a list, which makes its length misdescribe it', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: {
        covered: ['scripts/harness/scan-a.mjs', 'scripts/harness/scan-a.mjs'],
        pending: [],
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['duplicate-ledger-entry']);
  });

  it('flags a subject listed in both lists at once', async () => {
    const root = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: {
        covered: ['scripts/harness/scan-a.mjs'],
        pending: ['scripts/harness/scan-a.mjs'],
      },
    });
    expect(types(findMeasurementProvenanceFindings(root))).toEqual(['ambiguous-classification']);
  });
});

describe('the floor refuses rather than passing over nothing', () => {
  it('throws when the directory it derives its population from is not there', async () => {
    const root = makeTemp('robota-measurement-provenance-bare-');
    expect(() => findMeasurementProvenanceFindings(root)).toThrow(
      /scripts\/harness does not exist/,
    );
  });

  it('throws when no module declares a size, rather than reporting a clean pass', async () => {
    const root = await createFixture({
      modules: { 'helper.mjs': 'export function listFiles() {\n  return [];\n}\n' },
    });
    expect(() => findMeasurementProvenanceFindings(root)).toThrow(/No module under/);
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

  it('does not split on a method call named test, which would cut a case in half', () => {
    // `RE.test(x)` inside a case is not a new case. Splitting there separates a second finder call
    // from the assertion that follows it, and reds compliant work.
    expect(testCases("it('a', () => {\n  if (RE.test(x)) return;\n});\n")).toHaveLength(1);
  });

  it('strips a regular expression opened after a keyword, not just after punctuation', () => {
    // `return /x/` is the common spelling and the space between them is not optional in practice.
    // Read as division, the pattern body leaks into the code stream — the one corruption of this
    // reader that can manufacture a call rather than lose one.
    const stripped = stripNonCode('return /findThings(1)/.test(f);\n');
    expect(stripped, 'the pattern body leaked into the code stream').not.toContain('findThings(1)');
  });

  it('keeps code that follows a template holding an interpolation', () => {
    // The interpolation returns to code and the template then resumes; a reader that treats the
    // resumption as a fresh opener swallows the template's own terminator and everything after it.
    const stripped = stripNonCode('const t = `a${b(c)}d`;\nfindThings(z);\n');
    expect(stripped, 'the tail of the file was swallowed by the template').toContain(
      'findThings(z)',
    );
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

  it('classifies the live ledger by measurement, not by what the file says', () => {
    // The real check on the floor's own numbers: the file is compared against what the run measured,
    // in both directions, so neither list can drift from the tree. `covered + pending === subjects`
    // holds for any tree by construction, so it is not asserted.
    const ledger = JSON.parse(
      readFileSync(
        path.join(WORKSPACE_ROOT, 'scripts/harness/measurement-provenance-pending.json'),
        'utf8',
      ),
    );
    findMeasurementProvenanceFindings();
    expect(ledger.covered.length, 'the covered list disagrees with what the run measured').toBe(
      coveredSubjectCount(),
    );
    expect(ledger.pending.length, 'the pending list disagrees with what the run measured').toBe(
      pendingSubjectCount(),
    );
    // A non-vacuity guard, stated as one: with nothing covered the floor would enforce nothing and
    // still pass. It is a bound because the exact figure belongs to the comparison above, which
    // moves with the tree.
    expect(coveredSubjectCount(), 'nothing meets the floor').toBeGreaterThan(0);
  });
});

describe('this scan measures its own subjects the way it requires of others', () => {
  it('counts the subjects the walk opened and the readers they export', async () => {
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

  it('starts all four counters from zero on the next run', async () => {
    const big = await createFixture({
      modules: { 'scan-a.mjs': MODULE, 'scan-b.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
      ledger: { covered: ['scripts/harness/scan-a.mjs'], pending: ['scripts/harness/scan-b.mjs'] },
    });
    const small = await createFixture({
      modules: { 'scan-a.mjs': MODULE },
      tests: { 'scan-a.test.mjs': GREEN_TEST },
    });

    findMeasurementProvenanceFindings(big);
    expect(examinedSubjectCount()).toBe(2);
    expect(examinedReaderCount()).toBe(2);
    expect(coveredSubjectCount()).toBe(1);
    expect(pendingSubjectCount()).toBe(1);

    findMeasurementProvenanceFindings(small);

    expect(examinedSubjectCount(), 'the subject count carried over').toBe(1);
    expect(examinedReaderCount(), 'the reader count carried over').toBe(1);
    expect(coveredSubjectCount(), 'the covered count carried over').toBe(1);
    expect(pendingSubjectCount(), 'the pending count carried over').toBe(0);
  });
});
