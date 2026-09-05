/**
 * The LIVE half of the required-status-check reconciliation, split out of
 * `scan-main-required-checks.mjs` (INFRA-162, issue #2219).
 *
 * It moved rather than grew. The declaration comparison gained a second dimension — the strict
 * status-check policy, which decides whether GitHub refuses a stale head — and the scan was already
 * at its `file-size` baseline. The baseline may fall and must never rise, so the block that reaches
 * the network went to its own file instead of the ceiling going up.
 */
import { spawnSync } from 'node:child_process';

import { fetchAllPages } from './github-api.mjs';
import {
  DECLARATION_FILE,
  readDeclaration,
  readDeclarationBranch,
  strictPolicyFindings,
} from './required-status-checks-declaration.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** The branch whose required contexts must be able to fail (INFRA-055). Owned here so the live half
 * and the offline scan share one name without importing each other. */
export const GOVERNED_BRANCH = 'main';

/** `owner/repo` from the `origin` remote — no repository identity is hard-coded in this scan. */
export function originSlug(root = WORKSPACE_ROOT) {
  const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
  if (remote.status !== 0) return undefined;
  const match = /[:/]([^/:]+\/[^/]+?)(?:\.git)?\s*$/.exec(remote.stdout ?? '');
  return match ? match[1] : undefined;
}

/**
 * Every branch whose declaration is reconciled against its live ruleset.
 *
 * `main` because its contexts must be able to fail (INFRA-055). `develop` because its list is what
 * `verify-like-ci` claims equivalence with (INFRA-056): `ci-mirror-map.mjs` pins the stage list to
 * the DECLARATION offline, so a declaration that has silently fallen behind the live ruleset would
 * let the mirror certify coverage of a check nobody requires any more — or, worse, stay silent about
 * one that was newly added.
 */
export const RECONCILED_BRANCHES = [GOVERNED_BRANCH, 'develop'];

/**
 * Reconcile each declared branch against its LIVE ruleset. Opt-in (`--live`) and never part of the
 * hermetic default: the scheduled reconciler owns this half, so a GitHub outage costs a red cron
 * rather than a blocked promotion.
 */
export function reconcileLive(root = WORKSPACE_ROOT) {
  return RECONCILED_BRANCHES.flatMap((branch) => reconcileLiveBranch(root, branch));
}

/**
 * Exported and fetch-injectable so the WIRING is falsifiable: a test can hand it a live payload
 * whose strict flag disagrees with the declaration and see the finding come back. Asserting the
 * pure `strictPolicyFindings` alone would stay green if this function stopped calling it, which is
 * the unfalsifiable shape this repository refuses.
 */
export function reconcileLiveBranch(root, branchName, readRules = null) {
  // SEC-007: `/rules/branches/{branch}` is a PAGINATED collection, and it was read one page at a
  // time. A ruleset whose rules spilled onto page two would make this scan report that `main` does
  // not require a check it does in fact require — a false DRIFT finding, and in the other direction a
  // rule that silently disappeared from the comparison. `fetchAllPages` walks it to exhaustion and
  // refuses to return a list it cannot prove is complete.
  let rules;
  if (readRules) {
    rules = readRules(branchName);
  } else {
    const slug = originSlug(root);
    if (!slug)
      return [{ context: '(live)', detail: 'could not resolve the `origin` remote slug.' }];
    try {
      rules = fetchAllPages(`repos/${slug}/rules/branches/${branchName}`).records;
    } catch (error) {
      // A failed or unparseable read is a real shape (an auth prompt, an HTML error page, a proxy
      // interstitial, a truncated walk). Report it as a finding with the message rather than throwing
      // an opaque error out of a scan whose whole subject is checks that fail informatively.
      return [{ context: '(live)', detail: error.message }];
    }
  }
  const live = new Set(
    rules
      .filter((rule) => rule.type === 'required_status_checks')
      .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
      .map((check) => check.context),
  );
  const declared = new Set(readDeclaration(root, branchName).map((entry) => entry.context));
  const findings = [];
  // INFRA-162: the contexts are not the whole rule. `strict_required_status_checks_policy` decides
  // whether GitHub refuses a stale head, and reducing the live rule to `.context` discarded it.
  const branch = readDeclarationBranch(root, branchName);
  findings.push(...strictPolicyFindings({ branchName, rules, branch }));
  for (const context of live) {
    if (!declared.has(context)) {
      findings.push({
        context,
        detail: `the LIVE \`${branchName}\` ruleset requires it, but ${DECLARATION_FILE} does not declare it under \`branches.${branchName}\` — so nothing has checked that it is covered.`,
      });
    }
  }
  for (const context of declared) {
    if (!live.has(context)) {
      findings.push({
        context,
        detail: `${DECLARATION_FILE} declares it required on \`${branchName}\`, but the LIVE ruleset does not require it — it is enforcing nothing.`,
      });
    }
  }
  return findings;
}
