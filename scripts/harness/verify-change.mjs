import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createVerificationPlan, renderScopeCoverageLine } from './check-plan.mjs';
// HARNESS-058 note, deliberately NOT a prerequisite gate here: this script's WORKSPACE_ROOT is
// `process.cwd()`, and it is legitimately run against synthetic workspace fixtures that have no
// install (see `__tests__/detect-changed-files.test.mjs`). A tree-prerequisite assertion at this
// layer fails those honest runs. The prerequisite is asserted by the entry points that invoke this
// one as a GATE — `verify-like-ci.mjs` and `pre-push.mjs` — which own a real repository root.
import { resolveScenarioVerification } from './scenario-owner-map.mjs';
import { verifyScopeScenarios } from './verify-change-scenarios.mjs';
import {
  createRootVerificationCommands,
  runRepositoryCheck,
  selectRepositoryChecks,
} from './verify-change-commands.mjs';
export {
  createRootVerificationCommands,
  repositoryCheckEnvironment,
  selectRepositoryChecks,
  shouldUseFullRootVerification,
} from './verify-change-commands.mjs';
import {
  WORKSPACE_ROOT,
  appendJobSummary,
  classifyScopeChanges,
  collectPackageManifestChanges,
  collectRootManifestChange,
  detectChangedFiles,
  listWorkspaceScopes,
  parseScopeArgs,
  runCommand,
} from './shared.mjs';

function inferReportFormat(reportFile, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat;
  }
  if (reportFile?.endsWith('.json')) {
    return 'json';
  }
  return 'json';
}

function renderFiles(files) {
  if (files.length === 0) {
    return 'explicit scope';
  }
  return files.join(', ');
}

