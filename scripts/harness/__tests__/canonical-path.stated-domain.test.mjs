/**
 * INFRA-110 — "where does this path actually land" has a stated domain.
 *
 * `bulk-edit-guard.sh` climbed with `dirname` to the deepest existing directory, resolved that with
 * `cd` + `pwd -P`, and re-attached the segments that did not exist yet. The function had no stated
 * domain, so its correctness was whatever input shapes a reviewer happened to try — and three review
 * rounds each found a new one:
 *
 *   round 1  `-e "$FILE_PATH"` is false for the file being created
 *   round 2  the parent may not exist either — add the ancestor climb
 *   round 3  `CDPATH` fails open, `..` is not normalised, the leaf is not resolved
 *
 * Each hole is a one-line patch and all three together are a hand-rolled `realpath` with four special
 * cases and still no domain. So it is the ordinary segment-walk algorithm now, and this file pins
 * both halves: every measured row, and the boundary of the domain itself.
 *
 * allow-missing-artifact-file: every path named in this file is a path in the TEMPORARY SANDBOX the
 * cases build, not a path in this repository — `app/vendored` is a symlink this file creates to
 * stand in for what pnpm does under `node_modules`. They are meant not to resolve here; that is the
 * point of a fixture. The per-line form would put the same sentence on nine lines.
 *
 * The strongest case here is the DIFFERENTIAL one. A hand-written table of shapes is exactly what
 * failed three times; agreeing with the host's independent realpath implementation over a generated
 * corpus is a claim about the whole input class rather than about the shapes someone thought of.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const LIB = path.join(WORKSPACE_ROOT, '.claude/hooks/lib/canonical-path.sh');
const HOOK = path.join(WORKSPACE_ROOT, '.claude/hooks/bulk-edit-guard.sh');
const HAS_GNU_REALPATH =
  spawnSync('realpath', ['-m', '/'], { encoding: 'utf8', timeout: 60_000 }).status === 0;
const PYTHON_REALPATH = 'import os, sys; print(os.path.realpath(sys.argv[1]))';

const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});

/**
 * `app/vendored -> ../node_modules/pkg` and `app/filelink.ts -> ../node_modules/pkg/src/index.ts`.
 *
 * Both halves are load-bearing: the DIRECTORY link is what pnpm actually creates, and the FILE link
 * is the shape the old resolution missed, because it resolved only ancestors and never the leaf.
 */
let sandbox;
beforeAll(() => {
  sandbox = realpathSync(makeTemp('infra110-'));
  scratch.push(sandbox);
  mkdirSync(path.join(sandbox, 'node_modules/pkg/src'), { recursive: true });
  mkdirSync(path.join(sandbox, 'app'), { recursive: true });
  writeFileSync(path.join(sandbox, 'node_modules/pkg/src/index.ts'), 'x\n');
  symlinkSync('../node_modules/pkg', path.join(sandbox, 'app/vendored'));
  symlinkSync('../node_modules/pkg/src/index.ts', path.join(sandbox, 'app/filelink.ts'));
  symlinkSync('loopb', path.join(sandbox, 'loopa'));
  symlinkSync('loopa', path.join(sandbox, 'loopb'));
});

function resolveFrom(base, input, env = {}) {
  const result = spawnSync(
    'bash',
    ['-c', 'source "$1"; canonical_path_from "$2" "$3"', 'sh', LIB, base, input],
    { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 },
  );
  return { status: result.status ?? -1, value: result.stdout ?? '' };
}

/**
 * What the operating system says the same path means.
 *
 * The argument is built by CONCATENATION, never by `path.join`. `path.join` normalises `..`
 * LEXICALLY before `realpath` ever sees the string, and that is the precise error this whole item is
 * about: `app/vendored/../x.ts`, where `app/vendored` is a link into the store, lands in
 * `node_modules/x.ts` and lexical normalising calls it `app/x.ts`.
 *
 * The first cut of this file used `path.join` and the generated corpus reported eight disagreements
 * — every one of them the TEST being wrong, not the function. Settled against the kernel rather than
 * by argument: `echo hello > app/vendored/../probe.ts` creates `node_modules/probe.ts`.
 */
