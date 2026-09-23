#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(command, arguments_, cwd, env) {
  return spawnSync(command, arguments_, { cwd, env, encoding: 'utf8' });
}

function commandFailure(label, result) {
  return new Error(
    `${label} failed with status ${String(result.status)}.\nstdout:\n${result.stdout ?? ''}\nstderr:\n${result.stderr ?? ''}`,
  );
}

export function assertStandaloneNativeRuntime(binaryPath) {
  let directory = dirname(resolve(binaryPath));
  while (true) {
    if (existsSync(join(directory, 'node_modules'))) {
      throw new Error('Standalone native verification found a node_modules ancestor.');
    }
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

/** Use the same canonical Git root that the production trust resolver binds into its authority. */
export function resolveNativeFixtureWorkspace(cwd, env = process.env) {
  const result = run('git', ['rev-parse', '--show-toplevel'], cwd, env);
  if (result.status !== 0 || (result.stdout ?? '').trim().length === 0) {
    throw commandFailure('git workspace root resolution', result);
  }
  return realpathSync(result.stdout.trim());
}

export function runNativeFileAuthorityE2e(binaryPath, options = {}) {
  const binary = resolve(binaryPath);
  if (!existsSync(binary)) throw new Error(`The packaged Robota executable is missing: ${binary}`);
  if (options.node !== true) assertStandaloneNativeRuntime(binary);
  const command = options.node === true ? process.execPath : binary;
  const prefixArguments = options.node === true ? [binary] : [];

  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'robota-native-cli-')));
  const home = join(fixtureRoot, 'home');
  const workspaceDirectory = join(fixtureRoot, 'workspace');
  const outside = join(fixtureRoot, 'outside');
  const sessionId = 'session_1781000001000_native';
  const serializedPayload = JSON.stringify('native replay preserved');
  const sha256 = createHash('sha256').update(serializedPayload).digest('hex');
  const payloadName = `${sha256}.json`;
  const marker = 'outside-secret-marker';
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  let replaySucceeded = false;
  let replacementDenied = false;

  try {
    mkdirSync(home, { recursive: true });
    mkdirSync(workspaceDirectory, { recursive: true });
    const git = run('git', ['init', '--quiet'], workspaceDirectory, env);
    if (git.status !== 0) throw commandFailure('git init', git);
    const workspace = resolveNativeFixtureWorkspace(workspaceDirectory, env);
    const logs = join(workspace, '.robota', 'logs');
    const payloadDirectory = join(logs, `${sessionId}.payloads`);

    const trust = run(command, [...prefixArguments, 'trust', '--yes'], workspace, env);
    if (trust.status !== 0 || !/Workspace trust: trusted/u.test(trust.stdout ?? '')) {
      throw commandFailure('robota trust --yes', trust);
    }

    mkdirSync(payloadDirectory, { recursive: true });
    writeFileSync(join(payloadDirectory, payloadName), serializedPayload);
    const timestamp = '2026-09-21T00:00:00.000Z';
    const lines = [
      { timestamp, sessionId, event: 'session_init', cwd: workspace },
      {
        timestamp,
        sessionId,
        event: 'history_mutation',
        mutation: 'append_message',
        message: {
          id: 'user-1',
          role: 'user',
          state: 'complete',
          content: 'analyze fixture',
          timestamp,
        },
      },
      {
        timestamp: '2026-09-21T00:00:01.000Z',
        sessionId,
        event: 'history_mutation',
        mutation: 'append_message',
        message: {
          id: 'assistant-1',
          role: 'assistant',
          state: 'complete',
          content: {
            kind: 'external-payload',
            encoding: 'json',
            sha256,
            byteLength: Buffer.byteLength(serializedPayload),
            relativePath: `${sessionId}.payloads/${payloadName}`,
          },
          timestamp: '2026-09-21T00:00:01.000Z',
        },
      },
    ];
    writeFileSync(
      join(logs, `${sessionId}.jsonl`),
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );

    const analyze = run(
      command,
      [...prefixArguments, 'session', 'analyze', '--session', sessionId],
      workspace,
      env,
    );
    if (analyze.status !== 0 || !(analyze.stdout ?? '').includes(sessionId)) {
      throw commandFailure('robota session analyze', analyze);
    }
    replaySucceeded = true;

    rmSync(payloadDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    mkdirSync(outside);
    writeFileSync(join(outside, payloadName), JSON.stringify(marker));
    symlinkSync(outside, payloadDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    const refused = run(
      command,
      [...prefixArguments, 'session', 'analyze', '--session', sessionId],
      workspace,
      env,
    );
    const refusalOutput = `${refused.stdout ?? ''}\n${refused.stderr ?? ''}`;
    replacementDenied =
      refused.status !== 0 &&
      /link|unsafe|authority/iu.test(refusalOutput) &&
      !refusalOutput.includes(marker) &&
      !refusalOutput.includes(outside);
    if (!replacementDenied)
      throw commandFailure('replaced-parent session analyze refusal', refused);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }

  const cleanupRemoved = !existsSync(fixtureRoot);
  if (!cleanupRemoved) throw new Error('The packaged native replay fixture was not removed.');
  return `native-file-authority=passed; success=${replaySucceeded}; replacementDenied=${replacementDenied}; cleanupRemoved=${cleanupRemoved}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const nodeMode = process.argv[2] === '--node';
    const binaryPath = process.argv[nodeMode ? 3 : 2];
    if (!binaryPath) {
      throw new Error('Usage: e2e-native-file-authority.mjs [--node] <robota-executable>');
    }
    process.stdout.write(`${runNativeFileAuthorityE2e(binaryPath, { node: nodeMode })}\n`);
  } catch (error) {
    process.stderr.write(
      `native-file-authority e2e: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
