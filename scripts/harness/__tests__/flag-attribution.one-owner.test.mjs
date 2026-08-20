/**
 * INFRA-109 — flag attribution has ONE implementation, and both enforcers reach the same verdict.
 *
 * `.claude/hooks/bulk-edit-guard.sh` judges a command as it is about to run;
 * `scan-symlink-following-enumeration.mjs` judges the same spelling once it has become a committed
 * file. They are two halves of one rule, they answered "was this hazardous option passed to THIS
 * command, in THIS statement" with two independent implementations, and only the hook's was ever
 * corrected.
 *
 * MEASURED at the time this was written, driving both over the same commands — two live
 * divergences, and the second is the worse direction:
 *
 *   sed --in-place … node_modules/x    hook PERMITTED   the in-place rule read only the short flag
 *   two statements on two LINES        hook REFUSED     a newline did not separate, so they merged
 *
 * A guard that refuses correct work is one whose ack gets pasted by reflex, and then it protects
 * nothing.
 *
 * The list of spellings is now `scripts/harness/symlink-following-hazards.tsv`, read by both, and
 * the attribution is `.claude/hooks/lib/flag-attribution.sh`, which the scan drives through
 * `.claude/hooks/lib/attribute-lines.sh` for the SHELL population. This file is the case table that
 * keeps them one thing: every row is asked of both halves, so a spelling that reaches one and not
 * the other fails here rather than in a review round.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HAZARD_TABLE,
  fallbackPattern,
  findingsIn,
  hazardRows,
} from '../scan-symlink-following-enumeration.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/bulk-edit-guard.sh');
const ATTRIBUTE_LINES = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/attribute-lines.sh');

/**
 * THE TABLE. One row, both enforcers.
 *
 * `hazards` is what BOTH halves must report — the ids from the shared table — so a row states the
 * verdict once rather than once per enforcer.
 */
const CASES = [
  // The four measured spellings, and the safe sibling of each.
  ['find -L, flag first', 'find -L packages -name x', ['find -L']],
  ['find -L, flag last', "find packages -name '*.ts' -L", ['find -L']],
  ['find, path-qualified', '/usr/bin/find -L packages', ['find -L']],
  ['find -follow, the single-dash long form', 'find packages -follow', ['find -L']],
  ['find without -L', "find packages -name '*.ts'", []],
  ['grep -R', 'grep -R foo .', ['grep -R']],
  ['grep -R inside a cluster', 'grep -nR foo .', ['grep -R']],
  ['grep long form', 'grep --dereference-recursive foo .', ['grep -R']],
  ['grep -r, which does not dereference', 'grep -r foo .', []],
  ['rg long form', 'rg --follow foo', ['rg --follow']],
  ['rg short form', 'rg -L foo', ['rg --follow']],
  ['rg -l, files-with-matches', 'rg -l foo', []],

  // Attribution: the flag belongs to the command that received it.
  ['a -L belonging to a later command in a pipeline', 'rg -l foo packages | xargs grep -L bar', []],
  ['a hazard AFTER a pipe is still seen', 'echo x | find . -L', ['find -L']],
  ['a hazard after a semicolon is still seen', 'echo x ; find . -L', ['find -L']],
  ['a flag standing before its own command', '-L find packages', []],
];

/**
 * Statement separation, asked of the HOOK only.
 *
 * The scan reads a committed file LINE by line, so "do two lines separate" is not a question it can
 * be asked the same way — its unit is already one line. These are the hook's own measured defect.
 */
const HOOK_STATEMENT_CASES = [
  ['a newline separates two statements', 'sed -i s/a/b/ src/a.ts\nls node_modules/.bin', 0],
  ['&& separates two statements', 'sed -i s/a/b/ src/a.ts && ls node_modules/.bin', 0],
  ['an in-place edit into the store is refused', 'sed -i s/a/b/ node_modules/x/y.ts', 2],
  ['the long in-place form is refused too', 'sed --in-place s/a/b/ node_modules/x/y.ts', 2],
  ['the long form with a value', 'sed --in-place=.bak s/a/b/ node_modules/x/y.ts', 2],
  ['perl -i into the store', 'perl -i -pe s/a/b/ node_modules/x/y.ts', 2],
  ['an in-place edit outside the store', 'sed -i s/a/b/ src/a.ts', 0],
];

function hookVerdict(command) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE_ROOT, BULK_EDIT_ACK: '0' },
    timeout: 60_000,
  });
  return { status: result.status ?? -1, stderr: result.stderr ?? '' };
}

