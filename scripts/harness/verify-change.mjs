import path from 'node:path';

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
import { resolveScenarioVerification } from './scenario-owner-map.mjs';
import {
  WORKSPACE_ROOT,
  classifyScopeChanges,
  detectChangedFiles,
  listWorkspaceScopes,
  mapFilesToScopes,
  parseScopeArgs,
  resolveRequestedScopes,
  runCommand,
} from './shared.mjs';

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
  const scopeFiles = mapFilesToScopes(changedFiles, scopes);
  const selectedScopes = options.scopeTokens.length > 0
    ? resolveRequestedScopes(options.scopeTokens, scopes)
    : scopes.filter((scope) => (scopeFiles.get(scope.relativeDir) ?? []).length > 0);

  if (selectedScopes.length === 0) {
    process.stdout.write('No package or app scope detected from changed files.\n');
    process.stdout.write('Use --scope <packages/foo|apps/bar> to run explicit verification.\n');
    return;
  }

  const summary = [];

  for (const scope of selectedScopes) {
    const files = scopeFiles.get(scope.relativeDir) ?? [];
    const classification = classifyScopeChanges(scope, files, options.scopeTokens.length > 0);
    const workdir = path.join(WORKSPACE_ROOT, scope.relativeDir);
    const scenarioVerification = resolveScenarioVerification(scope);
    const shouldRunScenarios = options.includeScenarios || (
      Boolean(scenarioVerification)
      && (
        classification.hasScenarioChanges
        || classification.hasSourceChanges
        || classification.hasConfigChanges
      )
    );

    process.stdout.write(`\n[verify] ${scope.relativeDir}\n`);
    process.stdout.write(`files: ${renderFiles(files)}\n`);

    if (classification.needsBuild && scope.scripts.build) {
      runCommand('pnpm', ['build'], workdir, options.dryRun);
    }

    if (!options.skipTests && classification.needsTest && scope.scripts.test) {
      runCommand('pnpm', ['test'], workdir, options.dryRun);
    }

    if (!options.skipLint && classification.needsLint && scope.scripts.lint) {
      runCommand('pnpm', ['lint'], workdir, options.dryRun);
    }

    if (!options.skipTypecheck && classification.needsTypecheck) {
      runCommand('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit'], workdir, options.dryRun);
    }

    const notes = [];
    const scenarios = [];
    if (shouldRunScenarios) {
      if (scenarioVerification) {
        const recordArtifacts = await listScenarioRecordArtifacts(scope.relativeDir);
        const recordByCommand = new Map();

        if (!options.dryRun && recordArtifacts.length === 0) {
          throw new Error(
            `Scenario verification for ${scope.relativeDir} requires authoritative records under examples/scenarios/*.record.json. ` +
            `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\`.`
          );
        }

        if (!options.dryRun && recordArtifacts.length !== scenarioVerification.commands.length) {
          throw new Error(
            `Scenario record count mismatch for ${scope.relativeDir}: ` +
            `${recordArtifacts.length} artifact(s) for ${scenarioVerification.commands.length} scenario command(s). ` +
            `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` to refresh the canonical set.`
          );
        }

        if (!options.dryRun) {
          for (const artifactPath of recordArtifacts) {
            const record = await readScenarioRecordArtifact(artifactPath);
            const validationFindings = validateScenarioRecordArtifact(record, scope.relativeDir);
            if (validationFindings.length > 0) {
              throw new Error(
                `Invalid scenario record artifact at ${relativePathFromRoot(artifactPath)}: ${validationFindings.join('; ')}`
              );
            }

            const renderedCommand = record.command.rendered;
            if (recordByCommand.has(renderedCommand)) {
              throw new Error(
                `Duplicate scenario record command mapping for ${scope.relativeDir}: ${renderedCommand} ` +
                `appears more than once under examples/scenarios/*.record.json.`
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
          const execution = executeCommandCapture(command.command, command.args, command.workdir, command.env, options.dryRun);
          scenarios.push(command.label);

          if (execution.status !== 0) {
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
              `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` to regenerate authoritative records.`
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
          const differences = compareScenarioRecordArtifact(artifactEntry.record, executionRecord);
          if (differences.length > 0) {
            throw new Error(
              `Scenario record drift detected for ${scope.relativeDir} at ${relativePathFromRoot(artifactEntry.artifactPath)}: ${differences.join('; ')}. ` +
              `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` if the change is intentional.`
            );
          }

          notes.push(`scenario output matched ${relativePathFromRoot(artifactEntry.artifactPath)}`);
        }
      } else {
        notes.push('scenario-like verification was requested, but no owner scenario command is registered for this scope');
      }
    } else if (scenarioVerification) {
      notes.push('owner scenario verification exists; use --include-scenarios to run it explicitly');
    }

    summary.push({
      scope: scope.relativeDir,
      build: classification.needsBuild && Boolean(scope.scripts.build),
      test: !options.skipTests && classification.needsTest && Boolean(scope.scripts.test),
      lint: !options.skipLint && classification.needsLint && Boolean(scope.scripts.lint),
      typecheck: !options.skipTypecheck && classification.needsTypecheck,
      scenarios,
      notes,
    });
  }

  process.stdout.write('\nVerification summary:\n');
  for (const item of summary) {
    const checks = [
      item.build ? 'build' : null,
      item.test ? 'test' : null,
      item.lint ? 'lint' : null,
      item.typecheck ? 'typecheck' : null,
      item.scenarios.length > 0 ? `scenarios(${item.scenarios.join('; ')})` : null,
    ].filter(Boolean);

    process.stdout.write(`- ${item.scope}: ${checks.join(', ') || 'no runnable checks'}\n`);
    for (const note of item.notes) {
      process.stdout.write(`  note: ${note}\n`);
    }
  }
}

void main();
