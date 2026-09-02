import { classifyScopeChanges, mapFilesToScopes, resolveRequestedScopes } from './shared.mjs';
import { classifyRepositoryChecks } from './repository-check-classification.mjs';

/**
 * The planned checks that cannot run without the monorepo's build output. CI's `build` job gates
 * `pnpm build` (and the `package-dist` artifact every later job restores) on this exact set.
 *
 * ONE implementation, two callers (INFRA-056). `classify-changed-paths.mjs` states the principle
 * this follows: if a second caller re-derives "no build needed" with its own copy of the rule, that
 * copy IS the bypass — it goes stale silently and the gate it feeds reports a pass over ground it
 * never covered. `verify-like-ci` imports this rather than restating it, and a unit test pins it to
 * the literal still inlined in `ci.yml`'s "Detect build requirement" step.
 */
export const PACKAGE_DIST_CHECKS = ['build', 'test', 'typecheck'];

/**
 * Root paths that change how EVERY workspace scope is built, typechecked or linted.
 *
 * INFRA-060 D4. The calculator maps a changed file to a scope by PATH PREFIX alone, so a file
 * outside `packages/` and `apps/` resolved to zero scopes no matter what it governed. A one-line
 * edit to `scripts/build-types-ordered.mjs` — the second half of root `pnpm build` — therefore
 * planned `scopes: []`, which made CI's `build` job skip `pnpm build` and its `quality` job verify
 * nothing, both REQUIRED and both green. The vacuous green was the symptom; the calculator not
 * knowing that build tooling is a dependency of every package was the defect.
 *
 * A change to any path here selects the FULL workspace, because the honest answer to "which
 * packages does this affect" is "all of them".
 *
 * MEMBERSHIP RULE, so this list can be extended without re-deriving it: a repo-root path belongs
 * here when changing it changes the OUTCOME of `build` / `typecheck` / `lint` / `test` for scopes
 * that did not themselves change. Measured, per entry:
 *
 * - `scripts/build-types-ordered.mjs` — root `build` is
 *   `pnpm --filter "./packages/**" build:js && node scripts/build-types-ordered.mjs`; it builds
 *   every package's `.d.ts` in topological order.
 * - `package.json` — root; owns `build`, `typecheck`, `lint`, `test`, the shared toolchain in
 *   `devDependencies` (typescript, tsdown, vitest, eslint), `pnpm.overrides` and `engines`.
 * - `pnpm-workspace.yaml` — decides which directories ARE workspace packages at all.
 * - `tsconfig.base.json` — extended by 80 of the 86 in-scope tsconfigs.
 * - `tsconfig.json` — root project references; `tsconfig.eslint.json` extends it.
 * - `tsconfig.eslint.json` — extended by the per-package `tsconfig.eslint.json` that each
 *   package's `.eslintrc.json` names as its `parserOptions.project`.
 * - `.eslintrc.json`, `.eslintignore` — root `lint` is `eslint packages apps`, and every package's
 *   own `.eslintrc.json` resolves through the root config.
 *
 * DELIBERATELY EXCLUDED, with the measurement behind each — over the last 400 develop commits:
 *
 * - `pnpm-lock.yaml` (41 commits touched it). All 7 of the commits that touched it WITHOUT
 *   touching any scope also touched root `package.json`, so it adds no detection this list does
 *   not already have; adding it would move the other 34 from partial to full verification for
 *   nothing. A per-scope dependency change already selects that scope and its dependents.
 * - `vitest.config.ts` (root). It does not govern a scope's `pnpm test`: vitest resolves its
 *   config from the cwd and does not search upward. Verified — `packages/agent-tools` has no local
 *   vitest config and still collected 26 test files, which the root `include`
 *   (`packages/** /src/**`) cannot match from that cwd.
 * - `.prettierrc.json`, `commitlint.config.js`, `stryker.conf.mjs`, `.dependency-cruiser.cjs`,
 *   `.nvmrc` — none is read by a scope's `build`/`test`/`lint`/`typecheck`.
 *
 * Guarded by `scan-build-tooling-scope` (`pnpm harness:scan`), which re-derives the root build
 * script's file references, EXECUTES the calculator against each entry, and fails if any entry
 * stops resolving to the full workspace — or if a new file joins root `build` without joining
 * this list.
 */
export const WORKSPACE_WIDE_BUILD_TOOLING_PATHS = [
  '.eslintignore',
  '.eslintrc.json',
  'package.json',
  'pnpm-workspace.yaml',
  'scripts/build-types-ordered.mjs',
  'tsconfig.base.json',
  'tsconfig.eslint.json',
  'tsconfig.json',
];

/** The changed files that are workspace-wide build tooling, in the order given. */
export function listWorkspaceWideTriggers(changedFiles) {
  const declared = new Set(WORKSPACE_WIDE_BUILD_TOOLING_PATHS);
  return (changedFiles ?? []).filter((file) => declared.has(file));
}

