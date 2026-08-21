/**
 * INFRA-111 — "what does this command write to" has ONE owner, and both guards ask it.
 *
 * Two guards asked that question and each answered it with its own regex over redirection
 * spellings. The holes were real and they were DIFFERENT sets, which is the part that matters:
 * `bulk-edit-guard.sh` permitted the whole `>&` family into `node_modules`, and
 * `branch-guard.sh` permitted `>&` AND `>|` into `.husky/` — under a refusal whose own text reads
 * "Zero exceptions". Three cuts of one regex, and the second cut's commit claimed `>|` was "the
 * only miss across eight probed spellings" one round before five more were measured.
 *
 * A hand-enumeration that certifies its own exhaustiveness and is wrong the following round is the
 * evidence that enumeration is the wrong shape. So the grammar has one owner — the tokenizer in
 * `command-scan.sh`, which already had to find redirections to keep an `&` from splitting a
 * statement — and this file drives ONE case table through all three consumers: the reader itself,
 * and each guard against the path IT protects.
 *
 * That single table is the mechanism, not a convenience. A spelling added to the grammar reaches
 * both guards at once, and a spelling added to this table fails in every consumer that missed it,
 * which is what neither guard could have while each held its own list.
 *
 * WHAT BASH ACTUALLY DOES, measured rather than enumerated (`echo x <SPELLING> FILE`, then `ls`):
 *
 *   > >> >| &> &>> 2> >& >&NAME <>   create or write FILE
 *   2>& NAME                         bash: ambiguous redirect — writes NOTHING
 *   >>& NAME                         bash: syntax error — writes nothing
 *   2>&1  >&2  1>&2  >&-             duplicate or close a descriptor; no file
 *
 * Two rows the filing item listed as holes are therefore commands bash itself refuses. They stay in
 * the WRITES table anyway, and that is a deliberate direction rather than an oversight: the reader
 * decides by shape, and over-reporting a command bash rejects costs a refusal of something that
 * cannot run, while under-reporting one it accepts is a bypass. `<>` is the opposite case — it was
 * in neither guard's regex, and it does create the file.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const HOOKS_SRC = path.join(WORKSPACE_ROOT, '.claude/hooks');
const LIB = path.join(HOOKS_SRC, 'lib/command-scan.sh');

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

function makeTemp(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/**
 * THE TABLE. `spelling` is substituted for `<R>` and the protected path for `<P>`, so one row is
 * asked of every consumer rather than each consumer carrying its own list.
 */
const WRITES = [
  ['plain truncating redirect', '> <P>'],
  ['appending redirect', '>> <P>'],
  ['clobbering redirect', '>| <P>'],
  ['stdout and stderr together', '&> <P>'],
  ['stdout and stderr, appending', '&>> <P>'],
  ['an explicit descriptor', '2> <P>'],
  ['the ampersand-after form, spaced', '>& <P>'],
  ['the ampersand-after form, unspaced', '>&<P>'],
  ['the ampersand-after form, quoted', '>&"<P>"'],
  ['a descriptor-qualified ampersand form', '2>& <P>'],
  ['a doubled arrow with an ampersand', '>>& <P>'],
  ['open for reading AND writing', '<> <P>'],
];

/**
 * Spellings that name NO FILE AT ALL — the operator moves or closes a descriptor.
 *
 * Asserted as "the reader returns nothing", not as "the reader does not return the protected
 * path". The weaker form is what this file first shipped, and it was a row that could not fail on
 * the condition it names: `2>&1` yields the target `1`, which is not `node_modules/...` either way,
 * so deleting the descriptor rule entirely left all seven rows green. Measured, not reasoned about
 * — the rule was removed and the suite stayed at 74 passed.
 */
const NAMES_NO_FILE = [
  ['stderr onto stdout', 'echo x 2>&1'],
  ['stdout onto stderr', 'echo x >&2'],
  ['an explicit descriptor onto another', 'echo x 1>&2'],
  ['closing a descriptor', 'echo x >&-'],
  ['a descriptor with a trailing dash', 'echo x >&2-'],
  ['reading, not writing', 'cat <P>'],
  ['an arrow inside a quoted argument', 'echo "a > <P> mention"'],
];

/** Spellings that DO write, but somewhere the guard does not protect. */
const WRITES_ELSEWHERE = [
  ['a redirect that leaves the protected path', 'cat <P> > /tmp/elsewhere-infra-111'],
];

