#!/usr/bin/env node

/**
 * HARNESS-018e — mechanical floor for the PR-review pipeline's contracts.
 *
 * The pipeline is only as reliable as its machine contracts. This scan fails loudly if:
 *  (1) the REVIEWER agent stops declaring the `ACTIONABLE FINDINGS: <n>` output contract (the
 *      convergence signal the orchestrator routes on), or
 *  (2) the orchestrator stops expressing the merge gate mechanically — the MUST/SHOULD Pre-Merge
 *      gate (no silent deferral, per git-branch.md), the never-merge-`main` rule, and the
 *      `merge-verifier` post-check on develop.
 *
 * It checks CONTRACT PRESENCE (that the pieces still say what the design requires) — not the
 * truthfulness of any runtime count (severity classification is model judgment). Scoped honestly.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

export function collectReviewFindingsFindings(root = WORKSPACE_ROOT) {
  const reviewer = path.join(root, '.claude/agents/pr-review-reviewer.md');
  const orch = path.join(root, '.agents/skills/pr-review-orchestration/SKILL.md');

  const findings = [];

  function must(file, label, re, why) {
    if (!existsSync(file)) {
      findings.push(`${label}: file missing (${path.relative(root, file)})`);
      return;
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
    'pr-review-orchestration',
    /unresolved MUST/i,
    'merge gate no longer references the "no unresolved MUST" Pre-Merge rule.',
  );
  must(
    orch,
    'pr-review-orchestration',
    /never merges? `?main`?|do NOT merge/i,
    'no longer states the agent never merges `main`.',
  );
  must(
    orch,
    'pr-review-orchestration',
    /merge-verifier|MERGE VERIFIED/i,
    'no longer requires the `merge-verifier` post-merge check on develop.',
  );
  must(
    orch,
    'pr-review-orchestration',
    /git-branch\.md/i,
    'no longer anchors the merge gate to git-branch.md (silent-deferral risk).',
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

  console.log('review-findings scan passed.');
  process.exit(0);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
