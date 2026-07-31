#!/usr/bin/env node
/**
 * Record that the local diff was reviewed at a specific commit.
 *
 * ## Why this exists
 *
 * `pr-review-orchestration` used to wait for required checks to go green before its FIRST review
 * round — so the reviewer only ever saw a diff that had already been pushed, opened as a PR, and
 * run through CI. Every finding therefore cost a push → CI round trip before anyone could even
 * look at it.
 *
 * Measured across one session (2026-07-28), PRs #1514/#1518/#1519/#1520/#1521: 38 review rounds,
 * 24 of them carrying a blocking finding, at roughly 6–10 minutes of CI per round. Not one of those
 * findings needed CI to be visible — every one was read out of the diff. Several were regressions
 * introduced by the previous round's fix, which a review of the next diff would have caught just as
 * cheaply.
 *
 * The reviewer agent already accepts a local diff (`git diff origin/<base>...HEAD`). Only the
 * orchestration's precondition forced the round trip. This file is the mechanical half of moving
 * that round before the push: `pre-push-check` refuses to push a feature branch whose HEAD has not
 * been reviewed, and this is how a review is recorded.
 *
 * ## What it does NOT claim
 *
 * A record says a review RAN at this commit and reported zero gating findings. It cannot say the
 * review was good — that is the reviewer's job, and a hook pretending to judge it would be a guard
 * measuring the wrong thing. Its value is that the round happens before the push rather than after,
 * which is where the eight minutes are.
 *
 * ## The depth half
 *
 * `finding-depth.md` requires every review finding to be classified by DEPTH before it
 * is fixed, and a foundational one to be FILED rather than patched in place. That rule is worth what
 * it causes, so the record carries the root items the round produced and refuses an ID that names
 * none — `pre-push-check` already forces a record on every push, which makes this the one place the
 * requirement is reached by the real invocation rather than when remembered.
 *
 * ## The disposition half, and why it does not stay here
 *
 * A foundational finding takes one of two dispositions: `re-plan` WITHDRAWS the change, `containment`
 * lets it land under a labelled hold. Both are decisions about a PULL REQUEST, and this file's store
 * is the wrong home for one — `.agents/local-reviews/` is gitignored and per-working-tree, keyed by
 * the local branch and HEAD, while a merge is keyed by a PR number. `worktree-parallel-orchestration`
 * §5 has the orchestrator merge and never the implementer, so the checkout that recorded the round is
 * by construction not the one that merges. Measured on #1557: the merging clone read a DIFFERENT
 * branch's record and answered one PR's merge with another PR's disposition (PROC-007).
 *
 * So this file stays the AUTHORING surface and publishing is part of recording: `--disposition`
 * labels the PR first and writes the local record only if that succeeded. A local file asserting a
 * withdrawal the PR does not carry is not a partial success — it is the defect.
 *
 * Usage:
 *   node scripts/harness/record-local-review.mjs --findings 0 [--notes "..."] [--foundational <ID>[,<ID>...]]
 *   node scripts/harness/record-local-review.mjs --findings 1 --foundational <ID> --disposition re-plan
 *   node scripts/harness/record-local-review.mjs --show
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { idOf } from './check-backlog-placement.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function git(args, cwd) {
  // stderr captured rather than inherited: git's own "not a git repository" would otherwise be the
  // message a caller sees, ahead of the one that explains what this tool needs.
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * The repository this invocation is about — resolved from the CALLER's directory, not from where
 * this file lives. `pre-push-check` runs in whatever checkout the push targets, which may be a
 * worktree; keying off the script's own location would record and read the main clone's state while
 * judging another one.
 */
function repoRoot(cwd = process.cwd()) {
  // No fallback. Returning SCRIPT_ROOT here would do precisely what the paragraph above says must
  // not happen: read and write one checkout's records while judging another. A guard that cannot
  // tell which repository it is in must say so, not guess — and the bash side of this gate already
  // refuses rather than assuming the main clone.
  try {
    return git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    console.error(`record-local-review: ${cwd} is not inside a git work tree.`);
    console.error('A review record belongs to a specific checkout; this one cannot be identified.');
    process.exit(1);
  }
}

