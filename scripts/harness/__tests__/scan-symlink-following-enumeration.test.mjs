/**
 * INFRA-105 (#1884) — the committed-script half of the symlink-enumeration rule.
 *
 * `bulk-edit-guard.sh` judges the command an agent is about to run. Once that command is committed as
 * a script, the hook never sees it again — the script runs from CI, from a package manager entry
 * point, from another script. This scan is what covers it there.
 *
 * Both directions for every rule. The safe sibling of each hazardous spelling was MEASURED not to
 * traverse a symlink, and the patterns are shaped so that it does not match; asserting only the
 * hazardous half would leave a scan that could be passing because it flags everything.
 */

import { describe, expect, it } from 'vitest';

import {
  examinedScriptCount,
  findingsIn,
  scanTrackedFiles,
} from '../scan-symlink-following-enumeration.mjs';

const SCRIPT = 'scripts/tools/rewrite.sh';

describe('the four measured spellings', () => {
  const cases = [
    ['find -L', 'find -L packages -name "*.ts" -print0', 'find packages -name "*.ts" -print0'],
    ['grep -R', 'grep -Rl createSession packages/', 'grep -rl createSession packages/'],
    ['rg --follow', 'rg --follow -l createSession packages', 'rg -l createSession packages'],
    [
      'python glob.glob',
      'python3 -c "import glob; print(glob.glob(\'packages/**/*.ts\', recursive=True))"',
      "python3 -c \"from pathlib import Path; print(list(Path('packages').rglob('*.ts')))\"",
    ],
  ];

  it.each(cases)('reports %s', (id, hazardous) => {
    const findings = findingsIn(SCRIPT, hazardous);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe(id);
    expect(findings[0].remedy).toBeTruthy();
  });

  it.each(cases)('does not report the safe sibling of %s', (_id, _hazardous, safe) => {
    expect(findingsIn(SCRIPT, safe)).toEqual([]);
  });

  it.each([
    ['find -L', 'find packages -name "*.ts" -L'],
    ['grep -R', 'grep foo packages -R'],
    ['grep -R', 'grep -l foo packages --dereference-recursive'],
    ['rg --follow', 'rg -l foo packages --follow'],
  ])('reports %s when the flag comes AFTER a positional argument', (id, hazardous) => {
    // Reported in review of this change. `find` and `grep` required the flag to sit in the command's
    // opening flag run, so the trailing form — which follows symlinks exactly the same way — was
    // reported clean while still reaching the store. That is the precise failure the scan exists to
    // catch, passing its own check. All four rules now allow arbitrary words before the flag, and what
    // bounds the search is the segment, not the shape of the flag run.
    expect(findingsIn(SCRIPT, hazardous)).toMatchObject([{ id }]);
  });

  it('reports the line number, so the finding is one edit away from clean', () => {
    const script = ['#!/usr/bin/env bash', 'set -euo pipefail', 'grep -Rl foo packages'].join('\n');
    expect(findingsIn(SCRIPT, script)).toMatchObject([{ line: 3, id: 'grep -R' }]);
  });
});

describe('what it does not report', () => {
  it('ignores a line that discusses the spelling in a comment', () => {
    // The rule has to be explainable in the file that implements it. A scan that flags its own
    // rationale forces the rationale out of the code, which is where it is least likely to be read.
    const script = [
      '# never write: find -L packages',
      '// and not grep -R either',
      'find packages -name x',
    ].join('\n');
    expect(findingsIn(SCRIPT, script)).toEqual([]);
  });

  it('ignores a file type that is not a script', () => {
    expect(findingsIn('docs/why-not-glob.md', 'find -L packages -name "*.ts"')).toEqual([]);
  });

  it('ignores the guard, its test, and this scan itself', () => {
    const hazardous = 'find -L packages -name "*.ts"';
    expect(findingsIn('.claude/hooks/bulk-edit-guard.sh', hazardous)).toEqual([]);
    expect(findingsIn('scripts/harness/scan-symlink-following-enumeration.mjs', hazardous)).toEqual(
      [],
    );
    expect(findingsIn('scripts/harness/__tests__/bulk-edit-guard.test.mjs', hazardous)).toEqual([]);
  });

  it('does not read -L as a find flag when it belongs to grep', () => {
    // `grep -L` is files-without-match. The pattern requires the flag to sit in find's own flag run,
    // which is why this reads clean while `find -L … | xargs grep -l` does not.
    expect(findingsIn(SCRIPT, 'find packages -name "*.ts" | xargs grep -L createSession')).toEqual(
      [],
    );
  });

  it('does not read -L as an rg flag when it belongs to a later command in the pipeline', () => {
    // Found reviewing this change for merge, and it is the finding review already reported against
    // the hook: `rg`'s pattern accepted any words between the command and the flag, so a `-L` two
    // commands downstream was attributed to it. `rg -l` is files-with-matches and `grep -L` is
    // files-without-match — neither follows anything.
    //
    // The fix is the segment split the hook uses. It matters more here: the hook has an ack for a
    // refusal you disagree with, and a scan has none — a false positive is a correct script that
    // cannot be committed.
    expect(findingsIn(SCRIPT, 'rg -l createSession src | xargs grep -L export')).toEqual([]);
    // The hazardous spelling in the SAME shape is still reported, so the split did not simply
    // silence the rule.
    expect(findingsIn(SCRIPT, 'rg --follow -l createSession src | xargs wc -l')).toMatchObject([
      { id: 'rg --follow' },
    ]);
  });

  it('attributes a flag to the command after && that received it', () => {
    expect(findingsIn(SCRIPT, 'cd packages && find -L . -name "*.ts"')).toMatchObject([
      { id: 'find -L' },
    ]);
    expect(findingsIn(SCRIPT, 'find . -name "*.ts" && grep -L foo out.txt')).toEqual([]);
  });
});

describe('the size it declares', () => {
  // A `::examined::` line is a claim about how much was looked at, and a claim nothing checks is
  // where a scan quietly stops covering its population. Asserted EXACTLY, against a fixture whose
  // size is known by construction: a bound would be satisfied by every over-count.
  const FIXTURE = Object.freeze({
    'scripts/tools/rewrite.sh': 'find packages -name "*.ts"',
    'scripts/tools/build.mjs': 'export const x = 1;',
    'scripts/tools/lint.py': 'import os',
    'docs/why.md': 'find -L packages',
    'assets/logo.svg': '<svg/>',
  });
  const paths = Object.keys(FIXTURE);
  const read = (file) => FIXTURE[file];

  it('counts the scripts it opened, and does not accumulate across runs', () => {
    scanTrackedFiles(paths, read);
    expect(examinedScriptCount()).toBe(3);
    // The second run is the point. An accumulating counter passes the first assertion and reads 6
    // here, which would report a growing subject where the subject never changed.
    scanTrackedFiles(paths, read);
    expect(examinedScriptCount()).toBe(3);
  });

  it('opens only the extensions it claims, so the size and the coverage are the same number', () => {
    expect(scanTrackedFiles(paths, read)).toEqual([]);
    expect(examinedScriptCount()).toBe(3);
  });
});
