import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

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

function runHookFixture(scriptRelativePath, input, projectDir) {
  return spawnSync('bash', [path.join(WORKSPACE_ROOT, scriptRelativePath)], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      ROBOTA_DISABLE_LESSONS_DIGEST: '1',
    },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

async function readJsonl(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runHookFixtureSelfCheck() {
  const projectDir = await fs.mkdtemp(path.join(tmpdir(), 'robota-hook-self-check-'));
  try {
    const sourcePath = path.join(projectDir, 'packages/example/src/provider.ts');
    const transcriptPath = path.join(projectDir, 'transcript.jsonl');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.mkdir(path.join(projectDir, '.agents/evals/local-metrics'), { recursive: true });
    await fs.writeFile(sourcePath, '');
    await fs.writeFile(
      transcriptPath,
      [
        JSON.stringify({ type: 'assistant', message: { content: 'Previous answer' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ tool_input: { file_path: 'packages/example/src/provider.ts' } }),
        JSON.stringify({ is_error: true }),
        JSON.stringify({ is_error: true }),
        JSON.stringify({ is_error: true }),
      ].join('\n'),
    );

    const block = runHookFixture(
      '.claude/hooks/check-forbidden-patterns.sh',
      {
        session_id: 'self-check-session',
        tool_input: {
          file_path: sourcePath,
          content: 'const value: any = input;\n',
        },
      },
      projectDir,
    );
    if (block.status !== 2) {
      throw new Error('check-forbidden-patterns fixture did not block forbidden content.');
    }

    const correction = runHookFixture(
      '.claude/hooks/correction-detect.sh',
      {
        session_id: 'self-check-session',
        transcript_path: transcriptPath,
        prompt: '아니 다시 처리해주세요',
      },
      projectDir,
    );
    if (correction.status !== 0) {
      throw new Error('correction-detect fixture failed.');
    }

    const stop = runHookFixture(
      '.claude/hooks/eval-log-stop.sh',
      {
        session_id: 'self-check-session',
        transcript_path: transcriptPath,
      },
      projectDir,
    );
    if (stop.status !== 0) {
      throw new Error('eval-log-stop fixture failed.');
    }

    const metricsDir = path.join(projectDir, '.agents/evals/local-metrics');
    const blocks = await readJsonl(path.join(metricsDir, 'blocks.jsonl'));
    const corrections = await readJsonl(path.join(metricsDir, 'corrections.jsonl'));
    const reverts = await readJsonl(path.join(metricsDir, 'reverts.jsonl'));
    const sessions = await readJsonl(path.join(metricsDir, 'sessions.jsonl'));

    if (blocks.length !== 1 || corrections.length !== 1 || reverts.length !== 2) {
      throw new Error('hook fixtures did not write expected lesson metrics.');
    }
    const [session] = sessions;
    if (
      session.blocks_total !== 1 ||
      session.corrections_total !== 1 ||
      session.reverts_total !== 2
    ) {
      throw new Error('session metrics did not include lesson signal totals.');
    }
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
}

async function main() {
  const scopes = await listWorkspaceScopes();
  const scope = scopes.find((item) => item.relativeDir === 'packages/agent-core');

  if (!scope) {
    throw new Error('packages/agent-core scope was not found.');
  }

  const artifacts = await listScenarioRecordArtifacts(scope.relativeDir);
  const artifactPath = artifacts.find((item) => item.endsWith('offline-verify.record.json'));
  if (!artifactPath) {
    throw new Error('packages/agent-core canonical scenario record was not found.');
  }

  const record = await readScenarioRecordArtifact(artifactPath);
  const validationFindings = validateScenarioRecordArtifact(record, scope.relativeDir);
  if (validationFindings.length > 0) {
    throw new Error(`record validation failed: ${validationFindings.join('; ')}`);
  }

  const workdir = path.join(WORKSPACE_ROOT, scope.relativeDir);
  const scenarioVerification = resolveScenarioVerification(scope);
  if (!scenarioVerification || scenarioVerification.commands.length !== 1) {
    throw new Error(
      'packages/agent-core self-check expects exactly one owner scenario verification command.',
    );
  }

  const [{ command, args, workdir: commandWorkdir, env }] = scenarioVerification.commands;
  const execution = executeCommandCapture(command, args, commandWorkdir, env);
  if (execution.status !== 0) {
    throw new Error(`packages/agent-core scenario:verify failed with status ${execution.status}`);
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

  await runHookFixtureSelfCheck();

  process.stdout.write('harness self-check passed.\n');
  process.stdout.write(`record: ${relativePathFromRoot(artifactPath)}\n`);
  process.stdout.write('positive_match: ok\n');
  process.stdout.write('negative_drift_detection: ok\n');
  process.stdout.write('artifact_validation: ok\n');
  process.stdout.write('hook_fixtures: ok\n');
}

void main();
