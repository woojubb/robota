import path from 'node:path';

import {
  compareScenarioRecordArtifact,
  createScenarioRecordPayload,
  executeCommandCapture,
  listScenarioRecordArtifacts,
  readScenarioRecordArtifact,
  relativePathFromRoot,
  validateScenarioRecordArtifact,
} from './scenario-records.mjs';
import { resolveScenarioVerification } from './scenario-owner-map.mjs';
import { listWorkspaceScopes, WORKSPACE_ROOT } from './shared.mjs';

async function main() {
  const scopes = await listWorkspaceScopes();
  const scope = scopes.find((item) => item.relativeDir === 'packages/agents');

  if (!scope) {
    throw new Error('packages/agents scope was not found.');
  }

  const artifacts = await listScenarioRecordArtifacts(scope.relativeDir);
  const artifactPath = artifacts.find((item) => item.endsWith('offline-verify.record.json'));
  if (!artifactPath) {
    throw new Error('packages/agents canonical scenario record was not found.');
  }

  const record = await readScenarioRecordArtifact(artifactPath);
  const validationFindings = validateScenarioRecordArtifact(record, scope.relativeDir);
  if (validationFindings.length > 0) {
    throw new Error(`record validation failed: ${validationFindings.join('; ')}`);
  }

  const workdir = path.join(WORKSPACE_ROOT, scope.relativeDir);
  const scenarioVerification = resolveScenarioVerification(scope);
  if (!scenarioVerification || scenarioVerification.commands.length !== 1) {
    throw new Error('packages/agents self-check expects exactly one owner scenario verification command.');
  }

  const [{ command, args, workdir: commandWorkdir, env }] = scenarioVerification.commands;
  const execution = executeCommandCapture(command, args, commandWorkdir, env);
  if (execution.status !== 0) {
    throw new Error(`packages/agents scenario:verify failed with status ${execution.status}`);
  }

  const executionRecord = createScenarioRecordPayload({
    scope: scope.relativeDir,
    packageName: scope.workspaceName,
    command,
    args,
    cwd: commandWorkdir,
    status: execution.status,
    stdout: execution.stdout,
    stderr: execution.stderr,
  });

  const positiveDiff = compareScenarioRecordArtifact(record, executionRecord);
  if (positiveDiff.length > 0) {
    throw new Error(`expected matching record, found drift: ${positiveDiff.join('; ')}`);
  }

  const tamperedRecord = {
    ...record,
    stdout: {
      ...record.stdout,
      normalized: `${record.stdout.normalized}\nTAMPERED`,
      sha256: record.stdout.sha256,
    },
  };
  const tamperedValidation = validateScenarioRecordArtifact(tamperedRecord, scope.relativeDir);
  if (!tamperedValidation.includes('stdout.sha256 does not match stdout.normalized')) {
    throw new Error('tampered record did not trigger validation failure.');
  }

  const mismatchedRecord = {
    ...record,
    stdout: {
      ...record.stdout,
      sha256: '0'.repeat(64),
    },
  };
  const negativeDiff = compareScenarioRecordArtifact(mismatchedRecord, executionRecord);
  if (!negativeDiff.some((item) => item.startsWith('stdout hash mismatch'))) {
    throw new Error('tampered hash did not trigger drift detection.');
  }

  process.stdout.write('harness self-check passed.\n');
  process.stdout.write(`record: ${relativePathFromRoot(artifactPath)}\n`);
  process.stdout.write('positive_match: ok\n');
  process.stdout.write('negative_drift_detection: ok\n');
  process.stdout.write('artifact_validation: ok\n');
}

void main();
