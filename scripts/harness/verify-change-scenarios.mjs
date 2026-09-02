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

export async function verifyScopeScenarios({
  scope,
  scenarioVerification,
  shouldRun,
  dryRun,
  skipRecordCheck,
}) {
  const result = { status: 'not-applicable', labels: [], notes: [] };
  if (!shouldRun) {
    if (scenarioVerification) {
      result.notes.push(
        'owner scenario verification exists; use --include-scenarios to run it explicitly',
      );
    }
    return result;
  }
  if (!scenarioVerification) {
    result.notes.push(
      'scenario-like verification was requested, but no owner scenario command is registered for this scope',
    );
    return result;
  }

  const artifacts = await listScenarioRecordArtifacts(scope.relativeDir);
  if (!dryRun && artifacts.length === 0) {
    throw new Error(
      `Scenario verification for ${scope.relativeDir} requires authoritative records under examples/scenarios/*.record.json. ` +
        `Run \`pnpm harness:record -- --scope ${scope.relativeDir}\`.`,
    );
  }
  if (!dryRun && artifacts.length !== scenarioVerification.commands.length) {
    throw new Error(
      `Scenario record count mismatch for ${scope.relativeDir}: ${artifacts.length} artifact(s) for ` +
        `${scenarioVerification.commands.length} scenario command(s). Run \`pnpm harness:record -- --scope ` +
        `${scope.relativeDir}\` to refresh the canonical set.`,
    );
  }

  const records = new Map();
  if (!dryRun) {
    for (const artifactPath of artifacts) {
      const record = await readScenarioRecordArtifact(artifactPath);
      const findings = validateScenarioRecordArtifact(record, scope.relativeDir);
      if (findings.length > 0) {
        throw new Error(
          `Invalid scenario record artifact at ${relativePathFromRoot(artifactPath)}: ${findings.join('; ')}`,
        );
      }
      const rendered = record.command.rendered;
      if (records.has(rendered)) {
        throw new Error(
          `Duplicate scenario record command mapping for ${scope.relativeDir}: ${rendered} appears more than once under examples/scenarios/*.record.json.`,
        );
      }
      records.set(rendered, { artifactPath, record });
    }
  }

  for (const command of scenarioVerification.commands) {
    const execution = executeCommandCapture(
      command.command,
      command.args,
      command.workdir,
      command.env,
      dryRun,
    );
    result.labels.push(command.label);
    if (execution.status !== 0) {
      throw new Error(`Command failed: ${execution.rendered}`);
    }
    if (dryRun) continue;

    const rendered = renderCommand(command.command, command.args);
    const artifact = records.get(rendered);
    if (!artifact) {
      throw new Error(
        `No scenario record artifact matched command ${rendered} for ${scope.relativeDir}. ` +
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
    if (skipRecordCheck) {
      result.notes.push('scenario ran successfully (record check skipped)');
      continue;
    }
    const differences = compareScenarioRecordArtifact(artifact.record, executionRecord);
    if (differences.length > 0) {
      throw new Error(
        `Scenario record drift detected for ${scope.relativeDir} at ${relativePathFromRoot(artifact.artifactPath)}: ` +
          `${differences.join('; ')}. Run \`pnpm harness:record -- --scope ${scope.relativeDir}\` if the change is intentional.`,
      );
    }
    result.notes.push(`scenario output matched ${relativePathFromRoot(artifact.artifactPath)}`);
  }
  result.status = 'pass';
  return result;
}
