import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * HARNESS-069 — a script that could only succeed.
 *
 * `cleanup-drift.mjs` contained neither `process.exit` nor `process.exitCode` — zero matches for
 * either — so whatever it found, a caller heard success. Its intent was never ambiguous: the JSON
 * report it writes carries `passed: driftCount === 0`, so the verdict existed and was simply not
 * published. "Silence is not success" is a rule of this harness, and this was the one script that
 * could not break it.
 *
 * WHERE THE RATCHET IS ENFORCED: THIS FILE is the enforcement — the case below asserting exit 0
 * against the live tree is what makes the ratchet a required check. Which CI paths reach it is
 * recorded once, in `scripts/harness/README.md` under `pnpm harness:cleanup`; two earlier copies of
 * that answer here and in the script were each wrong at some point and were corrected out of step.
 * Named `cleanup-drift.test.mjs` rather than `…-verdict…` for
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
  const dir = makeTemp('cleanup-drift-');
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

  it('(RED) reports BOTH when one type grew and another shrank', () => {
    // The remote review found this: the first version returned after the growth, so a run that grew
    // one type and shrank another printed half of what it knew, and the operator met the re-freeze
    // demand as a surprise on the next run.
    const baseline = temporaryBaseline((frozen) => {
      const [first, second] = Object.keys(frozen);
      frozen[first] = 0; // grew relative to a lowered floor
      frozen[second] = 9999; // fell relative to a raised floor
    });
    const result = run({ baseline });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drift GREW/);
    expect(result.stderr).toMatch(/drift FELL/);
  });

  it('(RED) a clean COUNT does not print a clean summary when the verdict failed', () => {
    // One run must not answer the same question two ways. A tree with nothing to find still fails the
    // ratchet when a frozen count fell without a re-freeze, and the reassuring sentence on stdout is
    // the one a reader skims.
    const root = makeTemp('cleanup-drift-clean-');
    dirs.push(root);
    mkdirSync(path.join(root, 'packages'), { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    mkdirSync(path.join(root, '.agents/skills/spec-writing-standard'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/index.md'),
      '# Skills\n\n- [spec-writing-standard](spec-writing-standard/SKILL.md)\n',
    );
    // RULE-013: a root carrying a SPEC.md needs the section contract, or the scan refuses to judge
    // it rather than reporting every section present.
    copyFileSync(
      path.join(ROOT, '.agents/skills/spec-writing-standard/SKILL.md'),
      path.join(root, '.agents/skills/spec-writing-standard/SKILL.md'),
    );
    const baseline = path.join(root, 'b.json');
    writeFileSync(baseline, JSON.stringify({ 'blind-assertion-any': 3 }));

    const result = spawnSync('node', [path.join(ROOT, 'scripts/harness/cleanup-drift.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CLEANUP_DRIFT_BASELINE: baseline },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/drift FELL/);
    // Against the defect: stdout said "no drift detected." while the run failed.
    expect(result.stdout).toMatch(/verdict FAILED/);
    expect(result.stdout).not.toMatch(/^no drift detected\.$/m);
  });

  it('reports Class Contract Registry as missing — the section the local copy never checked', () => {
    // RULE-013 red-proof. `cleanup-drift.mjs` carried its own 8-entry required list missing
    // `Class Contract Registry`, so no run ever reported a SPEC lacking it. Without this case,
    // re-introducing that array leaves every other test green — which is how the defect survived.
    const root = makeTemp('cleanup-drift-ccr-');
    dirs.push(root);
    mkdirSync(path.join(root, 'packages/widget/docs'), { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFileSync(
      path.join(root, 'packages/widget/package.json'),
      JSON.stringify({ name: '@x/widget', version: '0.0.0' }),
    );
    mkdirSync(path.join(root, '.agents/skills/spec-writing-standard'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/index.md'),
      '# Skills\n\n- [spec-writing-standard](spec-writing-standard/SKILL.md)\n',
    );
    // The section contract is parsed from its owner, so the fixture must carry it.
    copyFileSync(
      path.join(ROOT, '.agents/skills/spec-writing-standard/SKILL.md'),
      path.join(root, '.agents/skills/spec-writing-standard/SKILL.md'),
    );
    // Eight of the nine required sections — everything except Class Contract Registry.
    writeFileSync(
      path.join(root, 'packages/widget/docs/SPEC.md'),
      [
        '## Scope',
        'a',
        '## Boundaries',
        'a',
        '## Architecture Overview',
        'a',
        '## Type Ownership',
        'a',
        '## Public API Surface',
        'a',
        '## Extension Points',
        'a',
        '## Error Taxonomy',
        'a',
        '## Test Strategy',
        'a',
        '',
      ].join('\n'),
    );
    const baseline = path.join(root, 'b.json');
    writeFileSync(baseline, JSON.stringify({ 'spec-missing-sections': 99 }));

    const result = spawnSync('node', [path.join(ROOT, 'scripts/harness/cleanup-drift.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CLEANUP_DRIFT_BASELINE: baseline },
    });

    expect(result.stdout).toMatch(/class contract registry/i);
  });

  it('does not count English prose as a blind `as any` assertion (#1803)', () => {
    // Unanchored, `as any` matched INSIDE ordinary words — `w[as any]thing`, `h[as any] way` — so a
    // docblock explaining the code counted as a type assertion. Both files the unanchored pattern
    // reported against the real tree were comments; the true count was zero. Without this case, the
    // anchor can be dropped and every other test here stays green, because the frozen baseline would
    // simply be re-frozen at whatever prose happens to be in the tree that day.
    const root = makeTemp('cleanup-drift-prose-');
    dirs.push(root);
    mkdirSync(path.join(root, 'packages/widget/src'), { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFileSync(
      path.join(root, 'packages/widget/package.json'),
      JSON.stringify({ name: '@x/widget', version: '0.0.0' }),
    );
    mkdirSync(path.join(root, '.agents/skills/spec-writing-standard'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/index.md'),
      '# Skills\n\n- [spec-writing-standard](spec-writing-standard/SKILL.md)\n',
    );
    copyFileSync(
      path.join(ROOT, '.agents/skills/spec-writing-standard/SKILL.md'),
      path.join(root, '.agents/skills/spec-writing-standard/SKILL.md'),
    );
    // Prose only. Not one type assertion in the file.
    writeFileSync(
      path.join(root, 'packages/widget/src/prose.ts'),
      [
        '// Returns early whether or not there was anything to do.',
        '// Nothing downstream has any way to tell which branch ran.',
        'export const widget = 1;',
        '',
      ].join('\n'),
    );
    const baseline = path.join(root, 'b.json');
    writeFileSync(baseline, JSON.stringify({ 'blind-assertion-any': 0 }));

    const result = spawnSync('node', [path.join(ROOT, 'scripts/harness/cleanup-drift.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CLEANUP_DRIFT_BASELINE: baseline },
    });

    expect(result.stdout).not.toMatch(/blind-assertion-any/);
    expect(result.stderr).not.toMatch(/drift GREW/);
  });

  it('still counts a real blind `as any` assertion (#1803)', () => {
    // The anchor must not be a way to stop measuring. Same fixture shape, one actual assertion.
    const root = makeTemp('cleanup-drift-real-');
    dirs.push(root);
    mkdirSync(path.join(root, 'packages/widget/src'), { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    writeFileSync(
      path.join(root, 'packages/widget/package.json'),
      JSON.stringify({ name: '@x/widget', version: '0.0.0' }),
    );
    mkdirSync(path.join(root, '.agents/skills/spec-writing-standard'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/index.md'),
      '# Skills\n\n- [spec-writing-standard](spec-writing-standard/SKILL.md)\n',
    );
    copyFileSync(
      path.join(ROOT, '.agents/skills/spec-writing-standard/SKILL.md'),
      path.join(root, '.agents/skills/spec-writing-standard/SKILL.md'),
    );
    writeFileSync(
      path.join(root, 'packages/widget/src/blind.ts'),
      'export const widget = (JSON.parse("1") as any).value;\n',
    );
    const baseline = path.join(root, 'b.json');
    writeFileSync(baseline, JSON.stringify({ 'blind-assertion-any': 0 }));

    const result = spawnSync('node', [path.join(ROOT, 'scripts/harness/cleanup-drift.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, CLEANUP_DRIFT_BASELINE: baseline },
    });

    expect(result.stdout).toMatch(/blind-assertion-any/);
    expect(result.stderr).toMatch(/drift GREW/);
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
    const dir = makeTemp('cleanup-drift-grep-');
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
    const dir = makeTemp('cleanup-drift-grep-src-');
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
 * `stale-tmp-doc` counts `.design/tmp/` files older than 14 days BY MTIME, so a fresh CI checkout
 * resets every mtime and can never reach that threshold, while a working copy whose tmp documents
 * have sat past it always will. It is excluded from the comparison — and
 * from the freeze, which is what this case pins: round 3 asked whether a `--write-baseline` run could
 * bake that number in, and the docstring's answer needed to be more than a sentence.
 */
describe('a freeze cannot bake in a clock-derived number (HARNESS-069)', () => {
  it('an aged .design/tmp document is reported but never frozen', () => {
    // A seeded TEMP root, not the live tree. The first version aged a fixture inside the repository's
    // own `.design/tmp` and removed it in a `finally` — the exact pattern this file's header rejects
    // three paragraphs up, since a timeout or a SIGKILL never runs the restore and leaves an aged
    // untracked file in a tracked directory. Review caught the file contradicting itself.
    const root = makeTemp('cleanup-drift-freeze-');
    dirs.push(root);
    // The three things the script's other checks need, so the run reaches the freeze.
    mkdirSync(path.join(root, 'packages'), { recursive: true });
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    mkdirSync(path.join(root, '.agents/skills/spec-writing-standard'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/skills/index.md'),
      '# Skills\n\n- [spec-writing-standard](spec-writing-standard/SKILL.md)\n',
    );
    // RULE-013: a root carrying a SPEC.md needs the section contract, or the scan refuses to judge
    // it rather than reporting every section present.
    copyFileSync(
      path.join(ROOT, '.agents/skills/spec-writing-standard/SKILL.md'),
      path.join(root, '.agents/skills/spec-writing-standard/SKILL.md'),
    );

    // A package with a stub SPEC.md, so the freeze has a NON-clock finding to write. Round 6 found
    // the first version asserting "stale-tmp-doc is absent" against a baseline that was literally
    // `{}` — a claim that cannot tell "the filter dropped it" from "the freeze wrote nothing", so a
    // regression emptying `writeDriftBaseline` would have stayed green. Same vacuity this PR guards
    // against elsewhere, in the case written to close it.
    mkdirSync(path.join(root, 'packages/x/docs'), { recursive: true });
    writeFileSync(path.join(root, 'packages/x/package.json'), '{"name":"x","version":"0.0.0"}\n');
    writeFileSync(path.join(root, 'packages/x/docs/SPEC.md'), '# SPEC\n');

    // Aged past the 14-day threshold. Written and aged rather than mocked: the rule reads mtime.
    mkdirSync(path.join(root, '.design/tmp'), { recursive: true });
    const doc = path.join(root, '.design/tmp/fixture.md');
    writeFileSync(doc, '# fixture\n');
    const longAgo = new Date(Date.parse('2020-01-01T00:00:00Z'));
    utimesSync(doc, longAgo, longAgo);

    const baseline = path.join(root, 'baseline.json');
    const frozenRun = spawnSync(
      'node',
      [path.join(ROOT, 'scripts/harness/cleanup-drift.mjs'), '--write-baseline'],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 180_000,
        env: { ...process.env, CLEANUP_DRIFT_BASELINE: baseline },
      },
    );

    // It is REPORTED — the finding is real and hiding it would be its own defect.
    expect(frozenRun.stdout).toMatch(/stale-tmp-doc/);

    const frozen = Object.keys(JSON.parse(readFileSync(baseline, 'utf8')));
    // The freeze DID write — otherwise the assertion below is true of an empty file.
    expect(frozen).toContain('spec-missing-sections');
    // And the clock-derived type is not in it.
    expect(frozen).not.toContain('stale-tmp-doc');
    // The freeze names the file it wrote, since this path skips the override notice.
    expect(frozenRun.stdout).toMatch(/drift baseline frozen in /);
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
    const dir = makeTemp('cleanup-drift-bare-');
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

describe('a docblock explaining the rule is not a violation of it (#1803)', () => {
  // `blind-assertion-*` counted the literal text, so prose EXPLAINING the rule was reported as
  // breaking it. Measured while ARCH-029 landed: the two conformant, cast-free doubles built to
  // REMOVE those assertions were both flagged for the docblock saying why they exist, and splitting
  // one file into two raised the frozen count by one. It was worked around by rewording the prose,
  // which puts the pressure on documentation instead of code and leaves the next accurate docblock
  // to trip it again.
  //
  // The same defect was fixed once before here: scan-subagent-runner-composition moved from a regex
  // to lib/ts-ast.mjs, and its suite carries "does NOT flag prose that merely names the symbols".

  const source = (body) => body;

  it('does NOT flag prose that merely names the assertion', async () => {
    const { hasBlindAssertion } = await import('../cleanup-drift.mjs');

    const prose = source(
      [
        '/**',
        ' * Exists so a test never needs an `as unknown as IThing` partial.',
        ' */',
        'export const a = 1;',
      ].join('\n'),
    );

    expect(hasBlindAssertion(prose, 'double.ts', 'unknown')).toBe(false);
  });

  it('does NOT flag `as any` inside a comment or a string', async () => {
    const { hasBlindAssertion } = await import('../cleanup-drift.mjs');

    expect(hasBlindAssertion('// never write `as any` here\nconst a = 1;', 'f.ts', 'any')).toBe(
      false,
    );
    expect(hasBlindAssertion('const msg = "as any is banned";', 'f.ts', 'any')).toBe(false);
  });

  it('DOES flag a real assertion, so the narrowing did not disarm the check', async () => {
    const { hasBlindAssertion } = await import('../cleanup-drift.mjs');

    // Red proof for the fix itself: if the AST walk were wrong in the permissive direction, every
    // assertion in the repository would stop being reported and the floor would silently vanish.
    expect(hasBlindAssertion('const a = x as unknown as Foo;', 'f.ts', 'unknown')).toBe(true);
    expect(hasBlindAssertion('const b = y as any;', 'f.ts', 'any')).toBe(true);
  });

  it('reads `as unknown as T` as the outer node, not as a bare `unknown` cast', async () => {
    const { hasBlindAssertion } = await import('../cleanup-drift.mjs');

    // `as unknown as T` parses as AsExpression(AsExpression(expr, unknown), T). A lone `as unknown`
    // is not the banned double assertion and must not be counted as one.
    expect(hasBlindAssertion('const a = x as unknown;', 'f.ts', 'unknown')).toBe(false);
  });

  it('holds on the real doubles the issue named', async () => {
    const { hasBlindAssertion } = await import('../cleanup-drift.mjs');
    const file = path.join(
      WORKSPACE_ROOT,
      'packages/agent-framework/src/testing/agent-job-host-double.ts',
    );
    const text = readFileSync(file, 'utf8');

    // The docblock states the rule accurately — the text check counts that as a violation.
    expect(text).toMatch(/as unknown as/);
    expect(hasBlindAssertion(text, file, 'unknown')).toBe(false);
  });
});
