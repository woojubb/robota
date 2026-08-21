/**
 * INFRA-123 — a rule scoped to a LANGUAGE has a subject: the payload.
 *
 * `from glob import glob; glob(…)` and `import glob as g; g.glob(…)` are the symlink-following
 * enumerator wearing an import the call site does not spell. Reading that import requires knowing
 * WHOSE LANGUAGE a line is written in, and neither enforcer could answer it for the place python
 * actually lives here — inside a payload.
 *
 * The two available subjects both missed:
 *
 *   the COMMAND   every reader EXPANDS an interpreter payload, so once `python3 -c "…"` is expanded
 *                 the payload's own `;`, `|` and `&` are indistinguishable from the shell's. Three
 *                 cuts were measured and each refused a correct command.
 *   the FILE      scoped to a file that IS python, the rule judges an empty population here —
 *                 measured: ZERO tracked `.py` files and zero python-shebang files, against 14 files
 *                 containing `python3 -c`, every one `.sh`, `.mjs`, `.md` or `.yml`. Unscoped, it
 *                 reports `import glob from 'glob'` in JavaScript, which is refusing the safe
 *                 sibling.
 *
 * So the import widening was WITHDRAWN rather than shipped unenforced. This file is the reader that
 * lets it ship: `hook_interpreter_payloads` names the interpreter AND the extent, and
 * `payload-language-hazards.tsv` is one list both enforcers read.
 *
 * Every spelling below is built from concatenated fragments. This file would otherwise report
 * ITSELF — which is the whole subject one level up, and an allowlist entry would hide the case that
 * proves the rule works.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fileLanguageOf,
  findingsIn,
  heredocPayloads,
  languageOfInterpreter,
  payloadRows,
} from '../scan-symlink-following-enumeration.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/bulk-edit-guard.sh');
const LIB = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/command-scan.sh');
const PAYLOAD_LINES = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/payload-lines.sh');

/** Never write the hazardous spelling as one token — this file is scanned by the rule it tests. */
const G = `gl${'ob'}`;
const IMPORT_SPELLING = `from ${G} import ${G}`;
const ALIAS_SPELLING = `import ${G} as g; g.${G}(1)`;
const JS_SPELLING = `import ${G} from '${G}'`;
/**
 * The form a formatter produces. `black` and `ruff format` break an import list onto its own lines
 * once it is long enough, and every reader of this table has to mean the same thing by it — the JS
 * side matches across lines, the grep side does not and reads `\n` in a bracket as two dead
 * characters. Both halves were reported clean on this shape while the single-line one was blocked.
 */
const WRAPPED_SPELLING = `from ${G} import (\n    escape,  # noqa\n    i${G} as it,\n)`;
/** The same list with no enumerator in it: `escape` quotes a pattern, it does not walk a tree. */
const WRAPPED_SAFE = `from ${G} import (\n    escape,\n)`;

/**
 * THE TABLE. One row, asked of the hook and of the scan.
 *
 * `hazardous` is what BOTH must conclude, so a row states the verdict once.
 */
const CASES = [
  ['python, the import spelling', `python3 -c "${IMPORT_SPELLING}"`, true],
  ['python, the alias spelling', `python3 -c "${ALIAS_SPELLING}"`, true],
  ['python, the import list a formatter wrapped', `python3 -c "${WRAPPED_SPELLING}"`, true],
  // Separated by TABS. The table spells its whitespace class `[ \t]`, which grep reads as the three
  // characters space, backslash and `t` — never a tab — while the scan's `new RegExp` reads a tab.
  // Both readers now expand the escape, and this row is what says so.
  ['python, separated by tabs', `python3 -c "from\t${G}\timport\t${G}"`, true],
  // Precision, not just reach: the hazardous name is not the first in that list, and the widening
  // that reaches it must not become "a parenthesised glob import is always hazardous".
  ['python, a wrapped list holding no enumerator', `python3 -c "${WRAPPED_SAFE}"`, false],
  // The wrapped shape carrying the SAME text in JavaScript. The single-line row below proves the
  // language check on the flat spelling; this proves the widening did not escape it.
  ['javascript, carrying the wrapped PYTHON spelling', `node -e "${WRAPPED_SPELLING}"`, false],
  ['python, single-quoted payload', `python3 -c '${IMPORT_SPELLING}'`, true],
  ['a versioned interpreter', `python3.12 -c "${IMPORT_SPELLING}"`, true],
  ['python, the safe sibling', 'python3 -c "import pathlib; pathlib.Path(1).rglob(2)"', false],
  // The JS import this repository actually depends on. It passes, but NOT because of the language
  // check — the python patterns simply do not match this text. Kept as the real-world row, and
  // labelled so it is not read as proof of scoping.
  [
    'javascript, the import this repo really uses (pattern-disjoint)',
    `node -e "${JS_SPELLING}"`,
    false,
  ],
  // THIS is the row that proves the scoping. The text matches the python alias pattern exactly, and
  // the only reason it is not reported is that the payload is JavaScript. Removing the language
  // check makes this row fail; removing it did NOT make the row above fail, which is how the
  // difference was found.
  ['javascript, carrying text a PYTHON rule matches', `node -e "${ALIAS_SPELLING}"`, false],
  ['a mention in a string, not a payload', `echo "${IMPORT_SPELLING}"`, false],
  ['a commit message describing it', `git commit -m "python3 says ${IMPORT_SPELLING}"`, false],
  ['nothing at all', 'ls -la', false],
];