/** What the SHARED reader attributes, which is what the hook decides on. */
function sharedAttribution(command) {
  const result = spawnSync('bash', [ATTRIBUTE_LINES, HAZARD_TABLE], {
    input: `${command}\0`,
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return (result.stdout ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1]);
}

/** What the SCAN reports, driven through the same shared reader. */
function scanIds(command) {
  // Attributed per LINE, because that is the scan's unit — one line of a committed file. Handing the
  // same array back for every line reported each hazard once per line, including the empty one after
  // the trailing newline, so the first cut of this helper had every row failing by a duplicate.
  const perLine = command.split('\n').map((line) => sharedAttribution(line));
  return findingsIn(
    'scripts/probe.sh',
    `${command}\n`,
    (_file, lineNumber) => perLine[lineNumber - 1] ?? [],
  ).map((f) => f.id);
}

describe('both enforcers reach the same verdict on one case table', () => {
  for (const [label, command, hazards] of CASES) {
    it(`${label}: the hook`, () => {
      const { status, stderr } = hookVerdict(command);
      expect(status, stderr).toBe(hazards.length > 0 ? 2 : 0);
      for (const id of hazards) expect(stderr).toContain(id);
    });

    it(`${label}: the scan`, () => {
      expect(scanIds(command).sort()).toEqual([...hazards].sort());
    });
  }
});

describe('the hook separates statements the way the shell does', () => {
  for (const [label, command, expected] of HOOK_STATEMENT_CASES) {
    it(label, () => {
      const { status, stderr } = hookVerdict(command);
      expect(status, stderr).toBe(expected);
    });
  }
});

describe('there is one list of spellings, and one bound', () => {
  it('the hook and the scan read the SAME table file', () => {
    const hook = readFileSync(HOOK, 'utf8');
    expect(hook).toContain('symlink-following-hazards.tsv');
    const scan = readFileSync(
      path.join(WORKSPACE_ROOT, 'scripts/harness/scan-symlink-following-enumeration.mjs'),
      'utf8',
    );
    expect(scan).toContain('symlink-following-hazards.tsv');
  });

  it('neither keeps a private list of the hazardous commands', () => {
    // The failure this pins is a hard-coded rule table coming back. Both files legitimately NAME the
    // commands in prose; neither may carry a second `RULES`-shaped literal.
    for (const file of [
      HOOK,
      path.join(WORKSPACE_ROOT, 'scripts/harness/scan-symlink-following-enumeration.mjs'),
    ]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/const RULES\s*=/);
    }
  });

  it('adding a spelling needs no new intermediate-token bound', () => {
    // Every row goes through ONE generated pattern for the fallback and ONE statement reading for
    // the shared path. The four hand-written bounds this replaced were all different, and the lazy
    // unbounded one crossed `|`, `;` and `&&` alike.
    const sources = new Set(hazardRows().map((row) => fallbackPattern(row).source));
    const shapes = new Set(
      [...sources].map((source) =>
        source.replace(/\\b\w+\\s/, 'CMD').replace(/\(\?:[^)]*\)\\b$/, 'OPTS'),
      ),
    );
    expect(shapes.size, [...shapes].join('\n')).toBe(1);
  });

  it('a row that cannot be read is a refusal, not an empty list', () => {
    const result = spawnSync('bash', [ATTRIBUTE_LINES, '/nonexistent/hazards.tsv'], {
      input: 'find . -L\0',
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });
});

describe('the shared reader is what the scan actually used', () => {
  /**
   * Proven by DISAGREEMENT, not by the code path being present.
   *
   * The first cut of this case used `find "$ROOT" -type f -L` and claimed the fallback pattern
   * missed it. It does not — the pattern allows arbitrary words between the command and its flag,
   * which is exactly what that case exercises. Disabling the shared reading entirely left all 45
   * cases green, so the case proved nothing about which reader answered.
   *
   * A QUOTED MENTION is the real discriminator. The tokenizer masks quoted content, so `find` and
   * `-L` inside a string are data and are not attributed; a pattern over text cannot tell the
   * difference. This is also the direction that matters: this repository's own rule files, task
   * records and tests all DISCUSS the hazardous spellings in prose, and a scan that reports them is
   * one that gets an allowlist entry per document until it reports nothing.
   */
  const QUOTED = 'echo "find -L packages"';

  it('does not attribute a spelling that is quoted data', () => {
    expect(sharedAttribution(QUOTED)).toEqual([]);
  });

  it('the fallback pattern DOES match it, so the two readings differ here', () => {
    const row = hazardRows().find((r) => r.id === 'find -L');
    expect(fallbackPattern(row).test(QUOTED)).toBe(true);
  });

  it('and the scan reports nothing, which is only possible through the shared reading', () => {
    expect(scanIds(QUOTED)).toEqual([]);
  });

  it('the helper is executable and exits 0 on a clean batch', () => {
    const out = execFileSync('bash', [ATTRIBUTE_LINES, HAZARD_TABLE], {
      input: 'echo nothing\0ls -la\0',
      encoding: 'utf8',
    });
    expect(out).toBe('');
  });
});
