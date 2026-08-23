#!/usr/bin/env node

/**
 * Build-tooling scope-coverage guard (INFRA-060 D4).
 *
 * THE DEFECT THIS FENCES. The affected-scope calculator maps a changed file to a workspace scope
 * by PATH PREFIX alone. Everything outside `packages/` and `apps/` therefore resolved to zero
 * scopes no matter what it governed — including `scripts/build-types-ordered.mjs`, the second half
 * of root `pnpm build`. Measured before the fix:
 *
 *     $ pnpm harness:plan -- --base-ref origin/develop     # one line changed in that file
 *     Scopes:
 *     - none
 *     $ node <ci.yml's "Detect build requirement" step>  ->  required=false
 *     $ pnpm harness:verify -- --base-ref origin/develop --skip-build --skip-record-check
 *     No package or app scope detected from changed files.   ->  exit 0
 *
 * Two REQUIRED status checks, `build` and `quality`, both green having verified nothing, on a PR
 * that changed how every package in the repo is built.
 *
 * WHAT A STRUCTURAL GUARD CAN AND CANNOT DO HERE. It cannot decide whether a path is build
 * tooling — that is a judgement, and a calculator whose judgement is wrong passes every structural
 * check (INFRA-060's own "mechanical ceiling" section says so). What it CAN do is the part that
 * actually rots:
 *
 *   R1  every declared path still exists — a renamed or deleted entry can never match a diff again
 *       and would sit in the list looking like coverage.
 *   R2  the calculator, EXECUTED, still resolves each declared path to the FULL workspace. This is
 *       the rule that is red against the pre-fix calculator, and the rule that catches a later
 *       refactor quietly dropping the workspace-wide branch. It executes rather than reads: the
 *       lesson from HARNESS-052's own guard is that a rule derived by regex from source text
 *       measures spelling, not behaviour.
 *   R3  every file that root `package.json`'s build-defining scripts invoke is declared. This is
 *       the recurrence rule: adding `node scripts/build-next-thing.mjs` to root `build` without
 *       adding it to the list reinstates the exact defect, and nothing else would notice.
 *   R4  a docs-only change still resolves to ZERO scopes, and that stays a PASS. The fix's own
 *       failure mode is over-correction — if every PR builds everything, a slow gate replaces a
 *       silent one and gets bypassed instead. `review-gate` was rolled back the day it was armed
 *       for reddening documentation PRs; this pins that it cannot happen here.
 *
 * ANTI-ROT: every rule is quantified over things this scan enumerated, and it fails loudly when
 * any of those counts is zero — no declared paths, no workspace scopes, no root build script. A
 * guard that examined nothing must not print a pass.
 *
 * Exit code 0 = the workspace-wide path class is declared, live, and behaving; 1 = otherwise.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { WORKSPACE_WIDE_BUILD_TOOLING_PATHS, createVerificationPlan } from './check-plan.mjs';
import { listWorkspaceScopes } from './shared.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Root scripts whose behaviour IS the per-scope verification verbs. A file one of these invokes
 * runs for every package, so changing it changes every package's result.
 */
export const BUILD_DEFINING_ROOT_SCRIPTS = [
  'build',
  'build:js',
  'build:types',
  'build:deps',
  'build:all',
  'typecheck',
  'lint',
  'test',
];

/** A token that names a file in the repo rather than a flag, a glob or a package filter. */
const FILE_TOKEN = /^\.?[\w][\w./-]*\.(?:mjs|cjs|js|ts|mts|cts|sh|json|ya?ml)$/;

/** Docs-only paths used to pin that zero scopes remains reachable and passing (R4). */
export const DOCS_ONLY_CONTROL = [
  'README.md',
  '.agents/tasks/completed/INFRA-060-ci-yml-job-by-job-audit.md',
  'docs/plans/example.md',
];

/**
 * The repo-root files that a root script invokes.
 *
 * Only tokens that resolve to an existing file OUTSIDE `packages/` and `apps/` count: a
 * package-local build config is already selected by the ordinary path-prefix rule, and a token
 * that names nothing on disk is a flag value, not a dependency.
 */
