import { classifyScopeChanges, mapFilesToScopes, resolveRequestedScopes } from './shared.mjs';

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
  if (classification.needsLint && scope.scripts.lint) {
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

function classifyRepositoryChecks(unmappedFiles) {
  const checks = [];

  for (const file of unmappedFiles) {
    if (file.startsWith('.agents/tasks/')) {
      addCheck(checks, 'task-plan-scan');
    } else if (
      file === 'AGENTS.md' ||
      file.startsWith('.agents/rules/') ||
      file.startsWith('.agents/skills/')
    ) {
      addCheck(checks, 'harness-consistency');
      addCheck(checks, 'task-plan-scan');
    } else if (file.startsWith('scripts/harness/') || file.startsWith('.claude/hooks/')) {
      addCheck(checks, 'harness-tests');
      addCheck(checks, 'harness-consistency');
    } else if (file.startsWith('.github/workflows/') || file.startsWith('.husky/')) {
      addCheck(checks, 'harness-tests');
      addCheck(checks, 'harness-consistency');
    } else if (
      file === 'package.json' ||
      file === 'pnpm-workspace.yaml' ||
      file === 'pnpm-lock.yaml'
    ) {
      addCheck(checks, 'harness-consistency');
    } else {
      addCheck(checks, 'repository-review');
    }
  }

  return checks;
}

export function createVerificationPlan({
  scopes,
  changedFiles,
  scopeTokens = [],
  manifestChangesByScope = new Map(),
  includeDependentScopes = true,
}) {
  const scopeFiles = mapFilesToScopes(changedFiles, scopes);
  const initialSelectedScopes =
    scopeTokens.length > 0
      ? resolveRequestedScopes(scopeTokens, scopes)
      : scopes.filter((scope) => (scopeFiles.get(scope.relativeDir) ?? []).length > 0);

  const scopePlans = new Map();

  for (const scope of initialSelectedScopes) {
    const files = scopeFiles.get(scope.relativeDir) ?? [];
    const classification = classifyScopeChanges(scope, files, scopeTokens.length > 0, {
      manifestChange: manifestChangesByScope.get(scope.relativeDir) ?? null,
    });
    scopePlans.set(scope.relativeDir, {
      scope: scope.relativeDir,
      workspaceName: scope.workspaceName,
      files,
      checks: listChecks(scope, classification),
      notes: listNotes(classification),
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
  for (const check of classifyRepositoryChecks(unmappedFiles)) {
    addCheck(repositoryChecks, check);
  }

  return {
    changedFiles,
    scopes: planScopes,
    unmappedFiles,
    repositoryChecks,
  };
}

export function renderPlanSummary(plan) {
  const lines = ['Verification plan', `Changed files: ${plan.changedFiles.length}`];

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
