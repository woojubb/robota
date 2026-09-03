#!/usr/bin/env node

/**
 * HARNESS-018e — mechanical floor for the PR-review pipeline's contracts.
 *
 * The pipeline is only as reliable as its machine contracts. This scan fails loudly if:
 *  (1) the REVIEWER agent stops declaring the `ACTIONABLE FINDINGS: <n>` output contract (the
 *      convergence signal the orchestrator routes on), or
 *  (2) the orchestrator stops expressing the merge gate mechanically — the MUST/SHOULD Pre-Merge
 *      gate (no silent deferral, per git-branch.md), the never-merge-`main` rule, and the
 *      `merge-verifier` post-check on develop, or
 *  (3) the merge verifier stops judging the current required-check projection fail-closed and starts
 *      treating raw history or acknowledgement metadata as a second merge policy.
 *
 * It checks CONTRACT PRESENCE (that the pieces still say what the design requires) — not the
 * truthfulness of any runtime count (severity classification is model judgment). Scoped honestly.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * How many review artifacts the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases (HARNESS-057). RESET at the top of the walk, so a run that reads nothing cannot report the
 * previous run's number, and counted per DISTINCT file rather than per assertion: the first
 * version added one per `must()` and reported 9 artifacts for 3 files read, 18 on the second call
 * (HARNESS-087, issue #2325).
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export function collectReviewFindingsFindings(root = WORKSPACE_ROOT) {
  const reviewer = path.join(root, '.claude/agents/pr-review-reviewer.md');
  const orch = path.join(root, '.agents/skills/pr-finding-resolution-loop/SKILL.md');
  const verifier = path.join(root, '.claude/agents/merge-verifier.md');

  const findings = [];
  const examined = new Set();
  examinedCount = 0;

  function must(file, label, re, why) {
    if (!existsSync(file)) {
      findings.push(`${label}: file missing (${path.relative(root, file)})`);
      return;
    }
    if (!examined.has(file)) {
      examined.add(file);
      examinedCount = examined.size;
    }
    if (!re.test(readFileSync(file, 'utf8'))) {
      findings.push(`${label}: ${why}`);
    }
  }

  // (1) Reviewer output contract.
  must(
    reviewer,
    'pr-review-reviewer',
    /ACTIONABLE FINDINGS:\s*<n>|ACTIONABLE FINDINGS:\s*`?<n>/i,
    'no longer declares the `ACTIONABLE FINDINGS: <n>` output contract (the orchestrator routes on it).',
  );

  // (2) Orchestrator merge-gate contracts.
  must(
    orch,
    'pr-finding-resolution-loop',
    /unresolved MUST/i,
    'merge gate no longer references the "no unresolved MUST" Pre-Merge rule.',
  );
  must(
    orch,
    'pr-finding-resolution-loop',
    /never merges? `?main`?|do NOT merge/i,
    'no longer states the agent never merges `main`.',
  );
  must(
    orch,
    'pr-finding-resolution-loop',
    /merge-verifier|MERGE VERIFIED/i,
    'no longer requires the `merge-verifier` post-merge check on develop.',
  );
  must(
    orch,
    'pr-finding-resolution-loop',
    /git-branch\.md/i,
    'no longer anchors the merge gate to git-branch.md (silent-deferral risk).',
  );

  // (3) Post-merge verifier uses the same effective decision as the merge gate.
  must(
    verifier,
    'merge-verifier',
    /gh pr view\s+<n>\s+--json\s+headRefOid/i,
    'no longer reads the exact merged PR head before judging checks.',
  );
  must(
    verifier,
    'merge-verifier',
    /gh pr checks\s+<n>\s+--required/i,
    'no longer uses the current required-check projection for the CI verdict.',
  );
  must(
    verifier,
    'merge-verifier',
    /current required[\s\S]{0,120}fail[\s\S]{0,80}cancel[\s\S]{0,80}pending[\s\S]{0,120}(?:block|prevent)/i,
    'no longer blocks every current required fail, cancel, or pending result.',
  );
  must(
    verifier,
    'merge-verifier',
    /query failure[\s\S]{0,80}indeterminate required-check set[\s\S]{0,40}fails?[\s\S]{0,20}closed/i,
    'no longer fails closed on query failure or an indeterminate required-check set.',
  );
  must(
    verifier,
    'merge-verifier',
    /unfiltered[^.\n]{0,120}historical[^.\n]{0,160}diagnostic only[^.\n]{0,120}(?:must not|cannot|not affect)/i,
    'no longer limits unfiltered and historical checks to non-verdict diagnostics.',
  );
  must(
    verifier,
    'merge-verifier',
    /acknowledgement[\s\S]{0,160}only through[\s\S]{0,80}required[\s\S]{0,40}review-gate[\s\S]{0,120}never[\s\S]{0,40}blanket bypass/i,
    'no longer delegates acknowledgement to required review-gate without a blanket bypass.',
  );

  return findings;
}

export function main() {
  const findings = collectReviewFindingsFindings();

  if (findings.length > 0) {
    console.error('review-findings scan: FINDINGS');
    for (const f of findings) console.error('  - ' + f);
    console.error(
      '\nThe PR-review pipeline contracts must hold (see .agents/spec-docs/*/HARNESS-018*).',
    );
    process.exit(1);
  }

  console.log(`::examined:: ${examinedCount} review artifacts`);
  console.log('review-findings scan passed.');
  process.exit(0);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
