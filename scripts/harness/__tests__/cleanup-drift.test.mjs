import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * HARNESS-069 — a script that could only succeed.
 *
 * `cleanup-drift.mjs` contained neither `process.exit` nor `process.exitCode` — zero matches for
 * either — so whatever it found, a caller heard success. Its intent was never ambiguous: the JSON
 * report it writes carries `passed: driftCount === 0`, so the verdict existed and was simply not
 * published. "Silence is not success" is a rule of this harness, and this was the one script that
 * could not break it.
 *
 * WHERE THE RATCHET IS ENFORCED. Not in `run-all-scans.mjs` — but THIS FILE is the enforcement, and
 * the first version of it claimed the opposite in a comment. `pnpm harness:test` runs the whole
 * `scripts/harness/__tests__` suite, and CI reaches that on both sides: the `scans` job
 * (`base_ref != 'main'`) runs it as a step, and a promotion to `main` runs it inside
 * `harness:verify:release`. So the case below asserting exit 0 against the live tree makes the
 * ratchet a required check on every PR. Named `cleanup-drift.test.mjs` rather than `…-verdict…` for
 * the same reason: the harness's own untested-script ratchet matches a test to its subject by the
 * `<base>.` prefix, so the old name left `cleanup-drift.mjs` frozen as untested even after it had a
 * test.
 *
 * The fixture cases point the script at a TEMP baseline via `CLEANUP_DRIFT_BASELINE` rather than
 * editing the tracked one and restoring it afterwards — a restore that a timeout or a SIGKILL never
 * runs, leaving the repository's frozen counts corrupted by a test.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const BASELINE = path.join(ROOT, 'scripts/harness/cleanup-drift-baseline.json');
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the frozen baseline, mutated, written somewhere the repository does not care about. */
function temporaryBaseline(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), 'cleanup-drift-'));
  dirs.push(dir);
  const frozen = JSON.parse(readFileSync(BASELINE, 'utf8'));
  mutate(frozen);
  const file = path.join(dir, 'baseline.json');
  writeFileSync(file, `${JSON.stringify(frozen, null, 2)}\n`);
  return file;
}

function run({ baseline, pathPrefix } = {}) {
  return spawnSync('node', ['scripts/harness/cleanup-drift.mjs'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: {
      ...process.env,
      ...(baseline === undefined ? {} : { CLEANUP_DRIFT_BASELINE: baseline }),
      ...(pathPrefix === undefined ? {} : { PATH: `${pathPrefix}:${process.env['PATH']}` }),
    },
  });
}

describe('cleanup-drift publishes its verdict (HARNESS-069)', () => {
  it('exits 0 when drift matches the frozen counts', () => {
    // Against the live tree and the tracked baseline — which is what makes this file the gate.
    expect(run().status).toBe(0);
  });

  it('(RED) exits NON-ZERO when drift grew', () => {
    // Against the defect this exits 0 with the findings printed — the whole point of the item.
    const baseline = temporaryBaseline((frozen) => {
      const [firstType] = Object.keys(frozen);
      frozen[firstType] = 0;
    });
    const result = run({ baseline });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drift GREW/);
    // And the run says out loud that it was not judged against the tracked baseline. A silent
    // override would let a verdict about a temp file read exactly like a verdict about the repo.
    expect(result.stderr).toMatch(/baseline OVERRIDDEN via CLEANUP_DRIFT_BASELINE=/);
  });

  it('(RED) exits NON-ZERO when drift fell without a re-freeze', () => {
    // A ratchet that only catches growth lets a gain evaporate silently.
    const baseline = temporaryBaseline((frozen) => {
      const [firstType] = Object.keys(frozen);
      frozen[firstType] = 9999;
    });
    const result = run({ baseline });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drift FELL/);
  });

  it('the frozen baseline is the one the script actually measures', () => {
    // A number nobody can reproduce is not a baseline. The pass above already proves agreement;
    // this pins that the file is non-empty, so an emptied one cannot masquerade as a clean tree.
    const frozen = JSON.parse(readFileSync(BASELINE, 'utf8'));
    expect(Object.keys(frozen).length).toBeGreaterThan(0);
  });
});

/**
 * A FAILED measurement must not be published as progress.
 *
 * Review found every grep call site reading `status !== 0` as "no matches". grep has three outcomes:
 * 0 matched, 1 did not match, **2+ grep itself failed**. Conflating the third with the second turned
 * an unreadable tree or a broken binary into a clean bill of health — and worse, into `drift FELL`,
 * whose printed instruction is to re-freeze, which would have baked zeros into the baseline and
 * permanently disabled three of its four rows.
 */