async function main() {
  const options = parseScopeArgs(process.argv.slice(2));
  const scopes = await listWorkspaceScopes();
  const changedFiles = detectChangedFiles(options.baseRef);
  const manifestChangesByScope = await collectPackageManifestChanges({
    scopes,
    changedFiles,
    baseRef: options.baseRef,
  });
  const rootManifestChange = await collectRootManifestChange({
    changedFiles,
    baseRef: options.baseRef,
  });
  const plan = createVerificationPlan({
    scopes,
    changedFiles,
    scopeTokens: options.scopeTokens,
    manifestChangesByScope,
    rootManifestChange,
    includeDependentScopes: !options.skipDependentScopes,
  });

  // INFRA-060 D4: state the coverage BEFORE any check runs and again in the job summary, so a
  // reader of the check list cannot mistake "verified nothing" for "verified everything, clean".
  const coverageLine = renderScopeCoverageLine(plan);
  process.stdout.write(`${coverageLine}\n`);
  appendJobSummary(`### Affected-scope verification\n\n${coverageLine}\n`);

  const selectedRepositoryChecks = options.skipRepositoryChecks
    ? []
    : selectRepositoryChecks(plan.repositoryChecks, options.skipRepositoryCheckNames);
  const omittedRepositoryChecks = plan.repositoryChecks.filter(
    (check) => !selectedRepositoryChecks.includes(check),
  );

  if (selectedRepositoryChecks.length > 0) {
    process.stdout.write(`Repository checks: ${selectedRepositoryChecks.join(', ')}\n`);
    for (const check of selectedRepositoryChecks) {
      runRepositoryCheck(check, options.dryRun);
    }
  }
  if (omittedRepositoryChecks.length > 0) {
    process.stdout.write(`Repository checks skipped: ${omittedRepositoryChecks.join(', ')}\n`);
  }

  if (plan.scopes.length === 0) {
    process.stdout.write('No package or app scope detected from changed files.\n');
    process.stdout.write('Use --scope <packages/foo|apps/bar> to run explicit verification.\n');
    return;
  }

  const rootVerificationCommands = createRootVerificationCommands({ plan, options });
  const completedRootChecks = new Set();
  for (const rootCommand of rootVerificationCommands) {
    process.stdout.write(`\n[verify ${rootCommand.mode}] ${rootCommand.check}\n`);
    runCommand(rootCommand.command, rootCommand.args, WORKSPACE_ROOT, options.dryRun);
    completedRootChecks.add(rootCommand.check);
  }

  const summary = [];

  for (const planScope of plan.scopes) {
    const scope = scopes.find((candidate) => candidate.relativeDir === planScope.scope);
    if (!scope) {
      throw new Error(`Unknown planned scope: ${planScope.scope}`);
    }

    const files = planScope.files;
    const classification = classifyScopeChanges(scope, files, options.scopeTokens.length > 0, {
      manifestChange: manifestChangesByScope.get(scope.relativeDir) ?? null,
    });
    const plannedChecks = new Set(planScope.checks);
    const scenarioVerification = resolveScenarioVerification(scope);
    const shouldRunScenarios =
      options.includeScenarios ||
      (Boolean(scenarioVerification) &&
        (classification.hasScenarioChanges ||
          classification.hasSourceChanges ||
          classification.hasConfigChanges));

    process.stdout.write(`\n[verify] ${scope.relativeDir}\n`);
    process.stdout.write(`files: ${renderFiles(files)}\n`);

    const notes = [...planScope.notes];
    const stepResults = {
      build: 'skip',
      test: 'skip',
      lint: 'skip',
      typecheck: 'skip',
      scenarios: 'not-applicable',
    };

    if (completedRootChecks.has('build') && plannedChecks.has('build')) {
      stepResults.build = 'pass';
      notes.push('root verification command covered this scope build');
    }

    if (completedRootChecks.has('test') && plannedChecks.has('test')) {
      stepResults.test = 'pass';
      notes.push('root verification command covered this scope test');
    }

    if (completedRootChecks.has('lint') && plannedChecks.has('lint')) {
      stepResults.lint = 'pass';
      notes.push('root verification command covered this scope lint');
    }

    if (completedRootChecks.has('typecheck') && plannedChecks.has('typecheck')) {
      stepResults.typecheck = 'pass';
      notes.push('root verification command covered this scope typecheck');
    }

    const scenarioResult = await verifyScopeScenarios({
      scope,
      scenarioVerification,
      shouldRun: shouldRunScenarios,
      dryRun: options.dryRun,
      skipRecordCheck: options.skipRecordCheck,
    });
    stepResults.scenarios = scenarioResult.status;
    notes.push(...scenarioResult.notes);

    summary.push({
      scope: scope.relativeDir,
      build: stepResults.build,
      test: stepResults.test,
      lint: stepResults.lint,
      typecheck: stepResults.typecheck,
      scenarios: stepResults.scenarios,
      scenarioLabels: scenarioResult.labels,
      notes,
    });
  }

  process.stdout.write('\nVerification summary:\n');
  for (const item of summary) {
    const checks = [
      item.build !== 'skip' ? 'build' : null,
      item.test !== 'skip' ? 'test' : null,
      item.lint !== 'skip' ? 'lint' : null,
      item.typecheck !== 'skip' ? 'typecheck' : null,
      item.scenarioLabels.length > 0 ? `scenarios(${item.scenarioLabels.join('; ')})` : null,
    ].filter(Boolean);

    process.stdout.write(`- ${item.scope}: ${checks.join(', ') || 'no runnable checks'}\n`);
    for (const note of item.notes) {
      process.stdout.write(`  note: ${note}\n`);
    }
  }

  if (options.reportFile) {
    const format = inferReportFormat(options.reportFile, options.reportFormat);
    // No `passed` field (HARNESS-051): every check failure throws, so this report is written only
    // on a fully successful run and its existence IS the outcome. The field it replaced could only
    // ever be written `true`, which reads like a signal and becomes a fail-open the moment a
    // consumer trusts it. If a report is ever wanted for failed runs, write it from the failure
    // path first, then add a field that can actually vary.
    const reportPayload = {
      type: 'verify',
      timestamp: new Date().toISOString(),
      scopes: summary.map((item) => ({
        scope: item.scope,
        build: item.build,
        test: item.test,
        lint: item.lint,
        typecheck: item.typecheck,
        scenarios: item.scenarios,
        notes: item.notes,
      })),
    };

    const targetPath = path.resolve(WORKSPACE_ROOT, options.reportFile);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `${JSON.stringify(reportPayload, null, 2)}\n`, 'utf8');

    const relativePath = path.relative(WORKSPACE_ROOT, targetPath);
    process.stdout.write(
      `\nReport written: ${relativePath.startsWith('..') ? targetPath : relativePath}\n`,
    );
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