function gh(args, cwd) {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * The two dispositions `finding-depth.md` permits, and the PR label that carries each.
 *
 * The label IS the machine-readable home of the decision — atomic, keyed to the PR, readable from
 * any checkout by number. The same two strings are spelled in `.claude/hooks/merge-gate.sh` and
 * `.github/workflows/review-gate.yml`, which are bash and YAML and cannot import this object;
 * `merge-gate-disposition.test.mjs` asserts the three agree so the duplication cannot drift.
 */
export const DISPOSITION_LABELS = {
  're-plan': 'disposition-re-plan',
  containment: 'disposition-containment',
};

const DISPOSITION_LABEL_META = {
  're-plan': {
    color: 'B60205',
    description:
      'finding-depth: a foundational finding WITHDREW this change. Do not merge; work the root item.',
  },
  containment: {
    color: 'FBCA04',
    description:
      'finding-depth: this change lands under a labelled containment hold naming a filed root item.',
  },
};

/**
 * The PR this branch is about, or `null` when there is not one.
 *
 * `null` is not "no opinion" to any caller here — it is a refusal. A disposition with no pull
 * request to publish to has nowhere to live except this checkout, which is the state PROC-007 exists
 * to end, so the recorder stops rather than writing a local-only decision.
 */
function resolvePullRequest(root) {
  try {
    const number = Number(gh(['pr', 'view', '--json', 'number', '--jq', '.number'], root));
    return Number.isInteger(number) && number > 0 ? number : null;
  } catch {
    // `gh` missing, unauthenticated, or no PR for this branch. They differ in cause and not in
    // consequence: nothing can be published, so nothing may be recorded.
    return null;
  }
}

/**
 * Put the disposition ON THE PULL REQUEST, and verify it arrived. Throws if it did not.
 *
 * The read-back is INFRA-057's lesson applied: that gate reported a successful disarm from an exit
 * code while auto-merge was still armed, for two months. What must be true here is that the label is
 * on the PR afterwards — so that is what is read, rather than inferred from `gh pr edit` exiting 0.
 */
function publishDisposition({ root, pr, disposition, foundational, branch, headSha }) {
  const label = DISPOSITION_LABELS[disposition];

  // BOTH labels, not only the one being applied: `--remove-label` below names the sibling, and gh
  // resolves a label name against the repository before editing — a sibling that has never been
  // created would fail the whole edit on a clone that has not used the other disposition yet.
  for (const [name, meta] of Object.entries(DISPOSITION_LABEL_META)) {
    try {
      gh(
        [
          'label',
          'create',
          DISPOSITION_LABELS[name],
          '--color',
          meta.color,
          '--description',
          meta.description,
        ],
        root,
      );
    } catch {
      // Nothing is concluded from this. `gh label create` reports an existing label as a failure,
      // and whether the label already existed is not the question — the read-back below is.
      // Creating them here rather than requiring a repository-settings change keeps the first use
      // of this gate from needing an admin.
    }
  }

  // A finding has ONE disposition, so the sibling comes off in the same edit. Leaving both on would
  // publish a contradiction: every gate asks about the withdrawal first, so a PR turned around from
  // `re-plan` to `containment` would stay refused while this tool printed that containment was
  // published — the same "the PR does not carry what was recorded" defect, pointing the other way.
  const sibling = Object.values(DISPOSITION_LABELS).find((name) => name !== label);
  try {
    gh(['pr', 'edit', String(pr), '--add-label', label, '--remove-label', sibling], root);
  } catch (err) {
    throw new Error(`could not apply '${label}' to PR #${pr}: ${String(err.message).trim()}`);
  }

  let applied;
  try {
    applied = JSON.parse(
      gh(['pr', 'view', String(pr), '--json', 'labels', '--jq', '[.labels[].name]'], root),
    );
  } catch (err) {
    throw new Error(`could not read back the labels on PR #${pr}: ${String(err.message).trim()}`);
  }
  if (!Array.isArray(applied) || !applied.includes(label)) {
    throw new Error(`'${label}' is not on PR #${pr} after applying it, so it was not published`);
  }
  if (applied.includes(sibling)) {
    throw new Error(
      `PR #${pr} still carries '${sibling}' beside '${label}', so the disposition it publishes is ambiguous`,
    );
  }

  // The comment is for the reader, not for the gate — the gate reads the label. A label alone tells
  // whoever meets this PR later that a decision was taken and nothing about what it was for.
  const body = [
    `**Finding depth — disposition: \`${disposition}\`**`,
    '',
    disposition === 're-plan'
      ? 'A foundational finding was judged on this PR. Per `.agents/rules/finding-depth.md` a ' +
        're-plan disposition WITHDRAWS this change rather than patching it, so it is not to be ' +
        'merged: close it and work the root item.'
      : 'A foundational finding was judged on this PR. It lands under a labelled containment hold ' +
        'naming the root item below; the root item is what resolves it.',
    '',
    `Root item(s): ${foundational.join(', ')}`,
    `Recorded from \`${branch}\` at \`${headSha.slice(0, 9)}\`.`,
  ].join('\n');
  try {
    gh(['pr', 'comment', String(pr), '--body', body], root);
  } catch (err) {
    throw new Error(
      `could not comment the disposition on PR #${pr}: ${String(err.message).trim()}`,
    );
  }
}

/**
 * The default record directory — THIS checkout's. Exported for the helpers' default argument; any
 * caller judging another checkout must pass its directory explicitly, which is what `main()` does.
 */
export const RECORD_DIR = path.join(SCRIPT_ROOT, '.agents/local-reviews');

function recordDirFor(root) {
  return path.join(root, '.agents/local-reviews');
}

/**
 * The record path for a branch — a one-to-one encoding, not a lossy one.
 *
 * Slashes used to become `__`, which maps `feat/foo` and `feat__foo` onto the same file: one
 * branch's review would then satisfy the gate for the other, unreviewed one. Percent-encoding the
 * separator (and the escape character itself) cannot collide.
 */
export function recordPathFor(branch, dir = RECORD_DIR) {
  const encoded = branch.replace(/%/g, '%25').replace(/\//g, '%2F');
  return path.join(dir, `${encoded}.json`);
}

/**
 * The verdict, with the reason — the single place the question is answered.
 *
 * `--show` used to re-implement these same checks beside `isReviewed()`, which is the duplicated
 * drift this change spent two rounds removing from the bash side. Two implementations agree until
 * one of them changes, and the JS pair was no different from the bash pair.
 *
 * Keyed on the HEAD sha, deliberately: amending or adding a commit changes what would be pushed, so
 * the previous round's review no longer describes it. That is the property the whole change is
 * about — a review must have seen what is being sent.
 */
export function reviewState(branch, headSha, dir = RECORD_DIR) {
  const file = recordPathFor(branch, dir);
  if (!existsSync(file)) {
    return {
      ok: false,
      reason: `no local review recorded for ${branch} at ${headSha.slice(0, 9)}`,
    };
  }
  let stored;
  try {
    stored = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // An unreadable record is not a review. Refuses rather than passes.
    return {
      ok: false,
      reason: `the review record for ${branch} is unreadable, so it is not a review`,
    };
  }
  if (stored.branch !== branch) {
    // Belt and braces beside the encoding above: a record naming a different branch is not this
    // branch's review, however it came to sit at this path.
    return { ok: false, reason: `the record at this path is for ${stored.branch ?? 'no branch'}` };
  }
  if (stored.headSha !== headSha) {
    const seen = String(stored.headSha ?? '?').slice(0, 9);
    return { ok: false, reason: `last reviewed ${seen} — the diff has changed since` };
  }
  if (stored.disposition === 're-plan') {
    // A record cannot say both "this change was withdrawn" and "this change is cleared to go". The
    // caller routing on this verdict is `pre-push-check`, so resolving the contradiction the other
    // way would push the very change the round decided not to land.
    return {
      ok: false,
      reason: 'the round withdrew this change (disposition: re-plan) — it is not cleared to push',
    };
  }
  if (stored.findings !== 0) {
    const n = stored.findings ?? 'an unreadable number of';
    return { ok: false, reason: `the recorded review reports ${n} finding(s) still open` };
  }
  return { ok: true, reason: `reviewed at ${headSha.slice(0, 9)} — 0 findings` };
}

/** Convenience predicate over {@link reviewState}. */
export function isReviewed(branch, headSha, dir = RECORD_DIR) {
  return reviewState(branch, headSha, dir).ok;
}

/**
 * Which of `ids` name a real backlog item, and which name nothing.
 *
 * A FOUNDATIONAL verdict (`finding-depth.md`) is worth only what it causes: the root gets filed
 * instead of patched over. An ID that resolves to no item is worse than silence, because the record
 * then asserts a root item exists — so the recorder refuses rather than storing the promise.
 */
export function resolveRootItems(ids, backlogDir) {
  const present = new Set();
  for (const dir of [backlogDir, path.join(backlogDir, 'completed')]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      // One owner for what a backlog ID looks like. Writing the pattern again here got the phase
      // suffix wrong — `SELFHOST-008-P5-…` captured as `SELFHOST-008`, so the real ID was refused
      // and a truncated one that names no file was accepted. Three items are filed that way.
      const id = idOf(name);
      if (id !== null) present.add(id);
    }
  }
  return {
    resolved: ids.filter((id) => present.has(id)),
    missing: ids.filter((id) => !present.has(id)),
  };
}

export function parseArgs(argv) {
  const args = {
    findings: null,
    notes: '',
    show: false,
    foundational: [],
    disposition: null,
    unknown: [],
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--show') args.show = true;
    else if (argv[i] === '--findings') args.findings = Number(argv[++i]);
    else if (argv[i] === '--notes') args.notes = String(argv[++i] ?? '');
    else if (argv[i] === '--disposition') args.disposition = String(argv[++i] ?? '');
    else if (argv[i] === '--foundational') {
      args.foundational = String(argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
    // Anything else is reported, not skipped. Skipping is how `--note` (singular) was accepted by
    // silence for as long as this tool existed: every note passed that way was dropped, and the
    // caller had no way to find out. A flag the tool ignores is a flag the caller believes in.
    else args.unknown.push(argv[i]);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.unknown.length > 0) {
    console.error(`record-local-review: unrecognised argument(s): ${args.unknown.join(' ')}`);
    console.error(
      'Accepted: --findings <n> | --notes "…" | --foundational <ID>[,<ID>…] | ' +
        '--disposition re-plan|containment | --show',
    );
    process.exit(1);
  }
  const root = repoRoot();
  const branch = git(['branch', '--show-current'], root);
  const headSha = git(['rev-parse', 'HEAD'], root);

  // A record is keyed by branch, so a detached HEAD has no key: every detached invocation would
  // share `.agents/local-reviews/.json` and satisfy the gate for every other. `pre-push-check` had
  // this guard and this file did not, which is exactly the split this file's docstring says it
  // exists to prevent — the owner of the verdict must own the whole of it.
  if (!branch) {
    console.error(
      'record-local-review: HEAD is detached, so a review cannot be keyed to a branch.',
    );
    console.error('Check out the branch this commit belongs to and run it again.');
    process.exit(1);
  }

  if (args.show) {
    // The single owner of "is this commit reviewed". `pre-push-check` calls this and routes on the
    // exit code rather than re-parsing the record in bash — the duplicated-logic drift this whole
    // change is about, which the first version of that hook reproduced.
    const verdict = reviewState(branch, headSha, recordDirFor(root));
    console.log(verdict.reason);
    process.exit(verdict.ok ? 0 : 1);
  }

  // The disposition is validated BEFORE anything is published or written. A value the rule does not
  // define, or one with no root item behind it, must not reach the pull request — a label is read by
  // a merge gate, and one nobody can act on is worse than none.
  if (args.disposition !== null) {
    if (!Object.hasOwn(DISPOSITION_LABELS, args.disposition)) {
      console.error(
        `record-local-review: '${args.disposition}' is not a disposition. finding-depth.md ` +
          'defines two: re-plan | containment.',
      );
      console.error('A third option is how "foundational" becomes a way to defer work.');
      process.exit(1);
    }
    if (args.foundational.length === 0) {
      console.error(
        'record-local-review: --disposition requires --foundational <ID> — the root item it is for.',
      );
      console.error(
        'A disposition with no filed root item behind it asserts a decision nobody can act on.',
      );
      process.exit(1);
    }
  }

  if (!Number.isInteger(args.findings) || args.findings < 0) {
    console.error(
      'record-local-review: --findings <n> is required (n = unresolved MUST + SHOULD).',
    );
    console.error('This is the reviewer’s own count. Record it; do not estimate it.');
    process.exit(1);
  }

  // `re-plan` is the one case where open findings are the point rather than the problem: the round
  // decided the change is withdrawn, so there is no zero to reach and the record exists to say so.
  // Every other round still has to get there before it is recorded.
  if (args.findings > 0 && args.disposition !== 're-plan') {
    // Recording an unresolved review would make the gate a formality. The point of the round is to
    // reach zero BEFORE the push, not to log that it was not reached.
    console.error(
      `record-local-review: ${args.findings} finding(s) still open — nothing to record yet.`,
    );
    console.error('Resolve them, review again, then record. The round is what saves the CI trip.');
    process.exit(1);
  }

  // A FOUNDATIONAL verdict is worth what it causes, and what it must cause is a filed root item
  // (`finding-depth.md`). An ID naming nothing asserts one exists, so it is refused here rather
  // than stored — this is the floor that keeps the depth verdict from becoming a way to defer.
  if (args.foundational.length > 0) {
    // The sibling that owns `idOf` uses this for the same reason (HARNESS-052): a governed tree that
    // is absent must not read as "no results". Without it, the message here would be the most
    // misleading one this tool can emit — "no backlog item for X" — when the truth is that nothing
    // was examined at all.
    try {
      requireGovernedTree(root, ['.agents/backlog'], {
        scan: 'record-local-review',
        why: 'A foundational finding is verified against the filed items.',
      });
    } catch (err) {
      console.error(`record-local-review: ${err.message}`);
      process.exit(1);
    }
  }

  const { missing } = resolveRootItems(args.foundational, path.join(root, '.agents/backlog'));
  if (missing.length > 0) {
    console.error(
      `record-local-review: no backlog item for ${missing.join(', ')} — file the root item first.`,
    );
    console.error(
      'A foundational finding whose root item does not exist is the same as not having filed it.',
    );
    process.exit(1);
  }

  // PROC-007: publishing comes BEFORE the write, and a failure to publish is a failure to record.
  // The order is the whole point — a local record asserting a disposition the PR does not carry is
  // the exact state that let a withdrawn change merge from another checkout.
  let pullRequest = null;
  if (args.disposition !== null) {
    pullRequest = resolvePullRequest(root);
    if (pullRequest === null) {
      console.error(
        `record-local-review: no pull request resolves for ${branch}, so the disposition has ` +
          'nowhere to live but this checkout.',
      );
      console.error(
        'That is PROC-007 exactly. Open the PR (or fix gh auth) and record it again — a merge run ' +
          'from another checkout cannot read this directory.',
      );
      process.exit(1);
    }
    try {
      publishDisposition({
        root,
        pr: pullRequest,
        disposition: args.disposition,
        foundational: args.foundational,
        branch,
        headSha,
      });
    } catch (err) {
      console.error(`record-local-review: ${err.message}`);
      console.error(
        'Nothing was recorded. A disposition the pull request does not carry is not a disposition.',
      );
      process.exit(1);
    }
  }

  mkdirSync(recordDirFor(root), { recursive: true });
  const record = {
    branch,
    headSha,
    findings: args.findings,
    foundational: args.foundational,
    disposition: args.disposition,
    pullRequest,
    notes: args.notes,
    reviewedAt: new Date().toISOString(),
  };
  writeFileSync(recordPathFor(branch, recordDirFor(root)), `${JSON.stringify(record, null, 2)}\n`);
  const suffix =
    args.disposition === null
      ? ''
      : ` — disposition '${args.disposition}' published to PR #${pullRequest} as ` +
        `'${DISPOSITION_LABELS[args.disposition]}'`;
  console.log(
    `recorded: ${branch} @ ${headSha.slice(0, 9)} — ${args.findings} finding(s)${suffix}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