describe('a measurement that failed is an error, not a clean result (HARNESS-069)', () => {
  /** A `grep` earlier on PATH that fails the way a real one does when it cannot read a tree. */
  function brokenGrepDir(exitCode) {
    const dir = mkdtempSync(path.join(tmpdir(), 'cleanup-drift-grep-'));
    dirs.push(dir);
    const stub = path.join(dir, 'grep');
    writeFileSync(
      stub,
      `#!/bin/sh\necho "grep: packages/: Permission denied" >&2\nexit ${exitCode}\n`,
    );
    chmodSync(stub, 0o755);
    return dir;
  }

  it('(RED) grep exiting 2 fails the run instead of reporting less drift', () => {
    const result = run({ pathPrefix: brokenGrepDir(2) });
    // Against the defect: exit 0, 32 findings instead of 71, and `drift FELL` telling the operator to
    // freeze the loss.
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/grep` exited 2/);
    expect(result.stderr).not.toMatch(/drift FELL/);
  });

  it('(RED) EVERY call site is covered — including the forbidden-terms one', () => {
    // Review round 2 found the fourth grep site still reading `status === 0` after the other three
    // were converted, and reproduced the original defect on the fixed tree: with a grep that fails
    // only for `<package>/src`, every forbidden-term measurement failed, nothing was printed, and the
    // script exited 0. A stub that breaks ALL greps could not have caught it — the first thrown error
    // would have come from one of the converted sites.
    const dir = mkdtempSync(path.join(tmpdir(), 'cleanup-drift-grep-src-'));
    dirs.push(dir);
    const realGrep = spawnSync('sh', ['-c', 'command -v grep'], { encoding: 'utf8' }).stdout.trim();
    const stub = path.join(dir, 'grep');
    writeFileSync(
      stub,
      `#!/bin/sh\nfor a in "$@"; do case "$a" in */src) echo "grep: $a: Permission denied" >&2; exit 2;; esac; done\nexec ${realGrep} "$@"\n`,
    );
    chmodSync(stub, 0o755);

    const result = run({ pathPrefix: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/grep` exited 2 while measuring forbidden agent terms/);
  });

  it('grep exiting 1 still means "no matches", not an error', () => {
    // The other direction. A rule that treated 1 as a failure would fail every clean repository.
    const dir = brokenGrepDir(1);
    const result = run({ pathPrefix: dir });
    // No drift can be counted under packages/, so this is the FELL branch — a verdict, reached
    // deliberately, rather than the hard measurement error above.
    expect(result.stderr).toMatch(/drift FELL/);
    expect(result.stderr).not.toMatch(/grep` exited/);
  });
});

/**
 * A baseline may hold only numbers another checkout can reproduce.
 *
 * `stale-tmp-doc` counts `.design/tmp/` files older than 14 days BY MTIME, so a fresh CI checkout can
 * never fire it while a tree that sat over a weekend can. It is excluded from the comparison — and
 * from the freeze, which is what this case pins: round 3 asked whether a `--write-baseline` run could
 * bake that number in, and the docstring's answer needed to be more than a sentence.
 */
describe('a freeze cannot bake in a clock-derived number (HARNESS-069)', () => {
  it('an aged .design/tmp document is reported but never frozen', () => {
    const baseline = path.join(mkdtempSync(path.join(tmpdir(), 'cleanup-drift-freeze-')), 'b.json');
    dirs.push(path.dirname(baseline));

    // Aged past the 14-day threshold, in the live tree's own `.design/tmp` — the only place the
    // check looks — then removed. Written and aged rather than mocked: the rule reads mtime.
    const tmpDocDir = path.join(ROOT, '.design/tmp');
    const dirExisted = existsSync(tmpDocDir);
    mkdirSync(tmpDocDir, { recursive: true });
    const doc = path.join(tmpDocDir, 'harness-069-freeze-fixture.md');
    writeFileSync(doc, '# fixture\n');
    const longAgo = new Date(Date.parse('2020-01-01T00:00:00Z'));
    utimesSync(doc, longAgo, longAgo);

    try {
      const frozenRun = spawnSync(
        'node',
        ['scripts/harness/cleanup-drift.mjs', '--write-baseline'],
        {
          cwd: ROOT,
          encoding: 'utf8',
          timeout: 180_000,
          env: { ...process.env, CLEANUP_DRIFT_BASELINE: baseline },
        },
      );
      // It is REPORTED — the finding is real and hiding it would be its own defect.
      expect(frozenRun.stdout).toMatch(/stale-tmp-doc/);
      // And it is not frozen.
      expect(Object.keys(JSON.parse(readFileSync(baseline, 'utf8')))).not.toContain(
        'stale-tmp-doc',
      );
      // The freeze names the file it wrote, since this path skips the override notice.
      expect(frozenRun.stdout).toMatch(/drift baseline frozen in /);
    } finally {
      // The tree is left exactly as it was found, directory included: a test that judges a scan of
      // the working tree must not become part of what the next one measures.
      rmSync(doc, { force: true });
      if (!dirExisted) rmSync(tmpDocDir, { recursive: true, force: true });
    }
  });
});

/**
 * The tree this script judges must be there.
 *
 * Three of the four ratchet rows are counted by grepping `packages/`. Over a root without it every
 * pattern matches nothing and the verdict reads "drift FELL" — a scan reporting on ground it never
 * examined, which this harness treats as an error and never as a pass.
 */
describe('fail-closed over a root it cannot judge (HARNESS-069)', () => {
  it('(RED) refuses to report when packages/ is absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cleanup-drift-bare-'));
    dirs.push(dir);
    // Seeded with the two things the script's OTHER checks need, so the root is bare in exactly the
    // way this case is about. Without them the unfixed script died on a missing
    // `pnpm-workspace.yaml` and the case would have been a weak red — passing because something
    // crashed, not because the defect fired.
    writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    mkdirSync(path.join(dir, '.agents/skills'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/skills/index.md'), '# Skills\n');

    const result = spawnSync('node', [path.join(ROOT, 'scripts/harness/cleanup-drift.mjs')], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    // Against the defect: exit 0, "no drift detected" — a clean bill of health for a tree with no
    // code in it at all.
    expect(result.status).not.toBe(0);
    // The SHARED `requireGovernedTree` message (HARNESS-052), not a private copy of the rule — a
    // same-named local twin would have broken the property that helper exists for.
    expect(result.stderr).toMatch(/cleanup-drift: packages missing from/);
  });
});