/** Whether a verification plan contains a scope whose checks need the monorepo build output. */
export function planRequiresPackageDist(plan) {
  const dependent = new Set(PACKAGE_DIST_CHECKS);
  return (plan?.scopes ?? []).some((scope) =>
    (scope?.checks ?? []).some((check) => dependent.has(check)),
  );
}

function parseValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

export function parsePlanArgs(argv) {
  const options = {
    scopeTokens: [],
    changedFiles: [],
    baseRef: null,
    reportFile: null,
    reportFormat: null,
    skipDependentScopes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case '--':
        break;
      case '--scope': {
        const value = parseValue(argv, index, '--scope');
        options.scopeTokens.push(value);
        index += 1;
        break;
      }
      case '--changed-file': {
        const value = parseValue(argv, index, '--changed-file');
        options.changedFiles.push(value);
        index += 1;
        break;
      }
      case '--base-ref': {
        options.baseRef = parseValue(argv, index, '--base-ref');
        index += 1;
        break;
      }
      case '--report-file': {
        options.reportFile = parseValue(argv, index, '--report-file');
        index += 1;
        break;
      }
      case '--report-format': {
        const value = parseValue(argv, index, '--report-format');
        if (value !== 'markdown' && value !== 'json') {
          throw new Error('--report-format must be one of: markdown, json');
        }
        options.reportFormat = value;
        index += 1;
        break;
      }
      case '--skip-dependent-scopes':
        options.skipDependentScopes = true;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
  }

  return options;
}

function fileBelongsToScope(file, scope) {
  return file === scope.relativeDir || file.startsWith(`${scope.relativeDir}/`);
}

function listChecks(scope, classification) {
  const checks = [];
  if (classification.needsBuild && scope.scripts.build) {
    checks.push('build');
  }
  if (classification.needsTest && scope.scripts.test) {
    checks.push('test');
  }
  // Lint capability is owned by workspace-operation-registry: a workspace can use its own
  // script, the root ESLint fallback, or an explicit N/A declaration. The plan must not silently
  // omit changed source merely because package.json has no local `lint` script.
  if (classification.needsLint) {
    checks.push('lint');
  }
  if (classification.needsTypecheck) {
    checks.push('typecheck');
  }
  return checks;
}

function needsDependentChecks(classification) {
  return (
    classification.hasEntrypointChanges ||
    classification.hasDependencyManifestChanges ||
    classification.hasPublicSurfaceManifestChanges
  );
}

function findDependentScopes(scopes, ownerScope) {
  const dependents = [];
  const visited = new Set();
  const queue = [ownerScope.workspaceName];

  while (queue.length > 0) {
    const workspaceName = queue.shift();
    for (const scope of scopes) {
      if (visited.has(scope.relativeDir)) {
        continue;
      }
      if ((scope.workspaceDependencies ?? []).includes(workspaceName)) {
        visited.add(scope.relativeDir);
        dependents.push(scope);
        queue.push(scope.workspaceName);
      }
    }
  }

  return dependents;
}

function listNotes(classification) {
  const notes = [];
  if (classification.hasVersionOnlyManifestChanges) {
    notes.push('manifest:version-only');
  } else if (classification.hasDependencyManifestChanges) {
    notes.push('manifest:dependency');
  } else if (classification.hasPublicSurfaceManifestChanges) {
    notes.push('manifest:public-surface');
  } else if (classification.hasScriptOrBuildManifestChanges) {
    notes.push('manifest:script-or-build');
  } else if (classification.hasPublishMetadataManifestChanges) {
    notes.push('manifest:publish-metadata');
  }
  return notes;
}

function addCheck(checks, check) {
  if (!checks.includes(check)) {
    checks.push(check);
  }
}

