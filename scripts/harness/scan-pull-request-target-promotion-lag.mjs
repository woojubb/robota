#!/usr/bin/env node

/**
 * A `pull_request_target` workflow runs the DEFAULT branch's copy of itself (issue #2039).
 *
 * Measured on three runs the day this landed. `workflow-provenance-gate.yml` executed `main`'s
 * version of its own YAML on pull requests whose base was `develop`: the checkout step received no
 * `ref:` input and resolved to `main`, and the gate's advisory printed the count `main`'s registry
 * produces rather than `develop`'s.
 *
 * THE CONSEQUENCE, which is the whole reason this file exists: **a fix to such a workflow is inert
 * until it is promoted.** Two landed on `develop` that day — adding `edited` to the trigger, and
 * pinning the checkout to the pull request's base — and neither was active. Both were verified
 * locally, both landed green, and both did nothing.
 *
 * The security property is unaffected and arguably stronger: `main` is further from a pull request's
 * reach than `develop` is. What does not hold is the assumption that fixing the gate fixes the gate.
 *
 * ## Why it compares whole files rather than the fields that matter
 *
 * The first cut failed only when the delta touched `types:` or the checkout `ref:` — the two fields
 * today's fixes happened to change. That is a contingent fact hardened into a rule, and the next
 * inert fix would be a `permissions:` narrowing, a `concurrency` group, or the `run:` line the gate
 * actually executes; the check would print a delta, pass, and read as though it had judged.
 *
 * So the comparison is mechanical: the file's content with comments and blank lines stripped. Any
 * semantic difference means THE GATE THAT RUNS IS NOT THE GATE THAT WAS REVIEWED, which is the true
 * property. No key list to maintain and no judgement about which lines matter.
 *
 * ## Why it reports rather than refuses
 *
 * A delta is the NORMAL state between promotions. A check red for most of a release cycle is one
 * that gets switched off, and this repository has measured that failure mode more than once. So the
 * standing state goes in the `::examined::` line, where it is visible without blocking.
 *
 * The moment that CAN be acted on is different: someone editing such a workflow and believing the
 * edit takes effect. `scan-workflow-provenance` already speaks at exactly that moment, so the
 * warning lives there rather than as a second red gate here.
 *
 * ## The subject was live when this was written and is EMPTY as it lands
 *
 * Measured while authoring: one `pull_request_target` workflow existed and it differed from `main`
 * on two counts — `types:` (`edited` present on `develop`, absent on `main`) and the checkout `ref:`.
 * Two fixes deep, exactly the state the issue describes.
 *
 * Then the promotion carried both, and the delta is now ZERO. So this scan lands with nothing to
 * report, and says so rather than letting a green line be read as a measurement. The evidence that
 * it ever had a subject is the paragraph above; the evidence that it can still find one is its
 * tests, which construct a delta rather than relying on the tree having one.
 *
 * That distinction is the reason this paragraph exists. A guard whose population empties and does
 * not announce it is indistinguishable from a guard that works, and this repository has measured
 * that shape more than once.
 *
 * Usage:
 *   node scripts/harness/scan-pull-request-target-promotion-lag.mjs
 *   node scripts/harness/scan-pull-request-target-promotion-lag.mjs --promotion-ref origin/main
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const WORKFLOWS_PREFIX = '.github/workflows/';

/** Where a promoted workflow runs FROM — the repository's default branch. */
export const DEFAULT_PROMOTION_REF = 'origin/main';

function git(args, root = WORKSPACE_ROOT) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

/**
 * Read one path at one ref, or null when the path does not exist there.
 *
 * A MISSING PATH and an UNREADABLE REF are different answers and this returns only the first as
 * null — the caller refuses on the second. That distinction is the subject of half this repository's
 * findings, and building it wrong into the check whose subject is exactly this would be its own
 * instance.
 */
export function readAtRef(ref, relativePath, root = WORKSPACE_ROOT) {
  const result = git(['show', `${ref}:${relativePath}`], root);
  if (result.status === 0) return result.stdout;
  const stderr = result.stderr ?? '';
  if (
    /does not exist|exists on disk, but not in|unknown revision|invalid object name/i.test(stderr)
  )
    return null;
  throw new Error(
    `pull-request-target-promotion-lag: could not read \`${ref}:${relativePath}\` — the ` +
      `measurement FAILED, so no verdict can be reported from it.\n${stderr}`,
  );
}

/** Does this workflow text trigger on `pull_request_target`? Read off the `on:` block only. */
export function triggersFromPullRequestTarget(workflowText) {
  let inOn = false;
  for (const line of workflowText.split('\n')) {
    if (/^on:\s*$/.test(line)) {
      inOn = true;
      continue;
    }
    if (inOn && /^\S/.test(line)) break;
    if (inOn && /^\s{2}pull_request_target:\s*$/.test(line)) return true;
  }
  return false;
}

/**
 * The comparable body: content with comments and blank lines removed.
 *
 * Comments are stripped because a reworded rationale is not a behaviour change, and a check that
 * reported one would be noise on the day someone improves a comment. A `#` inside a quoted string
 * would be over-stripped — accepted, because the failure direction is a FALSE DELTA (reported,
 * never a refusal) rather than a missed one.
 */
