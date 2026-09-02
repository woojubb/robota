import { promises as fs } from 'node:fs';
import path from 'node:path';

import { canonicalTemporaryDirectory } from './canonical-temporary-directory.mjs';
import { createVerificationPlan, renderScopeCoverageLine } from './check-plan.mjs';
import {
  compareScenarioRecordArtifact,
  createScenarioRecordPayload,
  executeCommandCapture,
  listScenarioRecordArtifacts,
  readScenarioRecordArtifact,
  relativePathFromRoot,
  renderCommand,
  validateScenarioRecordArtifact,
} from './scenario-records.mjs';
// HARNESS-058 note, deliberately NOT a prerequisite gate here: this script's WORKSPACE_ROOT is
// `process.cwd()`, and it is legitimately run against synthetic workspace fixtures that have no
// install (see `__tests__/detect-changed-files.test.mjs`). A tree-prerequisite assertion at this
// layer fails those honest runs. The prerequisite is asserted by the entry points that invoke this
// one as a GATE — `verify-like-ci.mjs` and `pre-push.mjs` — which own a real repository root.
import { resolveScenarioVerification } from './scenario-owner-map.mjs';
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

const REPOSITORY_CHECK_NAMES = new Set([
  'task-plan-scan',
  'harness-consistency',
  'publish-safety',
  'harness-tests',
  'repository-review',
]);

export function selectRepositoryChecks(repositoryChecks, omittedNames) {
  for (const name of omittedNames) {
    if (!REPOSITORY_CHECK_NAMES.has(name)) {
      throw new Error(`Unknown repository check omission: ${name}`);
    }
  }

  const omitted = new Set(omittedNames);
  return repositoryChecks.filter((check) => !omitted.has(check));
}

export function repositoryCheckEnvironment(check) {
  return check === 'harness-tests' ? { TMPDIR: canonicalTemporaryDirectory() } : {};
}

const ROOT_OPERATION_CONFIGURATION = [
  {
    check: 'build',
    skipOption: 'skipBuild',
    fullScript: 'build',
    affectedScript: 'build:affected',
  },
  { check: 'test', skipOption: 'skipTests', fullScript: 'test', affectedScript: 'test:affected' },
  { check: 'lint', skipOption: 'skipLint', fullScript: 'lint', affectedScript: 'lint:affected' },
  {
    check: 'typecheck',
    skipOption: 'skipTypecheck',
    fullScript: 'typecheck',
    affectedScript: 'typecheck:affected',
  },
];

export function shouldUseFullRootVerification(plan, options, environment = process.env) {
  const explicitlyFull =
    environment.HARNESS_VERIFY_MODE === 'full' || environment.RELEASE_VERIFICATION === '1';
  const workspaceWide = (plan.workspaceWideTriggers?.length ?? 0) > 0;
  const inferredFullWorkspace =
    options.scopeTokens.length === 0 &&
    plan.workspaceScopeCount > 0 &&
    plan.scopes.length === plan.workspaceScopeCount;
  return explicitlyFull || workspaceWide || inferredFullWorkspace;
}

export function createRootVerificationCommands({ plan, options, environment = process.env }) {
  const full = shouldUseFullRootVerification(plan, options, environment);
  const affectedArgs = [];
  if (options.baseRef) affectedArgs.push('--base-ref', options.baseRef);
  for (const scope of options.scopeTokens) affectedArgs.push('--scope', scope);

  return ROOT_OPERATION_CONFIGURATION.filter(({ check, skipOption }) => {
    if (options[skipOption]) return false;
    return plan.scopes.some((scope) => scope.checks.includes(check));
  }).map(({ check, fullScript, affectedScript }) => ({
    check,
    mode: full ? 'full' : 'affected',
    command: 'pnpm',
    args: full
      ? [fullScript]
      : [affectedScript, ...(affectedArgs.length > 0 ? ['--', ...affectedArgs] : [])],
  }));
}

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

