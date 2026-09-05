/**
 * The `.github/required-status-checks.json` DECLARATION, and the strict-policy half of the live
 * reconciliation (INFRA-162, issue #2219).
 *
 * `scan-main-required-checks.mjs` owns the substance assertions R1-R7 over the declared contexts.
 * This module owns the two facts that are NOT a context list: where the declaration lives, and the
 * branch-protection setting "require branches to be up to date before merging", which the
 * reconciler discarded because it reduced each live rule to `.context`. A flip of that flag in
 * either direction therefore produced no finding and `ruleset-drift.yml` reported success — the
 * `enforcement-architecture.md` § "Silence is not success" shape: the reconciler did not check, and
 * reported as if it had.
 *
 * Pure over its inputs apart from `readDeclarationBranch`, so the comparison has a failing input
 * offline and the hermetic half of the scan needs no network to prove it.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** The declaration `scan-main-required-checks.mjs` enforces. */
export const DECLARATION_FILE = path.join('.github', 'required-status-checks.json');

/** Read and validate the declaration for a branch. Throws on anything that would make it vacuous. */
export function readDeclaration(root, branchName) {
  const file = path.join(root, DECLARATION_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `${DECLARATION_FILE} is missing. It is the SOURCE of what \`protect-main\` must require; without it this gate would pass vacuously.`,
    );
  }
  const declaration = JSON.parse(readFileSync(file, 'utf8'));
  const branch = declaration?.branches?.[branchName];
  const contexts = branch?.required_status_checks;
  if (!Array.isArray(contexts) || contexts.length === 0) {
    throw new Error(
      `${DECLARATION_FILE} declares no required status checks for \`${branchName}\`. An empty list satisfies every assertion below vacuously — which is the exact defect (#1427) this scan exists to prevent.`,
    );
  }
  return contexts;
}

/**
 * The branch object `.github/required-status-checks.json` declares, or `null` when it declares none.
 *
 * Separate from `readDeclaration`, which returns only the context list: the strict-policy assertion
 * below reads a SIBLING key of that list and must be able to say "the key is absent" rather than
 * inherit the context list's throw.
 */
export function readDeclarationBranch(root, branchName) {
  const file = path.join(root, DECLARATION_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `${DECLARATION_FILE} is missing. It is the SOURCE of what \`protect-main\` must require; without it this gate would pass vacuously.`,
    );
  }
  return JSON.parse(readFileSync(file, 'utf8'))?.branches?.[branchName] ?? null;
}

/**
 * The branch-protection setting "require branches to be up to date before merging", as GitHub names
 * it in a ruleset's `required_status_checks` parameters (INFRA-162, issue #2219).
 */
export const STRICT_POLICY_KEY = 'strict_required_status_checks_policy';

/** The finding channel name the strict-policy assertion reports under. */
const strictContext = (branchName) => `(strict policy: ${branchName})`;

/**
 * The live strict policy, read from a `/rules/branches/{branch}` payload.
 *
 * NEVER DEFAULTS. `parameters?.strict_required_status_checks_policy ?? false` would read every
 * unreadable shape below as "strict is off" and report a clean reconciliation over a setting it
 * never saw — the `enforcement-architecture.md` § "Silence is not success" failure this assertion
 * exists to break. Unknown is a finding that names what could not be read.
 *
 * @returns {{ ok: true, value: boolean } | { ok: false, detail: string }}
 */
function liveStrictPolicy(rules) {
  const checkRules = (Array.isArray(rules) ? rules : []).filter(
    (rule) => rule?.type === 'required_status_checks',
  );
  if (checkRules.length === 0) {
    return {
      ok: false,
      detail: `the live ruleset payload carries no \`required_status_checks\` rule, so \`${STRICT_POLICY_KEY}\` could not be read at all. Unknown is not \`false\`.`,
    };
  }
  const values = new Set();
  for (const rule of checkRules) {
    const parameters = rule?.parameters;
    if (
      parameters === null ||
      typeof parameters !== 'object' ||
      !Object.hasOwn(parameters, STRICT_POLICY_KEY)
    ) {
      return {
        ok: false,
        detail: `a live \`required_status_checks\` rule carries no \`${STRICT_POLICY_KEY}\` in its parameters, so the strict policy could not be read. Unknown is not \`false\`.`,
      };
    }
    const value = parameters[STRICT_POLICY_KEY];
    if (typeof value !== 'boolean') {
      return {
        ok: false,
        detail: `the live \`${STRICT_POLICY_KEY}\` is \`${JSON.stringify(value)}\`, which is not a boolean — the strict policy could not be read.`,
      };
    }
    values.add(value);
  }
  if (values.size !== 1) {
    return {
      ok: false,
      detail: `the live \`required_status_checks\` rules disagree on \`${STRICT_POLICY_KEY}\` (${[...values].join(', ')}), so no single strict policy could be read.`,
    };
  }
  return { ok: true, value: [...values][0] };
}

/**
 * The declared strict policy for a branch, from the branch object of the declaration file.
 *
 * @returns {{ ok: true, value: boolean } | { ok: false, detail: string }}
 */
function declaredStrictPolicy(branch, branchName) {
  if (branch === null || typeof branch !== 'object') {
    return {
      ok: false,
      detail: `${DECLARATION_FILE} declares no \`branches.${branchName}\`, so the strict policy it should hold is undeclared.`,
    };
  }
  if (!Object.hasOwn(branch, STRICT_POLICY_KEY)) {
    return {
      ok: false,
      detail: `${DECLARATION_FILE} does not declare \`${STRICT_POLICY_KEY}\` under \`branches.${branchName}\`, so turning "require branches to be up to date before merging" on or off is a silent change. Declare the value the ruleset actually holds.`,
    };
  }
  const value = branch[STRICT_POLICY_KEY];
  if (typeof value !== 'boolean') {
    return {
      ok: false,
      detail: `${DECLARATION_FILE} declares \`${STRICT_POLICY_KEY}: ${JSON.stringify(value)}\` under \`branches.${branchName}\`, which is not a boolean.`,
    };
  }
  return { ok: true, value };
}

/**
 * Reconcile the declared strict policy with the live one (INFRA-162 TC-02/TC-03).
 *
 * Pure over its inputs so the comparison has a failing input offline: `rules` is the live payload
 * shape and `branch` the declaration's branch object.
 */
export function strictPolicyFindings({ branchName, rules, branch }) {
  const live = liveStrictPolicy(rules);
  const declared = declaredStrictPolicy(branch, branchName);
  const findings = [];
  if (!live.ok) findings.push({ context: strictContext(branchName), detail: live.detail });
  if (!declared.ok) findings.push({ context: strictContext(branchName), detail: declared.detail });
  if (live.ok && declared.ok && live.value !== declared.value) {
    findings.push({
      context: strictContext(branchName),
      detail: `${DECLARATION_FILE} declares \`${STRICT_POLICY_KEY}: ${declared.value}\` for \`${branchName}\`, but the LIVE ruleset holds \`${live.value}\` — the branch-protection strict policy has moved since it was declared, or the declaration was changed without the ruleset.`,
    });
  }
  return findings;
}