export function extractScriptFileReferences(command, root = WORKSPACE_ROOT) {
  const found = [];
  for (const raw of String(command ?? '').split(/\s+/)) {
    const token = raw.replace(/^["']|["'],?$/g, '');
    if (token.includes('*') || !FILE_TOKEN.test(token)) {
      continue;
    }
    const normalized = token.replace(/^\.\//, '');
    if (normalized.startsWith('packages/') || normalized.startsWith('apps/')) {
      continue;
    }
    if (!existsSync(path.join(root, normalized))) {
      continue;
    }
    if (!found.includes(normalized)) {
      found.push(normalized);
    }
  }
  return found;
}

/**
 * Every rule, evaluated. Returns the findings plus the counts each rule was quantified over, so a
 * caller can refuse to report a pass over nothing.
 *
 * `planner` and `listScopes` exist so R2 can be exercised against a calculator that has STOPPED
 * honouring the declared list — the refactor R2 is there to catch — and against a workspace other
 * than this one. `main()` always uses the real pair, so the seams cannot make the SHIPPED scan
 * measure anything but the shipped calculator over the real workspace. (`listWorkspaceScopes`
 * resolves the workspace from the process cwd captured at import, so `root` alone cannot redirect
 * it; the seam is the only honest way to point the rules at a fixture.)
 */
export async function findBuildToolingScopeFindings(
  root = WORKSPACE_ROOT,
  { planner = createVerificationPlan, listScopes = listWorkspaceScopes } = {},
) {
  const findings = [];
  const declared = [...WORKSPACE_WIDE_BUILD_TOOLING_PATHS];
  const scopes = await listScopes();

  const rootManifestPath = path.join(root, 'package.json');
  const rootScripts = existsSync(rootManifestPath)
    ? (JSON.parse(readFileSync(rootManifestPath, 'utf8')).scripts ?? {})
    : {};
  const buildScripts = BUILD_DEFINING_ROOT_SCRIPTS.filter(
    (name) => typeof rootScripts[name] === 'string',
  );

  // R1 — every declared path still exists.
  for (const declaredPath of declared) {
    if (!existsSync(path.join(root, declaredPath))) {
      findings.push({
        rule: 'R1 declared-path-exists',
        detail:
          `\`${declaredPath}\` is declared workspace-wide build tooling but does not exist. A ` +
          `renamed or deleted entry can never match a diff again, so it sits in the list looking ` +
          `like coverage while contributing none. Update or remove it.`,
      });
    }
  }

  // R2 — the calculator, executed, resolves each declared path to the FULL workspace.
  for (const declaredPath of declared) {
    const plan = planner({ scopes, changedFiles: [declaredPath] });
    if (plan.scopes.length !== scopes.length) {
      findings.push({
        rule: 'R2 resolves-to-full-workspace',
        detail:
          `changing \`${declaredPath}\` alone resolves to ${plan.scopes.length} of ` +
          `${scopes.length} workspace scopes. It is declared as build tooling — a path that ` +
          `changes how EVERY package is built, typechecked or linted — so anything short of the ` +
          `full workspace means CI's \`build\` and \`quality\` checks can report green over ` +
          `packages this change actually affects (INFRA-060 D4).`,
      });
    }
  }

  // R3 — every file the root build-defining scripts invoke is declared.
  let referencesExamined = 0;
  for (const name of buildScripts) {
    for (const reference of extractScriptFileReferences(rootScripts[name], root)) {
      referencesExamined += 1;
      if (declared.includes(reference)) {
        continue;
      }
      findings.push({
        rule: 'R3 build-script-reference-declared',
        detail:
          `root \`package.json\`'s \`${name}\` script invokes \`${reference}\`, which is NOT in ` +
          `WORKSPACE_WIDE_BUILD_TOOLING_PATHS. A file the root build runs affects every package, ` +
          `so a change to it must select the full workspace; today it would select zero scopes ` +
          `and leave \`build\` and \`quality\` green having verified nothing. Add it to the list ` +
          `in scripts/harness/check-plan.mjs.`,
      });
    }
  }

  // R4 — a docs-only change still resolves to zero scopes.
  const docsPlan = planner({ scopes, changedFiles: [...DOCS_ONLY_CONTROL] });
  if (docsPlan.scopes.length !== 0) {
    findings.push({
      rule: 'R4 docs-only-stays-empty',
      detail:
        `a docs-only change (${DOCS_ONLY_CONTROL.join(', ')}) resolves to ` +
        `${docsPlan.scopes.length} scopes, not zero. Zero scopes is the CORRECT answer for a ` +
        `documentation PR, and it must stay a pass: widening the workspace-wide class until it ` +
        `catches docs trades a silent gate for a slow one, and a slow gate gets bypassed.`,
    });
  }

  return {
    findings,
    declaredCount: declared.length,
    scopeCount: scopes.length,
    buildScriptCount: buildScripts.length,
    referencesExamined,
  };
}

export async function main() {
  const result = await findBuildToolingScopeFindings();

  const vacuous = [
    result.declaredCount === 0 ? 'ZERO declared workspace-wide paths' : null,
    result.scopeCount === 0 ? 'ZERO workspace scopes enumerated' : null,
    result.buildScriptCount === 0 ? 'ZERO build-defining root scripts found' : null,
  ].filter(Boolean);

  if (vacuous.length > 0) {
    process.stdout.write(
      `build-tooling-scope scan failed — ${vacuous.join('; ')}.\n` +
        'Every rule here is quantified over things this scan enumerated, so finding none means the\n' +
        'scan stopped reading its subject, not that the calculator is sound.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (result.findings.length > 0) {
    process.stdout.write('build-tooling-scope scan failed (INFRA-060 D4):\n');
    for (const finding of result.findings) {
      process.stdout.write(`  - ${finding.rule}: ${finding.detail}\n`);
    }
    process.stdout.write(
      "\nA scope calculator that resolves build tooling to zero scopes makes CI's `build` and\n" +
        '`quality` checks report success over a monorepo they never built.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `build-tooling-scope scan passed — ${result.declaredCount} declared path(s) each resolve to ` +
      `all ${result.scopeCount} workspace scopes; ${result.referencesExamined} file reference(s) ` +
      `across ${result.buildScriptCount} root build script(s) declared; docs-only still resolves ` +
      `to zero scopes.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
