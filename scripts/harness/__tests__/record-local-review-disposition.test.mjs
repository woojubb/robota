import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { recordPathFor } from '../record-local-review.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const RECORDER = path.join(WORKSPACE_ROOT, 'scripts/harness/record-local-review.mjs');

/**
 * Recording a disposition PUBLISHES it to the pull request (PROC-007).
 *
 * `finding-depth.md` gives a foundational finding two dispositions: `re-plan` withdraws the change,
 * `containment` lets it land under a labelled hold. Both are decisions about a PULL REQUEST, and
 * #1557 stored them in `.agents/local-reviews/` — gitignored, per-working-tree, keyed by the local
 * branch and HEAD. The merge is run by the orchestrator's checkout, which holds no such file, so
 * the decision never reached the thing it was about.
 *
 * The local record stays the AUTHORING surface — it is correct for `pre-push-check`, whose subject
 * genuinely is the local checkout. What changes is that the record is not written until the PR
 * carries the disposition: a local file claiming a withdrawal that the PR does not show is the
 * defect, not a partial success.
 */
const scratch = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(branch) {
  const dir = makeTemp('disposition-');
  scratch.push(dir);
  const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  git('init', '--quiet', `--initial-branch=${branch}`);
  git('config', 'user.email', 'harness@example.test');
  git('config', 'user.name', 'Harness');
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'chore: root');
  return dir;
}

function repoWithBacklog(branch, items) {
  const dir = scratchRepo(branch);
  mkdirSync(path.join(dir, '.agents/tasks'), { recursive: true });
  for (const id of items) {
    writeFileSync(
      path.join(dir, '.agents/tasks', `${id}-something.md`),
      '---\nstatus: todo\n---\n',
    );
  }
  return dir;
}

/**
 * A PATH whose `gh` keeps the PR's labels in a file, so the test can read what was PUBLISHED
 * rather than what the recorder said it published.
 *
 * `--add-label` is honoured only when `addFails` is false; the read-back then reports the truth,
 * which is what lets one case assert that a failed publish leaves no record behind. INFRA-057's
 * lesson stated as a stub: the exit code and the state are two different claims.
 */
function stubbedGh({ prNumber = 42, addFails = false, viewFails = false } = {}) {
  const dir = makeTemp('gh-stub-');
  scratch.push(dir);

  const state = path.join(dir, 'state.json');
  writeFileSync(state, JSON.stringify({ prNumber, addFails, viewFails, labels: [], comments: [] }));

  const gh = path.join(dir, 'gh');
  writeFileSync(
    gh,
    [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      `const file = ${JSON.stringify(state)};`,
      'const s = JSON.parse(fs.readFileSync(file, "utf8"));',
      'const argv = process.argv.slice(2);',
      'const args = argv.join(" ");',
      'const save = () => fs.writeFileSync(file, JSON.stringify(s));',
      'if (args.includes("--json number")) {',
      '  if (s.viewFails || s.prNumber === null) process.exit(1);',
      '  console.log(String(s.prNumber));',
      '  process.exit(0);',
      '}',
      'if (args.includes("--json labels")) {',
      '  console.log(JSON.stringify(s.labels));',
      '  process.exit(0);',
      '}',
      'if (argv[0] === "label" && argv[1] === "create") { process.exit(0); }',
      'if (argv[0] === "pr" && argv[1] === "edit") {',
      '  if (s.addFails) { console.error("could not add label"); process.exit(1); }',
      '  const rm = argv.indexOf("--remove-label");',
      '  if (rm !== -1) s.labels = s.labels.filter((l) => l !== argv[rm + 1]);',
      '  const i = argv.indexOf("--add-label");',
      '  if (i !== -1 && !s.labels.includes(argv[i + 1])) s.labels.push(argv[i + 1]);',
      '  save();',
      '  process.exit(0);',
      '}',
      'if (argv[0] === "pr" && argv[1] === "comment") {',
      '  s.comments.push(args);',
      '  save();',
      '  process.exit(0);',
      '}',
      'process.exit(1);',
    ].join('\n'),
  );
  chmodSync(gh, 0o755);

  return {
    path: `${dir}:${process.env.PATH}`,
    read: () => JSON.parse(readFileSync(state, 'utf8')),
  };
}