export function comparableBody(workflowText) {
  return workflowText
    .split('\n')
    .map((line) => line.replace(/\s+#\s.*$/, '').trimEnd())
    .filter((line) => line.trim() !== '' && !/^\s*#/.test(line))
    .join('\n');
}

/** Every `pull_request_target` workflow tracked at `ref`. */
export function targetWorkflowsAt(ref, root = WORKSPACE_ROOT) {
  const listing = git(['ls-tree', '-r', '--name-only', ref, '--', WORKFLOWS_PREFIX], root);
  if (listing.status !== 0) {
    throw new Error(
      `pull-request-target-promotion-lag: could not list workflows at \`${ref}\`. ` +
        'Refusing rather than reporting "no delta" over a tree that was never read.\n' +
        `${listing.stderr ?? ''}`,
    );
  }
  const files = (listing.stdout ?? '').split('\n').filter((f) => f.endsWith('.yml'));
  return files.filter((file) => {
    const text = readAtRef(ref, file, root);
    return text !== null && triggersFromPullRequestTarget(text);
  });
}

/**
 * What each `pull_request_target` workflow on `headRef` looks like against `promotionRef`.
 *
 * `absent` is its own state rather than a delta: a workflow that does not exist on the promotion ref
 * has not been promoted at all, which is a stronger statement than "differs".
 */
/**
 * RESET per walk, so a run that reads nothing cannot report the previous run's number.
 *
 * Incremented inside the walk rather than taken from the returned array's `.length`: the array is a
 * second source that resembles the subject, and the two agree right up to the run where a workflow
 * is dropped between the walk and the result — which is the run the number was needed for.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export function findPromotionLagAt(root, headRef = 'HEAD', promotionRef = DEFAULT_PROMOTION_REF) {
  examinedCount = 0;
  // Resolve the promotion ref BEFORE reading anything through it. `readAtRef` returns null for two
  // different facts — "this ref has no such file" and "there is no such ref" — and only the first is
  // `absent`. Without this line an unfetched `origin/main` reports every workflow as never-promoted,
  // which is a loud wrong answer; a nearby variant of the same collapse (see the `git show` path)
  // would have reported "no delta" over a tree that was never read. That confusion IS this check's
  // subject, so building it into the check would be its own instance of the bug.
  if (git(['rev-parse', '--verify', '--quiet', `${promotionRef}^{commit}`], root).status !== 0) {
    throw new Error(
      `pull-request-target-promotion-lag: could not resolve the promotion ref \`${promotionRef}\`. ` +
        'Refusing rather than reporting every workflow as unpromoted over a ref that does not exist. ' +
        'Check out with `fetch-depth: 0` and fetch the promotion branch.',
    );
  }
  return targetWorkflowsAt(headRef, root).map((file) => {
    examinedCount += 1;
    const here = readAtRef(headRef, file, root);
    const there = readAtRef(promotionRef, file, root);
    if (there === null) return { file, state: 'absent' };
    return {
      file,
      state: comparableBody(here) === comparableBody(there) ? 'promoted' : 'lagging',
    };
  });
}

/** This repository, which is what the CLI asks about. `findPromotionLagAt` takes the root for a test. */
export function promotionLag(headRef = 'HEAD', promotionRef = DEFAULT_PROMOTION_REF) {
  return findPromotionLagAt(WORKSPACE_ROOT, headRef, promotionRef);
}

function main() {
  const at = process.argv.indexOf('--promotion-ref');
  const promotionRef = at === -1 ? DEFAULT_PROMOTION_REF : process.argv[at + 1];
  const lag = promotionLag('HEAD', promotionRef);

  const lagging = lag.filter((w) => w.state !== 'promoted');
  console.log(
    `::examined:: ${readExamined()} pull_request_target workflow(s); ` +
      `${readExamined() - lagging.length} match ${promotionRef}, ${lagging.length} do not`,
  );

  for (const w of lagging) {
    console.log(
      w.state === 'absent'
        ? `  ${w.file}: not on ${promotionRef} at all — nothing of it is live yet`
        : `  ${w.file}: differs from ${promotionRef} — the version that RUNS is ${promotionRef}'s, ` +
            'so edits here are not in effect until a promotion carries them',
    );
  }
  if (lagging.length > 0) {
    console.log(
      'This is a report, not a refusal: a delta is the normal state between promotions. It is ' +
        'printed because two fixes to such a workflow were once verified locally, landed green, ' +
        'and did nothing (issue #2039).',
    );
  } else if (lag.length > 0) {
    // Said out loud. "0 do not" and "there is nothing here to look at" print the same number, and a
    // guard that goes quiet when its subject empties is the shape this repository keeps finding.
    console.log(
      `  every pull_request_target workflow matches ${promotionRef}, so what runs is what was ` +
        'reviewed. This line is the measurement, not the absence of one.',
    );
  }
  console.log('pull-request-target-promotion-lag scan passed.');
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exit(main());
}