export function createVerificationPlan({
  scopes,
  changedFiles,
  scopeTokens = [],
  manifestChangesByScope = new Map(),
  rootManifestChange = null,
  includeDependentScopes = true,
}) {
  const scopeFiles = mapFilesToScopes(changedFiles, scopes);
  const explicitScopes = scopeTokens.length > 0;
  const rawWorkspaceWideTriggers = explicitScopes ? [] : listWorkspaceWideTriggers(changedFiles);
  const workspaceWideTriggers = rawWorkspaceWideTriggers.filter(
    (file) => file !== 'package.json' || rootManifestChange?.workspaceWide !== false,
  );
  const workspaceWide = workspaceWideTriggers.length > 0;
  const forceFullVerification = explicitScopes || workspaceWide;

  let initialSelectedScopes;
  if (explicitScopes) {
    initialSelectedScopes = resolveRequestedScopes(scopeTokens, scopes);
  } else if (workspaceWide) {
    // Build tooling changed: every scope is affected, so every scope is verified in full.
    initialSelectedScopes = [...scopes];
  } else {
    initialSelectedScopes = scopes.filter(
      (scope) => (scopeFiles.get(scope.relativeDir) ?? []).length > 0,
    );
  }

  const scopePlans = new Map();

  for (const scope of initialSelectedScopes) {
    const files = scopeFiles.get(scope.relativeDir) ?? [];
    const classification = classifyScopeChanges(scope, files, forceFullVerification, {
      manifestChange: manifestChangesByScope.get(scope.relativeDir) ?? null,
    });
    const notes = listNotes(classification);
    if (workspaceWide) {
      notes.push(`workspace-wide:${workspaceWideTriggers.join(', ')}`);
    }
    scopePlans.set(scope.relativeDir, {
      scope: scope.relativeDir,
      workspaceName: scope.workspaceName,
      files,
      checks: listChecks(scope, classification),
      notes,
    });

    if (includeDependentScopes && needsDependentChecks(classification)) {
      for (const dependentScope of findDependentScopes(scopes, scope)) {
        if (scopePlans.has(dependentScope.relativeDir)) {
          continue;
        }
        scopePlans.set(dependentScope.relativeDir, {
          scope: dependentScope.relativeDir,
          workspaceName: dependentScope.workspaceName,
          files: [],
          checks: dependentScope.hasTsconfig ? ['typecheck'] : [],
          notes: [`dependent-of:${scope.relativeDir}`],
        });
      }
    }
  }

  const planScopes = scopes
    .map((scope) => scopePlans.get(scope.relativeDir))
    .filter((scopePlan) => Boolean(scopePlan));

  const unmappedFiles = changedFiles.filter((file) => {
    return !initialSelectedScopes.some((scope) => fileBelongsToScope(file, scope));
  });

  const repositoryChecks = [];
  if (
    planScopes.some((item) =>
      item.notes.some(
        (note) => note === 'manifest:version-only' || note === 'manifest:publish-metadata',
      ),
    )
  ) {
    repositoryChecks.push('publish-safety');
  }
  for (const check of classifyRepositoryChecks(unmappedFiles, rootManifestChange)) {
    addCheck(repositoryChecks, check);
  }

  return {
    changedFiles,
    scopes: planScopes,
    unmappedFiles,
    repositoryChecks,
    workspaceWideTriggers,
    rootManifestClassification: changedFiles.includes('package.json')
      ? (rootManifestChange?.kind ?? 'unclassified-workspace-wide')
      : 'not-changed',
    workspaceScopeCount: scopes.length,
  };
}

/**
 * One line stating how much of the workspace this plan covers.
 *
 * INFRA-060 D4, second half. A plan over zero scopes and a plan over every scope produced output a
 * reader had to reconstruct from the absence of a list, and the CI check they feed reported the
 * same word — `success` — either way. "Verified 0 scopes" and "verified 86 scopes" must not look
 * identical from outside, so the count is stated explicitly, always, and the zero case says in
 * words that no package or app was verified. Zero scopes is NOT an error: a docs-only change
 * legitimately resolves to zero, and reddening it would redden every documentation PR.
 */
export function renderScopeCoverageLine(plan) {
  const selected = plan?.scopes?.length ?? 0;
  const total = plan?.workspaceScopeCount ?? 0;

  if (selected === 0) {
    return `Scope coverage: 0 of ${total} workspace scopes — this plan verifies NO package or app.`;
  }

  const triggers = plan?.workspaceWideTriggers ?? [];
  const reason =
    triggers.length > 0 ? ` (workspace-wide build tooling changed: ${triggers.join(', ')})` : '';
  return `Scope coverage: ${selected} of ${total} workspace scopes${reason}.`;
}

export function renderPlanSummary(plan) {
  const lines = [
    'Verification plan',
    `Changed files: ${plan.changedFiles.length}`,
    renderScopeCoverageLine(plan),
  ];
  if (plan.rootManifestClassification && plan.rootManifestClassification !== 'not-changed') {
    lines.push(`Root manifest: ${plan.rootManifestClassification}`);
  }

  lines.push('', 'Scopes:');
  if (plan.scopes.length === 0) {
    lines.push('- none');
  } else {
    for (const item of plan.scopes) {
      lines.push(`- ${item.scope}: ${item.checks.join(', ') || 'no runnable checks'}`);
    }
  }

  if (plan.repositoryChecks.length > 0) {
    lines.push('', `Repository checks: ${plan.repositoryChecks.join(', ')}`);
  }

  if (plan.unmappedFiles.length > 0) {
    lines.push('', 'Files outside workspace scopes:');
    for (const file of plan.unmappedFiles) {
      lines.push(`- ${file}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
