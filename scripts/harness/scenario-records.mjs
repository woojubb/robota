import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { pathExists, readJson, WORKSPACE_ROOT } from './shared.mjs';

const NOISE_PATTERNS = [/^>\s/, /^CLI\s/, /^(ESM|CJS|DTS)\s/];

export function renderCommand(command, args) {
  return [command, ...args].join(' ');
}

// Strip ANSI escape codes so hashes are stable across FORCE_COLOR environments (CI vs local)
const ANSI_RE = /\x1B\[[0-9;]*m/g;

export function normalizeScenarioStream(text, cwd) {
  const replaced = text.replaceAll(cwd, '<cwd>');
  const lines = replaced
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI_RE, '').trimEnd())
    .filter((line) => !NOISE_PATTERNS.some((pattern) => pattern.test(line)));

  while (lines.length > 0 && lines[0] === '') {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const compacted = [];
  for (const line of lines) {
    if (line === '' && compacted[compacted.length - 1] === '') {
      continue;
    }
    compacted.push(line);
  }

  return compacted.join('\n');
}

export function hashScenarioText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function createScenarioRecordPayload({
  scope,
  packageName,
  command,
  args,
  cwd,
  status,
  stdout,
  stderr,
}) {
  const normalizedStdout = normalizeScenarioStream(stdout, cwd);
  const normalizedStderr = normalizeScenarioStream(stderr, cwd);

  return {
    schemaVersion: 1,
    recordType: 'scenario-record',
    scope,
    packageName,
    command: {
      executable: command,
      args,
      rendered: renderCommand(command, args),
    },
    cwd: '<cwd>',
    status,
    stdout: {
      raw: stdout,
      normalized: normalizedStdout,
      sha256: hashScenarioText(normalizedStdout),
    },
    stderr: {
      raw: stderr,
      normalized: normalizedStderr,
      sha256: hashScenarioText(normalizedStderr),
    },
  };
}

export function executeCommandCapture(command, args, workdir, envOverrides = {}, dryRun = false) {
  const rendered = renderCommand(command, args);
  process.stdout.write(`> (${path.relative(WORKSPACE_ROOT, workdir) || '.'}) ${rendered}\n`);

  if (dryRun) {
    return {
      status: 0,
      stdout: '',
      stderr: '',
      rendered,
    };
  }

  const result = spawnSync(command, args, {
    cwd: workdir,
    env: {
      ...process.env,
      ...envOverrides,
    },
    encoding: 'utf8',
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (stdout.length > 0) {
    process.stdout.write(stdout);
  }
  if (stderr.length > 0) {
    process.stderr.write(stderr);
  }

  return {
    status: result.status ?? 1,
    stdout,
    stderr,
    rendered,
  };
}

export async function listScenarioRecordArtifacts(scopeRelativeDir) {
  const scenariosPath = path.join(WORKSPACE_ROOT, scopeRelativeDir, 'examples', 'scenarios');
  if (!(await pathExists(scenariosPath))) {
    return [];
  }

  const entries = await fs.readdir(scenariosPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.record.json'))
    .map((entry) => path.join(scenariosPath, entry.name))
    .sort();
}

export async function readScenarioRecordArtifact(recordPath) {
  return readJson(recordPath);
}

export function relativePathFromRoot(targetPath) {
  return path.relative(WORKSPACE_ROOT, targetPath);
}

export function validateScenarioRecordArtifact(record, expectedScope) {
  const findings = [];

  if (record === null || typeof record !== 'object') {
    return ['artifact is not a JSON object'];
  }

  if (record.schemaVersion !== 1) {
    findings.push('schemaVersion must be 1');
  }
  if (record.recordType !== 'scenario-record') {
    findings.push('recordType must be "scenario-record"');
  }
  if (record.scope !== expectedScope) {
    findings.push(`scope must match workspace (${expectedScope})`);
  }
  if (record.cwd !== '<cwd>') {
    findings.push('cwd must be "<cwd>"');
  }
  if (typeof record.status !== 'number' || !Number.isInteger(record.status)) {
    findings.push('status must be an integer');
  }
  if (record.packageName !== null && typeof record.packageName !== 'string') {
    findings.push('packageName must be a string or null');
  }

  const command = record.command;
  if (!command || typeof command !== 'object') {
    findings.push('command block is missing');
  } else {
    if (typeof command.executable !== 'string' || command.executable.length === 0) {
      findings.push('command.executable must be a non-empty string');
    }
    if (!Array.isArray(command.args) || !command.args.every((item) => typeof item === 'string')) {
      findings.push('command.args must be an array of strings');
    }
    if (typeof command.rendered !== 'string' || command.rendered.length === 0) {
      findings.push('command.rendered must be a non-empty string');
    } else if (
      typeof command.executable === 'string' &&
      Array.isArray(command.args) &&
      renderCommand(command.executable, command.args) !== command.rendered
    ) {
      findings.push('command.rendered must match command.executable and command.args');
    }
  }

  const stdout = record.stdout;
  if (!stdout || typeof stdout !== 'object') {
    findings.push('stdout block is missing');
  } else {
    if (typeof stdout.normalized !== 'string') {
      findings.push('stdout.normalized must be a string');
    }
    if (typeof stdout.sha256 !== 'string') {
      findings.push('stdout.sha256 must be a string');
    } else if (
      typeof stdout.normalized === 'string' &&
      hashScenarioText(stdout.normalized) !== stdout.sha256
    ) {
      findings.push('stdout.sha256 does not match stdout.normalized');
    }
  }

  const stderr = record.stderr;
  if (!stderr || typeof stderr !== 'object') {
    findings.push('stderr block is missing');
  } else {
    if (typeof stderr.normalized !== 'string') {
      findings.push('stderr.normalized must be a string');
    }
    if (typeof stderr.sha256 !== 'string') {
      findings.push('stderr.sha256 must be a string');
    } else if (
      typeof stderr.normalized === 'string' &&
      hashScenarioText(stderr.normalized) !== stderr.sha256
    ) {
      findings.push('stderr.sha256 does not match stderr.normalized');
    }
  }

  return findings;
}

export function compareScenarioRecordArtifact(record, execution) {
  const differences = [];

  if (record.scope !== execution.scope) {
    differences.push(`scope mismatch (${record.scope} != ${execution.scope})`);
  }
  if (record.command?.rendered !== execution.command.rendered) {
    differences.push(
      `command mismatch (${record.command?.rendered ?? 'missing'} != ${execution.command.rendered})`,
    );
  }
  if (record.status !== execution.status) {
    differences.push(`status mismatch (${record.status} != ${execution.status})`);
  }
  if ((record.packageName ?? null) !== (execution.packageName ?? null)) {
    differences.push(
      `packageName mismatch (${record.packageName ?? 'null'} != ${execution.packageName ?? 'null'})`,
    );
  }
  if (record.stdout?.sha256 !== execution.stdout.sha256) {
    differences.push(
      `stdout hash mismatch (${record.stdout?.sha256 ?? 'missing'} != ${execution.stdout.sha256})`,
    );
  }
  if (record.stderr?.sha256 !== execution.stderr.sha256) {
    differences.push(
      `stderr hash mismatch (${record.stderr?.sha256 ?? 'missing'} != ${execution.stderr.sha256})`,
    );
  }

  return differences;
}