/** Everything both guards must permit, whatever the reason. */
const WRITES_NOTHING = [...NAMES_NO_FILE, ...WRITES_ELSEWHERE];

// The replacement is a FUNCTION, not a string. `String.replaceAll` reads `$'`, `$&` and `` $` `` in
// a string replacement as patterns, so a path written `$'a dir'/out.txt` — a legitimate shell
// dollar-quote — was rewritten into `a dir'/out.txt` before it ever reached a shell, and the row
// asserting quote handling was quietly testing something else. A function replacement is literal.
/**
 * The same four quotings, written around a path INSIDE the store, for the guard-level rows.
 *
 * Kept beside the table rather than inside one describe, because two consumers ask it and a second
 * copy is how the two guards drifted apart in the first place.
 */
const QUOTED_STORE_PATHS = [
  ['double quotes around a space', '"node_modules/a dir/index.js"'],
  ['single quotes around a space', "'node_modules/a dir/index.js'"],
  ['a dollar-quoted segment', "$'node_modules'/pkg/index.js"],
  ['a locale-quoted segment', '$"node_modules"/pkg/index.js'],
];

const fill = (shape, protectedPath) => shape.replaceAll('<P>', () => protectedPath);

// ---------------------------------------------------------------------------------------------
// 1. The reader itself.
// ---------------------------------------------------------------------------------------------

