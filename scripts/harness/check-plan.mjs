import { classifyScopeChanges, mapFilesToScopes, resolveRequestedScopes } from './shared.mjs';
import { classifyRepositoryChecks } from './repository-check-classification.mjs';

export { parsePlanArgs } from './plan-args.mjs';

export const PACKAGE_DIST_CHECKS = ['build', 'test', 'typecheck'];

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

export function listWorkspaceWideTriggers(changedFiles) {
  const declared = new Set(WORKSPACE_WIDE_BUILD_TOOLING_PATHS);
  return (changedFiles ?? []).filter((file) => declared.has(file));
}

export function planRequiresPackageDist(plan) {
  const dependent = new Set(PACKAGE_DIST_CHECKS);
  return (plan?.scopes ?? []).some((scope) =>
    (scope?.checks ?? []).some((check) => dependent.has(check)),
  );
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

  const unmappedFiles = changedFiles.filter(
    (file) => !initialSelectedScopes.some((scope) => fileBelongsToScope(file, scope)),
  );

  const repositoryChecks = [];
  const needsPublishSafety = planScopes.some((item) =>
    item.notes.some(
      (note) => note === 'manifest:version-only' || note === 'manifest:publish-metadata',
    ),
  );
  if (needsPublishSafety) {
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
