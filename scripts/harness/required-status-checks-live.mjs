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
 * `main` because its contexts must be able to fail (INFRA-055). `develop` because its four stable
 * decisions must stay aligned with the live ruleset; a declaration that silently falls behind would
 * make local policy and GitHub enforcement disagree.
 */
export const RECONCILED_BRANCHES = [GOVERNED_BRANCH, 'develop'];

/**
 * Reconcile each declared branch against its LIVE ruleset. Opt-in (`--live`) and never part of the
 * hermetic default: ruleset-drift.yml is workflow_dispatch-only under the 2026-08-04 no-cron
 * directive. As observed on 2026-09-23, its last run was 2026-08-11; detection requires an
 * explicit invocation. A GitHub outage makes that live invocation fail, not the offline gate.
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
export function reconcileLiveBranch(root, branchName, readRules = null, readRuleset = null) {
  // Preserve the unreadable-remote result even in a repository with no declaration yet.
  const slug = readRules ? null : originSlug(root);
  if (!readRules && !slug)
    return [{ context: '(live)', detail: 'could not resolve the `origin` remote slug.' }];
  const branch = readDeclarationBranch(root, branchName);
  const findings = rulesetScopeFindings(root, branchName, branch, readRuleset);
  // SEC-007: `/rules/branches/{branch}` is a PAGINATED collection, and it was read one page at a
  // time. A ruleset whose rules spilled onto page two would make this scan report that `main` does
  // not require a check it does in fact require — a false DRIFT finding, and in the other direction a
  // rule that silently disappeared from the comparison. `fetchAllPages` walks it to exhaustion and
  // refuses to return a list it cannot prove is complete.
  let rules;
  if (readRules) {
    rules = readRules(branchName);
  } else {
    try {
      rules = fetchAllPages(`repos/${slug}/rules/branches/${branchName}`).records;
    } catch (error) {
      // A failed or unparseable read is a real shape (an auth prompt, an HTML error page, a proxy
      // interstitial, a truncated walk). Report it as a finding with the message rather than throwing
      // an opaque error out of a scan whose whole subject is checks that fail informatively.
      return [...findings, { context: '(live)', detail: error.message }];
    }
  }
  const live = new Set(
    rules
      .filter((rule) => rule.type === 'required_status_checks')
      .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
      .map((check) => check.context),
  );
  const declared = new Set(readDeclaration(root, branchName).map((entry) => entry.context));
  // INFRA-162: the contexts are not the whole rule. `strict_required_status_checks_policy` decides
  // whether GitHub refuses a stale head, and reducing the live rule to `.context` discarded it.
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

/** The ruleset object owns scope; the branch-rules projection cannot carry it. */
function rulesetScopeFindings(root, branchName, branch, readRuleset) {
  const context = `(ruleset scope: ${branchName})`;
  const id = branch.ruleset_id;
  if (!Number.isSafeInteger(id) || id <= 0) {
    return [
      { context, detail: `${DECLARATION_FILE} declares no valid ruleset_id for ${branchName}.` },
    ];
  }
  let ruleset;
  try {
    ruleset = readRuleset ? readRuleset(id) : readLiveRuleset(root, id);
  } catch (error) {
    return [
      {
        context: '(live)',
        detail: `Could not read ruleset ${id} for ${branchName}: ${error.message}`,
      },
    ];
  }
  const include = ruleset?.conditions?.ref_name?.include;
  const ref = `refs/heads/${branchName}`;
  if (!Array.isArray(include) || !include.includes(ref)) {
    return [
      {
        context,
        detail: `Declared ruleset ${id} does not explicitly include ${ref} in conditions.ref_name.include (${JSON.stringify(include) ?? 'missing'}). An empty include targets no ref; inspect the ruleset scope instead of treating missing checks as normal.`,
      },
    ];
  }
  return [];
}

/** Rulesets are individual JSON objects, not paginated branch-rule collections. */
function readLiveRuleset(root, id) {
  const slug = originSlug(root);
  if (!slug) throw new Error('could not resolve the `origin` remote slug.');
  const response = spawnSync('gh', ['api', `repos/${slug}/rulesets/${id}`], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (response.status !== 0)
    throw new Error(response.error?.message ?? response.stderr?.trim() ?? 'ruleset query failed');
  return JSON.parse(response.stdout);
}