function targetsOf(command) {
  const result = spawnSync(
    'bash',
    // The library path is an ARGUMENT, not interpolated into the program text. Nothing here is
    // attacker-controlled, but a test that reads a shell command out of a template is the shape this
    // very file is about, and CodeQL says so.
    ['-c', 'source "$1"; hook_redirect_targets "$2"', 'sh', LIB, command],
    { encoding: 'utf8', timeout: 60_000 },
  );
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('hook_redirect_targets names what a command writes to', () => {
  for (const [label, shape] of WRITES) {
    it(`reports the target of ${label}`, () => {
      expect(targetsOf(`echo x ${fill(shape, 'some/dir/out.txt')}`)).toContain('some/dir/out.txt');
    });
  }

  for (const [label, shape] of NAMES_NO_FILE) {
    it(`names no file at all for ${label}`, () => {
      expect(targetsOf(fill(shape, 'some/dir/out.txt'))).toEqual([]);
    });
  }

  for (const [label, shape] of WRITES_ELSEWHERE) {
    it(`reports only the real destination for ${label}`, () => {
      const found = targetsOf(fill(shape, 'some/dir/out.txt'));
      expect(found).not.toContain('some/dir/out.txt');
      expect(found).toEqual(['/tmp/elsewhere-infra-111']);
    });
  }

  it('reports every target when a command has more than one', () => {
    expect(targetsOf('echo x > a.txt 2> b.txt')).toEqual(['a.txt', 'b.txt']);
  });

  /**
   * A quote DELIMITER has two spellings in the mask, and only one of them was being skipped.
   *
   * The tokenizer turns a quote into a SPACE when it read the region as a single-word token, and
   * leaves the quote CHARACTER ITSELF when the region contains whitespace. The reader skipped a
   * space and appended the character, so a target quoted around a space came back wearing its
   * quotes — `"node_modules/a b"` — and the store pattern, anchored on `(^|/)`, could not match it.
   *
   * Measured before the fix, over the eleven write spellings this loop drives and the two quotings:
   * 22 commands permitted by `bulk-edit-guard`, of which 18 create the file under a real bash. The
   * other four are the `2>&` and `>>&` forms bash itself rejects — the deliberate over-report this
   * file documents above, counted here rather than folded into the headline. The table is driven
   * from `WRITES`, so a spelling added there is covered here without being remembered.
   */
  const QUOTINGS = [
    ['double quotes around a space', '"a dir/out.txt"', 'a dir/out.txt'],
    ['single quotes around a space', "'a dir/out.txt'", 'a dir/out.txt'],
    ['a dollar-quoted segment', "$'a dir'/out.txt", 'a dir/out.txt'],
    ['a locale-quoted segment', '$"a dir"/out.txt', 'a dir/out.txt'],
  ];

  // A shape that already carries its own quotes is skipped: filling it would nest one quoting inside
  // another and produce a command bash does not parse, which tests the fixture rather than the rule.
  for (const [label, shape] of WRITES.filter(([, form]) => !/["']/.test(form))) {
    for (const [quoteLabel, written, expected] of QUOTINGS) {
      it(`strips the quotes of ${quoteLabel} after ${label}`, () => {
        expect(targetsOf(`echo x ${fill(shape, written)}`)).toContain(expected);
      });
    }
  }

  it('keeps a quote that is DATA rather than a delimiter', () => {
    // The first cut decided by character class and deleted every quote it met, so a quote belonging
    // to the path went with the delimiters — `a\"b.txt` came back `ab.txt` while bash writes
    // `a"b.txt`. A delimiter is the quote that borders MASKED content; one standing among visible
    // characters is data. These two rows are green only if the reader tells them apart.
    expect(targetsOf('echo x > a\\"b.txt')).toContain('a"b.txt');
    expect(targetsOf(`echo x > 'a"b'/out.txt`)).toContain('a"b/out.txt');
  });

  it('joins a spliced character to the name instead of ending it there', () => {
    // The mode's stated limit says a spliced character is joined, and the splice branch skipped the
    // backslash and let the loop meet the escaped character on its own terms — so an escaped SPACE
    // hit the word break and the name ended at `a`. Bash writes `a b/node_modules/c`, which is
    // inside the store, so the shortened name matched nothing and the write was permitted.
    expect(targetsOf('echo x > a\\ b/node_modules/c')).toContain('a b/node_modules/c');
  });

  it('leaves an expansion unresolved, and reads no target from a quoted mention', () => {
    expect(targetsOf('echo x > $dir/out.txt')).toContain('$dir/out.txt');
    expect(targetsOf('echo "a > b"')).toEqual([]);
  });
});

/**
 * The same table read through ONE STATEMENT, which is how `branch-guard.sh` asks.
 *
 * This section exists because the whole-command reading above passed for `>|` while the statement
 * reading returned nothing, and the guard still refused the case — for a different reason. A row
 * that passes for a reason other than the one it names is a row that is not testing anything, and
 * this file would have shipped one.
 *
 * The cause was in the STATEMENT SPLIT, not in the reader: `>|` is a single clobbering-redirection
 * operator, and the splitter treated its `|` as a pipe, so the operator landed in one statement and
 * its target in the next. That is the same defect the `&` case above it was already carrying a
 * comment about — `2>&1` split in two — found again one metacharacter over.
 */
function statementTargetsOf(command) {
  const ranges = spawnSync(
    'bash',
    ['-c', 'source "$1"; hook_statement_ranges "$2"', 'sh', LIB, command],
    { encoding: 'utf8', timeout: 60_000 },
  );
  const found = [];
  for (const line of (ranges.stdout ?? '').split('\n')) {
    const [start, length] = line.trim().split(/\s+/);
    if (!start || !length) continue;
    const result = spawnSync(
      'bash',
      [
        '-c',
        'source "$1"; hook_redirect_targets "$2" "$3" "$4"',
        'sh',
        LIB,
        command,
        start,
        length,
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    found.push(
      ...(result.stdout ?? '')
        .split('\n')
        .map((v) => v.trim())
        .filter(Boolean),
    );
  }
  return found;
}

describe('a redirect target is found in the statement that performs it', () => {
  for (const [label, shape] of WRITES) {
    it(`keeps operator and target in one statement for ${label}`, () => {
      expect(statementTargetsOf(`echo x ${fill(shape, 'some/dir/out.txt')}`)).toContain(
        'some/dir/out.txt',
      );
    });
  }

  it('still splits a real pipe', () => {
    expect(statementTargetsOf('cmd > f.txt | grep x')).toEqual(['f.txt']);
  });

  it('still splits a real or-list', () => {
    expect(statementTargetsOf('echo a || echo b > g.txt')).toEqual(['g.txt']);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. bulk-edit-guard.sh, over the same table, against the dependency store.
// ---------------------------------------------------------------------------------------------

function bulkEditVerdict(command) {
  const result = spawnSync('bash', [path.join(HOOKS_SRC, 'bulk-edit-guard.sh')], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: WORKSPACE_ROOT, BULK_EDIT_ACK: '0' },
    timeout: 60_000,
  });
  return result.status ?? -1;
}

describe('bulk-edit-guard refuses every spelling that writes into the store', () => {
  for (const [label, shape] of WRITES) {
    it(`refuses ${label}`, () => {
      expect(bulkEditVerdict(`echo x ${fill(shape, 'node_modules/pkg/index.js')}`)).toBe(2);
    });
  }

  for (const [label, shape] of WRITES_NOTHING) {
    it(`permits ${label}`, () => {
      expect(bulkEditVerdict(fill(shape, 'node_modules/pkg/index.js'))).toBe(0);
    });
  }

  // The quoting matrix, through the GUARD rather than the reader. The defect was reported as a
  // guard-level bypass, and this file's mechanism is one table through every consumer — a doctrine
  // it earned when a reader-level pass hid a statement-level miss for `>|`. A quoting fixed in the
  // reader but not asked of the guard is the same shape of gap.
  for (const [label, shape] of WRITES.filter(([, form]) => !/["']/.test(form))) {
    for (const [quoteLabel, written] of QUOTED_STORE_PATHS) {
      it(`refuses ${label} with ${quoteLabel}`, () => {
        expect(bulkEditVerdict(`echo x ${fill(shape, written)}`)).toBe(2);
      });
    }
  }

  it('permits a write to a directory that merely CONTAINS the store name', () => {
    // The separator anchoring the write-tool rule already had. Without it the two halves of one
    // guard contradicted each other on the case both had a test for.
    expect(bulkEditVerdict('echo x > my_node_modules_notes/out.txt')).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. branch-guard.sh, over the same table, against the hook directory.
// ---------------------------------------------------------------------------------------------

/** A repository the guard can read, checked out on an ordinary feature branch. */
function scratchRepo() {
  const dir = makeTemp('infra111-repo-');
  const run = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  run('init', '--quiet', '--initial-branch=develop');
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  run('add', '-A');
  run('commit', '--quiet', '-m', 'chore: one');
  run('update-ref', 'refs/remotes/origin/develop', 'develop');
  run('checkout', '--quiet', '-b', 'feat/base');
  run('remote', 'add', 'origin', 'https://example.invalid/scratch.git');
  return dir;
}

/** The hooks tree copied out of any worktree path, plus a `gh` that fails rather than reaching out. */
function hooksSandbox() {
  const dir = makeTemp('infra111-hooks-');
  const hooks = path.join(dir, '.claude', 'hooks');
  mkdirSync(path.dirname(hooks), { recursive: true });
  cpSync(HOOKS_SRC, hooks, { recursive: true });
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  chmodSync(path.join(bin, 'gh'), 0o755);
  return { hook: path.join(hooks, 'branch-guard.sh'), bin };
}

let repo;
let sandbox;
beforeAll(() => {
  repo = scratchRepo();
  sandbox = hooksSandbox();
});

function branchGuardVerdict(command) {
  const result = spawnSync('bash', [sandbox.hook], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repo }),
    encoding: 'utf8',
    cwd: repo,
    // Only PATH, HOME and the project dir: no BRANCH_GUARD_ALLOW_* can be what lets a case pass.
    env: {
      PATH: `${sandbox.bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      CLAUDE_PROJECT_DIR: repo,
    },
    timeout: 60_000,
  });
  return result.status ?? -1;
}

describe('branch-guard refuses every spelling that overwrites a hook', () => {
  for (const [label, shape] of WRITES) {
    it(`refuses ${label}`, () => {
      expect(branchGuardVerdict(`echo x ${fill(shape, '.husky/pre-push')}`)).toBe(2);
    });
  }

  for (const [label, shape] of WRITES_NOTHING) {
    it(`permits ${label}`, () => {
      expect(branchGuardVerdict(fill(shape, '.husky/pre-push'))).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// 4. Neither guard may keep a private copy of the grammar.
// ---------------------------------------------------------------------------------------------

describe('the redirection grammar has exactly one implementation', () => {
  it('is not re-derived by a regex in either guard', () => {
    // The failure this pins is not "a `>` appears in the file" — both guards legitimately contain
    // redirections in their own diagnostics. It is that neither may DECIDE a redirect target from a
    // pattern of its own, which is what `hook_redirect_targets` now owns. Both must call it.
    for (const guard of ['bulk-edit-guard.sh', 'branch-guard.sh']) {
      const source = readFileSync(path.join(HOOKS_SRC, guard), 'utf8');
      expect(source, `${guard} must read redirect targets from the shared owner`).toContain(
        'hook_redirect_targets',
      );
    }
  });
});