function referenceRealpath(base, input) {
  const absolute = input.startsWith('/') ? input : `${base}/${input}`;
  const command = HAS_GNU_REALPATH ? 'realpath' : 'python3';
  const args = HAS_GNU_REALPATH ? ['-m', absolute] : ['-c', PYTHON_REALPATH, absolute];
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

describe('every row of the measured table resolves where it lands', () => {
  it.each([
    ['a new file under a symlinked directory', 'app/vendored/src/new.ts'],
    ['a symlinked FILE, not just its ancestors', 'app/filelink.ts'],
    ['a .. after a segment that does not exist', 'app/nonexistent/../vendored/src/x.ts'],
    ['a .. that resolves back in', 'app/../app/vendored/src/x.ts'],
    ['a .. THROUGH a symlink, which lexical normalising gets wrong', 'app/vendored/../x.ts'],
    ['an ordinary path with no links at all', 'app/plain/new.ts'],
    ['a leading ./', './app/vendored/src/a'],
    ['repeated slashes', 'app//vendored///src/a'],
    ['a trailing slash', 'app/vendored/'],
  ])('%s', (_label, input) => {
    const { status, value } = resolveFrom(sandbox, input);
    expect(status).toBe(0);
    expect(value).toBe(referenceRealpath(sandbox, input));
  });

  it('an absolute input is resolved without consulting the base', () => {
    const absolute = `${sandbox}/app/vendored/src/a`;
    expect(resolveFrom('/nowhere', absolute).value).toBe(referenceRealpath(sandbox, absolute));
  });
});

describe('it agrees with realpath over a GENERATED corpus, not a chosen one', () => {
  // A hand-written table of shapes is what failed three rounds. This builds every combination of the
  // pieces that mattered — a link or a plain directory, a missing segment, a `..`, a leaf that is a
  // link — so a class nobody thought of is covered by construction rather than by luck.
  const HEADS = ['app', 'app/vendored', 'node_modules/pkg', '.', 'app/nonexistent'];
  const MIDS = ['', 'src', '..', 'missing/..', '../app', './'];
  const LEAVES = ['x.ts', 'filelink.ts', '', 'src'];

  const corpus = [];
  for (const head of HEADS) {
    for (const mid of MIDS) {
      for (const leaf of LEAVES) {
        corpus.push([head, mid, leaf].filter(Boolean).join('/'));
      }
    }
  }

  it(`agrees on all ${corpus.length} generated paths`, () => {
    const disagreements = [];
    for (const input of corpus) {
      const { status, value } = resolveFrom(sandbox, input);
      const expected = referenceRealpath(sandbox, input);
      if (status !== 0 || value !== expected) {
        disagreements.push(
          `${input}: got ${status === 0 ? value : `exit ${status}`}, want ${expected}`,
        );
      }
    }
    expect(disagreements, disagreements.join('\n')).toEqual([]);
  });
});

describe('the domain has a boundary, and outside it the answer is a refusal', () => {
  it('refuses a relative path with no base rather than guessing a directory', () => {
    const result = spawnSync('bash', ['-c', 'source "$1"; canonical_path "$2"', 'sh', LIB, 'a/b'], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  it('refuses a symlink loop rather than truncating it', () => {
    const { status, value } = resolveFrom(sandbox, 'loopa/x');
    expect(status).not.toBe(0);
    expect(value).toBe('');
  });

  it('refuses the loop QUICKLY, because this runs before every write', () => {
    /*
     * The first cut bounded total SEGMENTS at 4096 and nothing else. It terminated, so the case above
     * passed — after 12 SECONDS, on a hook that runs `PreToolUse` on every `Write` and `Edit`. A
     * bound that only protects termination lets a loop become a stall, and correct-but-unusable is
     * not the verdict this guard is supposed to reach.
     *
     * The fix is to bound SYMLINK EXPANSIONS, which is what the kernel does and what the hazard
     * actually is. This case is the one that would have caught the difference; the case above cannot,
     * because both versions refuse.
     */
    const started = process.hrtime.bigint();
    expect(resolveFrom(sandbox, 'loopa/x').status).not.toBe(0);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs, `refusing a symlink loop took ${elapsedMs.toFixed(0)}ms`).toBeLessThan(1000);
  });

  it('does not expand ~, which is a real directory name here', () => {
    // The shell expands `~` before any tool sees it. A literal one reaching this function names a
    // directory genuinely called `~`, and treating it as $HOME would resolve to the wrong place.
    expect(resolveFrom(sandbox, '~/x.ts').value).toBe(`${sandbox}/~/x.ts`);
  });
});

describe('the guard reaches the right verdict, including the fail direction', () => {
  function verdict(filePath, env = {}) {
    const result = spawnSync('bash', [HOOK], {
      input: JSON.stringify({
        tool_name: 'Write',
        cwd: sandbox,
        tool_input: { file_path: filePath },
      }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: sandbox, BULK_EDIT_ACK: '0', ...env },
      timeout: 60_000,
    });
    return result.status ?? -1;
  }

  it.each([
    ['a new file under a symlinked directory', 'app/vendored/src/new.ts', 2],
    ['a symlinked FILE into the store', 'app/filelink.ts', 2],
    ['a .. after a missing segment', 'app/nonexistent/../vendored/src/x.ts', 2],
    // Lexical normalising calls this `app/pkg/x.ts` — clean. It is not: `app/vendored` is a link
    // into the store, so `..` from there is `node_modules` and this lands at `node_modules/pkg/x.ts`.
    // The expectation here was 0 in the first cut of this file, which is the same lexical mistake one
    // level up.
    ['a .. through a symlink, landing back IN the store', 'app/vendored/../pkg/x.ts', 2],
    ['a .. through a symlink, landing OUT of the store', 'app/vendored/../../app/x.ts', 0],
    ['a path that names the store outright', 'node_modules/pkg/src/x.ts', 2],
    ['an ordinary write outside the store', 'app/plain/new.ts', 0],
  ])('%s', (_label, rel, expected) => {
    expect(verdict(`${sandbox}/${rel}`)).toBe(expected);
  });

  it('CDPATH cannot redirect the resolution of a RELATIVE path', () => {
    // `cd` consults CDPATH only for a relative operand, which is why the old climb failed open here
    // and not for an absolute one — narrower than the item that filed it claimed, and the reason the
    // measurement was worth re-taking. There is no `cd` left to consult it.
    expect(verdict('app/vendored/src/new.ts', { CDPATH: tmpdir() })).toBe(2);
  });

  it('refuses when it cannot resolve, rather than treating that as clean', () => {
    expect(verdict(`${sandbox}/loopa/x.ts`)).toBe(2);
  });
});

describe('the cost of the choice is a number, not an assumption', () => {
  /**
   * TC-4. The open question on this item was whether a resolution with a stated domain is affordable
   * in a hook that runs `PreToolUse` on every `Write` and `Edit` — and specifically whether it would
   * have to be a `node` invocation, which this directory does not currently pay for.
   *
   * MEASURED, 30 runs each, on this machine:
   *
   *   an ordinary path      old 18.4ms median   new 18.5ms median
   *   a 40-segment path     old 136.4ms         new 19.3ms
   *   bare `bash -c exit 0`                     0.8ms
   *
   * So the answer is that no `node` is needed and the question does not arise. The pure-shell walk is
   * CHEAPER than what it replaces on a deep path, because the old climb forked `dirname` and
   * `basename` once per level while this one uses parameter expansion. Correctness and cost pointed
   * the same way, which is not the usual case and is why the number is recorded rather than the
   * conclusion.
   *
   * The assertion is deliberately loose. Pinning a millisecond figure on CI hardware is a case that
   * fails for reasons that have nothing to do with this code; what must hold is that resolution does
   * not become superlinear in path depth, which is the property the old climb did not have.
   */
  it('does not get dramatically more expensive as a path gets deeper', () => {
    const timeOf = (segments) => {
      const input = `${'/deep'.repeat(segments)}/f.ts`;
      const started = process.hrtime.bigint();
      for (let i = 0; i < 5; i += 1) resolveFrom(sandbox, `.${input}`);
      return Number(process.hrtime.bigint() - started) / 5e6;
    };

    const shallow = timeOf(2);
    const deep = timeOf(40);
    // 20x the segments. The old implementation was ~7x slower here; this must stay within a factor
    // that a fork-per-segment walk could not.
    expect(deep, `shallow ${shallow.toFixed(1)}ms, deep ${deep.toFixed(1)}ms`).toBeLessThan(
      shallow * 3,
    );
  });
});