function hookVerdict(command) {
  const result = spawnSync('bash', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE_ROOT, BULK_EDIT_ACK: '0' },
    timeout: 60_000,
  });
  return result.status ?? -1;
}

/** The scan's reading of the same command, as a one-line committed shell script. */
function scanIds(command) {
  const payloads = spawnSync('bash', [PAYLOAD_LINES], {
    input: `${command}\0`,
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(payloads.status, payloads.stderr).toBe(0);
  const embedded = (payloads.stdout ?? '')
    .split('\n')
    .filter((row) => row.trim())
    .map((row) => {
      const [, interpreter, start, length] = row.trim().split(/\s+/);
      return {
        interpreter,
        text: command.slice(Number(start) - 1, Number(start) - 1 + Number(length)),
        line: 1,
      };
    });
  return findingsIn(
    'scripts/probe.sh',
    `${command}\n`,
    () => [],
    () => embedded,
  ).map((f) => f.id);
}

describe('both enforcers reach the same verdict on one case table', () => {
  for (const [label, command, hazardous] of CASES) {
    it(`${label}: the hook`, () => {
      expect(hookVerdict(command)).toBe(hazardous ? 2 : 0);
    });

    it(`${label}: the scan`, () => {
      expect(scanIds(command).length > 0).toBe(hazardous);
    });
  }
});

describe('the hook reads this table the way the scan does', () => {
  /*
   * The two rows for these spellings in CASES above already assert both enforcers. These cases
   * exist anyway, and are not redundant with them for two reasons.
   *
   * They name the MECHANISM rather than a verdict: what changed is not that one more spelling is
   * hazardous, it is that `grep -E` was reading this table differently from `new RegExp` —
   * interpreting neither `\t` nor `\n`, and matching one line at a time. Both halves of that are
   * only visible with the hook's answer isolated from the scan's.
   *
   * And a table row is invisible to `check-regression-red-proof.mjs`, which reads added case titles
   * out of the diff: a row's title is built at runtime, so a row added here is judged as a
   * pre-existing case and its red does not count as proof. These titles are literal, so they do.
   */
  it('expands the table escapes, so a TAB-separated import is blocked', () => {
    // Without the expansion `[ \t]` is the three characters space, backslash and `t` — never a tab.
    expect(hookVerdict(`python3 -c "from\t${G}\timport\t${G}"`)).toBe(2);
  });

  it('matches across a line break, so a WRAPPED import list is blocked', () => {
    // grep is line-oriented and a newline cannot be put in its pattern (it reads one as a separator
    // between alternative patterns). Both sides fold the newline onto a sentinel instead.
    expect(hookVerdict(`python3 -c "${WRAPPED_SPELLING}"`)).toBe(2);
  });
});

describe('the reader names the interpreter and the extent', () => {
  function payloadsOf(command) {
    const result = spawnSync(
      'bash',
      ['-c', 'source "$1"; hook_interpreter_payloads "$2"', 'sh', LIB, command],
      { encoding: 'utf8', timeout: 60_000 },
    );
    return (result.stdout ?? '')
      .split('\n')
      .filter((row) => row.trim())
      .map((row) => {
        const [interpreter, start, length] = row.trim().split(/\s+/);
        return {
          interpreter,
          text: command.slice(Number(start) - 1, Number(start) - 1 + Number(length)),
        };
      });
  }

  it('gives the extent EXACTLY, not the whole command', () => {
    // The extent is the half the item says expansion destroys. Asserting the text rather than a
    // boolean is what makes this case about the boundary rather than about detection.
    expect(payloadsOf(`python3 -c "${IMPORT_SPELLING}"`)).toEqual([
      { interpreter: 'python3', text: IMPORT_SPELLING },
    ]);
  });

  it('names each interpreter when one command carries several payloads', () => {
    expect(payloadsOf('python3 -c "a" && node -e "b"')).toEqual([
      { interpreter: 'python3', text: 'a' },
      { interpreter: 'node', text: 'b' },
    ]);
  });

  it('opens no payload for a quoted argument that merely LOOKS like one', () => {
    expect(payloadsOf(`git commit -m "python3 -c is mentioned"`)).toEqual([]);
  });
});

describe('the language of a payload comes from the table INFRA-115 owns', () => {
  it.each([
    ['python3', 'python'],
    ['python3.12', 'python'],
    ['python', 'python'],
    ['node', 'javascript'],
    ['bash', 'shell'],
  ])('%s is %s', (interpreter, language) => {
    expect(languageOfInterpreter(interpreter)).toBe(language);
  });

  it('returns null for an interpreter the table does not have', () => {
    // Null, not a guess: a language-scoped rule with no language is INAPPLICABLE, never universal.
    expect(languageOfInterpreter('ruby')).toBeNull();
  });
});

describe('the three payload sources a committed file can carry', () => {
  it('the FILE itself, when the file IS that language', () => {
    // Zero tracked `.py` files exist today, which is why the item said a file-scoped rule "would
    // enforce nothing while the rule table said it did". Implemented anyway: it costs one lookup and
    // makes the rule non-vacuous the day such a file appears.
    expect(fileLanguageOf('scripts/x.py', '')).toBe('python');
    expect(findingsIn('scripts/x.py', `${IMPORT_SPELLING}\n`).map((f) => f.id)).toEqual([
      'python glob import',
    ]);
  });

  it('a HEREDOC body, which the hook is blind to by design', () => {
    const document = `python3 <<'EOF'\n${IMPORT_SPELLING}\nEOF\necho done\n`;
    expect(heredocPayloads(document)).toEqual([
      { interpreter: 'python3', text: IMPORT_SPELLING, line: 1 },
    ]);
    expect(findingsIn('scripts/x.sh', document).map((f) => f.id)).toEqual(['python glob import']);
  });

  it('parses a heredoc opener in time that does not depend on how many dashes it holds', () => {
    /*
     * CodeQL reported `js/redos` on the first cut of this parse, and it was right. The opener was
     * read with `/(?:^|[\s;&|(])([A-Za-z0-9_.\/-]+)\s*(?:-\S+\s*)*$/`: `\S+` may stop at any
     * interior dash, so a run of them has exponentially many parses, and a tail that cannot match
     * forces the engine through all of them.
     *
     * MEASURED on that regex before replacing it — roughly fourfold per added dash:
     *
     *   16 interior dashes    2.8 ms
     *   20                   41.4 ms
     *   24                  631.8 ms
     *   26                 2543.2 ms
     *
     * This scan reads every tracked file, so that is a scan any committed line can stall. The parse
     * is now by index and by words, which cannot backtrack; measured flat to 2000 dashes.
     *
     * The budget is deliberately loose — this asserts that the cost does not EXPLODE, not that a
     * particular machine hits a particular millisecond.
     */
    const opener = `python3 -${'a-'.repeat(2000)}a z <<'EOF'`;
    const started = process.hrtime.bigint();
    heredocPayloads(`${opener}\nbody\nEOF\n`);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs, `parsing 2000 interior dashes took ${elapsedMs.toFixed(0)}ms`).toBeLessThan(
      1000,
    );
  });

  it('does NOT read a heredoc body whose interpreter is a different language', () => {
    const document = `node <<'EOF'\n${JS_SPELLING}\nEOF\n`;
    expect(findingsIn('scripts/x.sh', document)).toEqual([]);
  });

  it('names the matched text even when the match spans lines', () => {
    // A finding whose subject is empty is a finding the reader cannot act on. The text was found by
    // searching for a matching LINE, and the wrapped import has none — so this shape was reported
    // with the file, the line and nothing to look at.
    const [finding] = findingsIn('scripts/x.py', `${WRAPPED_SPELLING}\n`);
    expect(finding.id).toBe('python glob import');
    expect(finding.text).toContain(`i${G}`);
  });

  it('a JavaScript file carrying the same TEXT is not reported', () => {
    expect(findingsIn('scripts/x.mjs', `${JS_SPELLING}\n`)).toEqual([]);
  });
});

describe('there is one list, and both enforcers read it', () => {
  it('the hook and the scan name the SAME table file', () => {
    for (const file of [
      HOOK,
      path.join(WORKSPACE_ROOT, 'scripts/harness/scan-symlink-following-enumeration.mjs'),
    ]) {
      expect(readFileSync(file, 'utf8')).toContain('payload-language-hazards.tsv');
    }
  });

  it('every row names a language the interpreter table actually has', () => {
    // A row whose language nothing maps to is a rule with no subject — the exact vacuity this item
    // exists to remove, reintroduced as a typo.
    for (const row of payloadRows()) {
      const reachable = ['python3', 'node', 'bash', 'tsx'].some(
        (interpreter) => languageOfInterpreter(interpreter) === row.language,
      );
      expect(reachable, `no interpreter maps to '${row.language}'`).toBe(true);
    }
  });
});