function recordIn(dir, args, ghPath) {
  const env = { ...process.env };
  if (ghPath !== undefined) env.PATH = ghPath;
  const result = spawnSync('node', [RECORDER, ...args], { cwd: dir, encoding: 'utf8', env });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function storedRecord(dir, branch) {
  const file = recordPathFor(branch, path.join(dir, '.agents/local-reviews'));
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

describe('a disposition is published to the PR as part of recording it', () => {
  it('labels the PR with the withdrawal, and only then writes the local record', () => {
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    const verdict = recordIn(
      dir,
      ['--findings', '1', '--foundational', 'PROC-007', '--disposition', 're-plan'],
      gh.path,
    );

    expect(verdict.status, verdict.output).toBe(0);
    expect(gh.read().labels, 'the PR does not carry the withdrawal').toContain(
      'disposition-re-plan',
    );
    expect(storedRecord(dir, 'feat/withdrawn')?.disposition).toBe('re-plan');
  });

  it('names the root item on the PR, so a reader can see what the withdrawal was for', () => {
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    recordIn(
      dir,
      ['--findings', '1', '--foundational', 'PROC-007', '--disposition', 're-plan'],
      gh.path,
    );

    expect(gh.read().comments.join('\n')).toMatch(/PROC-007/);
  });

  it('labels a containment hold with its own label, not the withdrawal', () => {
    const dir = repoWithBacklog('feat/contained', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    const verdict = recordIn(
      dir,
      ['--findings', '0', '--foundational', 'PROC-007', '--disposition', 'containment'],
      gh.path,
    );

    expect(verdict.status, verdict.output).toBe(0);
    expect(gh.read().labels).toEqual(['disposition-containment']);
  });

  it('writes NO record when the disposition could not be published', () => {
    // Fail closed. A local file asserting a withdrawal the PR does not carry is precisely the state
    // PROC-007 is about — the decision existing in one checkout and nowhere the merge can read it.
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42, addFails: true });

    const verdict = recordIn(
      dir,
      ['--findings', '1', '--foundational', 'PROC-007', '--disposition', 're-plan'],
      gh.path,
    );

    expect(verdict.status, 'an unpublished disposition was reported as recorded').not.toBe(0);
    // The refusal must be about the PUBLISH. Asserting only "it exited non-zero" would pass against
    // a tool that had never heard of `--disposition` at all, which is the accidental green this
    // file's own red run caught.
    expect(verdict.output).toMatch(/disposition-re-plan/);
    expect(storedRecord(dir, 'feat/withdrawn'), 'a local-only disposition was written').toBe(null);
  });

  it('refuses when no PR can be resolved for the branch', () => {
    // There is nothing to publish to, so there is nothing to record. Writing the local record here
    // would recreate #1557 exactly.
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ viewFails: true });

    const verdict = recordIn(
      dir,
      ['--findings', '1', '--foundational', 'PROC-007', '--disposition', 're-plan'],
      gh.path,
    );

    expect(verdict.status).not.toBe(0);
    expect(verdict.output).toMatch(/no pull request/i);
    expect(storedRecord(dir, 'feat/withdrawn')).toBe(null);
  });

  it('replaces the sibling disposition rather than leaving both on the PR', () => {
    // A finding has ONE disposition. Adding `containment` over an earlier `re-plan` and leaving
    // both means every gate — each of which asks about the withdrawal first — keeps refusing the
    // merge while the recorder prints that containment was published. The tool would then be
    // reporting a decision the PR does not carry, in the opposite direction from the defect this
    // change exists to close, and just as wrong.
    const dir = repoWithBacklog('feat/turned-around', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    recordIn(
      dir,
      ['--findings', '1', '--foundational', 'PROC-007', '--disposition', 're-plan'],
      gh.path,
    );
    const verdict = recordIn(
      dir,
      ['--findings', '0', '--foundational', 'PROC-007', '--disposition', 'containment'],
      gh.path,
    );

    expect(verdict.status, verdict.output).toBe(0);
    expect(gh.read().labels).toEqual(['disposition-containment']);
  });

  it('refuses a disposition that names no filed root item', () => {
    // The disposition is the second half of the depth verdict; the first half is the filed root
    // item. Publishing a withdrawal with nothing behind it is how "foundational" becomes a defer.
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    const verdict = recordIn(dir, ['--findings', '1', '--disposition', 're-plan'], gh.path);

    expect(verdict.status).not.toBe(0);
    expect(verdict.output).toMatch(/--foundational/);
    expect(
      verdict.output,
      'refused for not knowing the flag, not for the missing root',
    ).not.toMatch(/unrecognised/);
    expect(gh.read().labels, 'a rootless disposition reached the PR').toEqual([]);
  });

  it('refuses a disposition that is neither of the two the rule allows', () => {
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    const verdict = recordIn(
      dir,
      ['--findings', '0', '--foundational', 'PROC-007', '--disposition', 'defer'],
      gh.path,
    );

    expect(verdict.status).not.toBe(0);
    expect(verdict.output).toMatch(/re-plan/);
    expect(gh.read().labels).toEqual([]);
  });

  it('lists --disposition among the accepted arguments', () => {
    // A flag the help text omits is a flag nobody reaches. The same omission was a SHOULD on #1557.
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);

    const verdict = recordIn(dir, ['--findings', '0', '--nonsense']);

    expect(verdict.status).not.toBe(0);
    expect(verdict.output).toMatch(/--disposition/);
  });
});

describe('a withdrawn change is not a reviewed change', () => {
  it('refuses to report a re-plan record as cleared to push', () => {
    // `pre-push-check` routes on this verdict. A record that says "withdrawn" and also says
    // "reviewed, 0 findings" contradicts itself, and the contradiction resolves in favour of the
    // push — sending the very change the round decided not to land.
    const dir = repoWithBacklog('feat/withdrawn', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    recordIn(
      dir,
      ['--findings', '0', '--foundational', 'PROC-007', '--disposition', 're-plan'],
      gh.path,
    );

    const shown = recordIn(dir, ['--show'], gh.path);

    expect(shown.status, 'a withdrawn change was reported as cleared').not.toBe(0);
    expect(shown.output).toMatch(/withdrew|re-plan/);
  });

  it('still reports a contained change as cleared', () => {
    // Containment is a resolution: the change lands. A gate that blocked it would leave the only
    // permitted disposition unusable and push every foundational finding towards a patch.
    const dir = repoWithBacklog('feat/contained', ['PROC-007']);
    const gh = stubbedGh({ prNumber: 42 });

    recordIn(
      dir,
      ['--findings', '0', '--foundational', 'PROC-007', '--disposition', 'containment'],
      gh.path,
    );

    expect(recordIn(dir, ['--show'], gh.path).status).toBe(0);
  });
});
