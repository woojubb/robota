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
  // Each row carries the FILE it is written in. No rule is language-scoped — an earlier cut added
  // one and withdrew it (INFRA-117) — so the column is documentation: it says what a row is meant to
  // represent, not something the code branches on.
  const PY = 'scripts/tools/sweep.py';
  const cases = [
    [
      'find -L',
      'find -L packages -name "*.ts" -print0',
      'find packages -name "*.ts" -print0',
      SCRIPT,
    ],
    ['grep -R', 'grep -Rl createSession packages/', 'grep -rl createSession packages/', SCRIPT],
    [
      'rg --follow',
      'rg --follow -l createSession packages',
      'rg -l createSession packages',
      SCRIPT,
    ],
    [
      'python glob.glob',
      "print(glob.glob('packages/**/*.ts', recursive=True))",
      "print(list(Path('packages').rglob('*.ts')))",
      PY,
    ],
  ];

  // The expected SET, not `toHaveLength(1)`. The length form couples "which rule is under test" to
  // "how many rules the subject trips", and a subject that trips two is not a reason to rewrite the
  // subject into one nobody writes. The set keeps the "and nothing else fired" half as well.
  it.each(cases)('reports %s', (id, hazardous, _safe, file) => {
    const findings = findingsIn(file, hazardous);
    expect(new Set(findings.map((f) => f.id))).toEqual(new Set([id]));
    expect(findings.every((f) => f.remedy)).toBe(true);
  });

  it.each(cases)('does not report the safe sibling of %s', (_id, _hazardous, safe, file) => {
    expect(findingsIn(file, safe)).toEqual([]);
  });

  it('judges a python CALL wherever it is written, including a non-python file', () => {
    // The call rule carries no language on purpose. A `.mjs` harness script spawning `python3 -c`
    // holds a python payload, a shell heredoc holds one too, and a first cut that scoped this rule
    // by file language stopped judging both — while the rule text still claimed the committed-file
    // side was covered.
    expect(
      findingsIn('scripts/tools/build.mjs', 'execSync(\'python3 -c "print(glob.glob(1))"\')'),
    ).toMatchObject([{ id: 'python glob.glob' }]);
    expect(findingsIn('scripts/tools/rewrite.sh', 'glob.glob("**")')).toMatchObject([
      { id: 'python glob.glob' },
    ]);
    expect(
      findingsIn('.github/workflows/ci.yml', '    run: python3 -c "glob.glob(1)"'),
    ).toMatchObject([{ id: 'python glob.glob' }]);
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

/**
 * Issue #1919 — the same symlink-following function reached through an IMPORT binding.
 *
 * `CALL_RULES` matches the `glob.` prefix, which is one spelling of four. The other three were
 * measured reaching the same function with nothing reported, and `from glob import glob` is the more
 * idiomatic of the two forms — so the gap is not exotic.
 */
describe('the import spellings of the same call (issue #1919)', () => {
  const PY_FILE = 'scripts/tools/sweep.py';

  it('reports `from glob import glob` called under its own name', () => {
    const script = ['from glob import glob', 'glob("**")'].join('\n');
    expect(findingsIn(PY_FILE, script).map((f) => f.id)).toContain('python glob imported binding');
  });

  it('reports a module alias — `import glob as g` then `g.glob(...)`', () => {
    const script = ['import glob as g', 'g.glob("**")'].join('\n');
    expect(findingsIn(PY_FILE, script).map((f) => f.id)).toContain('python glob imported binding');
  });

  it('reports a function alias — `from glob import iglob as it` then `it(...)`', () => {
    const script = ['from glob import iglob as it', 'it("**")'].join('\n');
    expect(findingsIn(PY_FILE, script).map((f) => f.id)).toContain('python glob imported binding');
  });

  it('does NOT report the javascript package of the same name (TC-3)', () => {
    // `import glob from 'glob'` names a package that does not follow symlinks. Reporting it is the
    // false positive INFRA-123 recorded as the reason the first widening was withdrawn, so it is
    // pinned here rather than left to the language filter to be trusted about.
    const script = ["import glob from 'glob'", 'glob("**")'].join('\n');
    expect(findingsIn('scripts/tools/build.mjs', script)).toEqual([]);
  });

  it('does NOT report a python file that imports glob and never calls it', () => {
    // A binding is not a use. Reporting the import alone would make the remedy unactionable — there
    // is no call to rewrite.
    expect(findingsIn(PY_FILE, 'from glob import glob')).toEqual([]);
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

  /**
   * A reader honouring the two-mode contract: it refuses a strict read it cannot serve, and answers
   * `null` only when the caller said the read was optional.
   */
  function twoModeReader(table, unreadable) {
    return (file, optional = false) => {
      if (!unreadable.has(file)) return table[file];
      if (optional) return null;
      throw new Error(`strict read of ${file} must not be served`);
    };
  }

  it('does not count a file it describes-but-does-not-judge', () => {
    // The allowlisted files are the guard, its tests and the record. They were opened, counted, and
    // then returned empty, so the declared size exceeded the judged population by exactly their
    // number. The fixture had no such row, which is why nothing caught it.
    const withAllowed = { ...FIXTURE, '.claude/hooks/bulk-edit-guard.sh': 'find -L packages' };
    expect(scanTrackedFiles(Object.keys(withAllowed), (file) => withAllowed[file])).toEqual([]);
    expect(examinedScriptCount()).toBe(3);
  });

  it('judges an extensionless file that says it is a shell script', () => {
    // A property of the file beats a list of places the property is assumed to hold. This
    // repository's own git hooks carry no extension and were invisible to the first cut.
    const withHook = { ...FIXTURE, '.husky/pre-push': '#!/usr/bin/env sh\nfind -L packages\n' };
    const findings = scanTrackedFiles(Object.keys(withHook), (file) => withHook[file]);
    expect(findings.map((f) => f.file)).toEqual(['.husky/pre-push']);
    expect(examinedScriptCount()).toBe(4);
  });

  it('judges an extensionless script in any language its rules are written against', () => {
    const withPython = {
      ...FIXTURE,
      'scripts/tools/sweep': '#!/usr/bin/env python3\nimport glob\nglob.glob("**")\n',
    };
    const findings = scanTrackedFiles(Object.keys(withPython), (file) => withPython[file]);
    // The assertion is on WHICH file was judged. Deduplicated because a fixture may trip a rule on
    // more than one line, and the property under test is the population, not the line count.
    expect([...new Set(findings.map((f) => f.file))]).toEqual(['scripts/tools/sweep']);
    expect(examinedScriptCount()).toBe(4);
  });

  it('does not admit ruby, whose extension the population excludes', () => {
    // The two filters have to agree about one population. A cut listing `ruby` in the shebang
    // alternation while `SCANNED_EXTENSIONS` had no `.rb` judged the SAME script when written
    // without an extension and ignored it as `sweep.rb` — one file disagreeing with itself.
    //
    // This pins the `ruby` case ONLY, and deliberately does not claim the general invariant: three
    // interpreters still in the alternation have no matching extension, which is the defect the
    // `Contained — INFRA-115.` label on `SHEBANG` records. A green case under a general title would
    // read as proof of something the source says is untrue.
    const body = '#!/usr/bin/env ruby\nsystem("find -L packages")\n';
    const extensionless = { ...FIXTURE, 'scripts/tools/sweep': body };
    expect(scanTrackedFiles(Object.keys(extensionless), (f) => extensionless[f])).toEqual([]);
    const extensioned = { ...FIXTURE, 'scripts/tools/sweep.rb': body };
    expect(scanTrackedFiles(Object.keys(extensioned), (f) => extensioned[f])).toEqual([]);
  });

  it('does not judge an extensionless file that is not a script, and does not count it', () => {
    const withData = { ...FIXTURE, 'docs/CODEOWNERS': '* @someone\n' };
    expect(scanTrackedFiles(Object.keys(withData), (file) => withData[file])).toEqual([]);
    expect(examinedScriptCount()).toBe(3);
  });

  it('treats an unreadable EXTENSIONLESS path as not-a-script rather than as a failure', () => {
    // `git ls-files` lists a tracked symlink to a directory, and reading it as text throws. That is
    // an answer to "is this a script", not an error — and the read is the optional one.
    const read2 = twoModeReader(FIXTURE, new Set(['link']));
    expect(scanTrackedFiles([...paths, 'link'], read2)).toEqual([]);
    expect(examinedScriptCount()).toBe(3);
  });

  it('asks optionally ONLY for a path the extension list did not admit', () => {
    // `twoModeReader` throws when a read it was told is STRICT cannot be served. A `.sh` file is in
    // the population by its extension, so asking for it optionally would let a reader answer
    // "nothing here" for a file that must be judged.
    const read2 = twoModeReader(FIXTURE, new Set(['scripts/tools/rewrite.sh']));
    expect(() => scanTrackedFiles(paths, read2)).toThrow(/strict read/);
  });

  it('refuses a strict read that came back empty, rather than skipping it', () => {
    // A reader that returns nothing for an in-population file must not be silently obeyed.
    const read2 = (file) => (file === 'scripts/tools/rewrite.sh' ? null : FIXTURE[file]);
    expect(() => scanTrackedFiles(paths, read2)).toThrow(/A strict read must refuse, not skip/);
  });
});