function runRepositoryCheck(check, dryRun) {
  switch (check) {
    case 'task-plan-scan':
      runCommand('pnpm', ['harness:scan:test-plans'], WORKSPACE_ROOT, dryRun);
      break;
    case 'harness-consistency':
      runCommand('pnpm', ['harness:scan:consistency'], WORKSPACE_ROOT, dryRun);
      break;
    case 'publish-safety':
      runCommand('pnpm', ['harness:scan:publish'], WORKSPACE_ROOT, dryRun);
      break;
    case 'harness-tests':
      // INFRA-026: run the WHOLE harness test directory — a hardcoded file list silently
      // excluded every test added after it was written (18 of 29 files by 2026-07-04).
      runCommand(
        'pnpm',
        [
          'exec',
          'vitest',
          'run',
          'scripts/harness/__tests__',
          '--pool=threads',
          '--maxWorkers=2',
          '--testTimeout=30000',
          '--reporter=dot',
        ],
        WORKSPACE_ROOT,
        dryRun,
        repositoryCheckEnvironment(check),
      );
      break;
    case 'repository-review':
      process.stdout.write('note: repository-review has no executable fast-path check.\n');
      break;
    default:
      throw new Error(`Unknown repository check: ${check}`);
  }
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

    const scenarios = [];
    if (shouldRunScenarios) {
      if (scenarioVerification) {
        const recordArtifacts = await listScenarioRecordArtifacts(scope.relativeDir);
        const recordByCommand = new Map();

        if (!options.dryRun && recordArtifacts.length === 0) {
          throw new Error(
            `Scenario verification for ${scope.relativeDir} requires authoritative records under examples/scenarios/*.record.json. ` +
              `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\`.`,
          );
        }

        if (!options.dryRun && recordArtifacts.length !== scenarioVerification.commands.length) {
          throw new Error(
            `Scenario record count mismatch for ${scope.relativeDir}: ` +
              `${recordArtifacts.length} artifact(s) for ${scenarioVerification.commands.length} scenario command(s). ` +
              `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` to refresh the canonical set.`,
          );
        }

        if (!options.dryRun) {
          for (const artifactPath of recordArtifacts) {
            const record = await readScenarioRecordArtifact(artifactPath);
            const validationFindings = validateScenarioRecordArtifact(record, scope.relativeDir);
            if (validationFindings.length > 0) {
              throw new Error(
                `Invalid scenario record artifact at ${relativePathFromRoot(artifactPath)}: ${validationFindings.join('; ')}`,
              );
            }

            const renderedCommand = record.command.rendered;
            if (recordByCommand.has(renderedCommand)) {
              throw new Error(
                `Duplicate scenario record command mapping for ${scope.relativeDir}: ${renderedCommand} ` +
                  `appears more than once under examples/scenarios/*.record.json.`,
              );
            }

            recordByCommand.set(renderedCommand, {
              artifactPath,
              record,
            });
          }
        }

        for (let index = 0; index < scenarioVerification.commands.length; index += 1) {
          const command = scenarioVerification.commands[index];
          const execution = executeCommandCapture(
            command.command,
            command.args,
            command.workdir,
            command.env,
            options.dryRun,
          );
          scenarios.push(command.label);

          if (execution.status !== 0) {
            stepResults.scenarios = 'fail';
            throw new Error(`Command failed: ${execution.rendered}`);
          }

          if (options.dryRun) {
            continue;
          }

          const renderedCommand = renderCommand(command.command, command.args);
          const artifactEntry = recordByCommand.get(renderedCommand);
          if (!artifactEntry) {
            throw new Error(
              `No scenario record artifact matched command ${renderedCommand} for ${scope.relativeDir}. ` +
                `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` to regenerate authoritative records.`,
            );
          }

          const executionRecord = createScenarioRecordPayload({
            scope: scope.relativeDir,
            packageName: scope.workspaceName,
            command: command.command,
            args: command.args,
            cwd: command.workdir,
            status: execution.status,
            stdout: execution.stdout,
            stderr: execution.stderr,
          });
          if (!options.skipRecordCheck) {
            const differences = compareScenarioRecordArtifact(
              artifactEntry.record,
              executionRecord,
            );
            if (differences.length > 0) {
              stepResults.scenarios = 'fail';
              throw new Error(
                `Scenario record drift detected for ${scope.relativeDir} at ${relativePathFromRoot(artifactEntry.artifactPath)}: ${differences.join('; ')}. ` +
                  `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` if the change is intentional.`,
              );
            }
            notes.push(
              `scenario output matched ${relativePathFromRoot(artifactEntry.artifactPath)}`,
            );
          } else {
            notes.push(`scenario ran successfully (record check skipped)`);
          }
        }

        stepResults.scenarios = 'pass';
      } else {
        notes.push(
          'scenario-like verification was requested, but no owner scenario command is registered for this scope',
        );
      }
    } else if (scenarioVerification) {
      notes.push(
        'owner scenario verification exists; use --include-scenarios to run it explicitly',
      );
    }

    summary.push({
      scope: scope.relativeDir,
      build: stepResults.build,
      test: stepResults.test,
      lint: stepResults.lint,
      typecheck: stepResults.typecheck,
      scenarios: stepResults.scenarios,
      scenarioLabels: scenarios,
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
