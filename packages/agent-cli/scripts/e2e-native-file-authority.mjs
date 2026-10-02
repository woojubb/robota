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
import { fixtureProcessEnvironment } from './product-fixture-environment.mjs';

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
export function resolveNativeFixtureWorkspace(cwd, env) {
  const result = run('git', ['rev-parse', '--show-toplevel'], cwd, env);
  if (result.status !== 0 || (result.stdout ?? '').trim().length === 0) {
    throw commandFailure('git workspace root resolution', result);
  }
  return realpathSync(result.stdout.trim());
}

/**
 * Whether this host can prove a project-relative write stays under the trusted workspace root
 * (ARCH-047). The proof walks descriptor-relative paths through `/proc/self/fd`, which only Linux
 * provides — see `supportsWorkspaceProjectMutation` in
 * `packages/agent-framework/src/workspace-trust/project-relative-writer.ts`, the CLI-internal
 * function this mirrors. Everywhere else, `trustedSessionStore`
 * (`packages/agent-cli/src/startup/workspace-project-composition.ts`) falls a trusted workspace's
 * sessions back to the user store instead, and the replay-log "native file authority" this fixture
 * exercises never runs — there is no project-relative session write to protect. The two scenarios
 * below assert whichever contract the current host actually promises, matching the same platform
 * gate the product itself uses, rather than assuming the Linux-only contract everywhere.
 */
function supportsProjectFileAuthority(platform = process.platform) {
  return platform === 'linux';
}

/**
 * Linux scenario: a session's replay log and its externalized payload live under the trusted
 * project (`<workspace>/<product project directory>/logs`). `session analyze` must replay it, and must refuse to follow
 * the payload directory when it has been swapped for a symlink into an untrusted parent.
 */
function runProjectFileAuthorityScenario(
  command,
  prefixArguments,
  fixtureRoot,
  workspace,
  env,
  sessionId,
) {
  const serializedPayload = JSON.stringify('native replay preserved');
  const sha256 = createHash('sha256').update(serializedPayload).digest('hex');
  const payloadName = `${sha256}.json`;
  const marker = 'outside-secret-marker';
  const logs = join(workspace, env.PRODUCT_PROJECT_STATE_DIR, 'logs');
  const payloadDirectory = join(logs, `${sessionId}.payloads`);

  mkdirSync(payloadDirectory, { recursive: true });
  writeFileSync(join(payloadDirectory, payloadName), serializedPayload);
  const timestamp = '2026-09-21T00:00:00.000Z';
  // Current versioned session-log format: every line carries schemaVersion, and session_init
  // records the full provider/prompt/tool context the replay decoder requires.
  const lines = [
    {
      schemaVersion: 1,
      timestamp,
      sessionId,
      event: 'session_init',
      cwd: workspace,
      systemPromptLength: 0,
      systemPrompt: '',
      toolSchemas: [],
      model: 'fixture-model',
      provider: 'fixture',
    },
    {
      schemaVersion: 1,
      timestamp,
      sessionId,
      event: 'history_mutation',
      mutation: 'append_message',
      index: 0,
      message: {
        id: 'user-1',
        role: 'user',
        state: 'complete',
        content: 'analyze fixture',
        timestamp,
      },
    },
    {
      schemaVersion: 1,
      timestamp: '2026-09-21T00:00:01.000Z',
      sessionId,
      event: 'history_mutation',
      mutation: 'append_message',
      index: 1,
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
    throw commandFailure(`${env.PRODUCT_CLI_NAME} session analyze`, analyze);
  }
  const replaySucceeded = true;

  rmSync(payloadDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  const outside = join(fixtureRoot, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, payloadName), JSON.stringify(marker));
  // This scenario only runs where `supportsProjectFileAuthority()` is true, i.e. Linux — a plain
  // directory symlink, not the Windows junction form `process.platform` would otherwise pick.
  symlinkSync(outside, payloadDirectory, 'dir');

  const refused = run(
    command,
    [...prefixArguments, 'session', 'analyze', '--session', sessionId],
    workspace,
    env,
  );
  const refusalOutput = `${refused.stdout ?? ''}\n${refused.stderr ?? ''}`;
  const replacementDenied =
    refused.status !== 0 &&
    /link|unsafe|authority/iu.test(refusalOutput) &&
    !refusalOutput.includes(marker) &&
    !refusalOutput.includes(outside);
  if (!replacementDenied) throw commandFailure('replaced-parent session analyze refusal', refused);

  return { replaySucceeded, replacementDenied };
}

/**
 * Non-Linux scenario: a trusted workspace's sessions are served from the user store
 * (under the configured user session root), never from the project — there is no project-relative write for
 * `session analyze` to protect, so the meaningful assertion is that the CLI still serves a session
 * through the store it actually uses here, and that it never fell through to writing (or reading)
 * anything project-relative in the configured project state directory while doing it.
 */
function runUserSessionStoreScenario(command, prefixArguments, home, workspace, env, sessionId) {
  const timestamp = '2026-09-21T00:00:00.000Z';
  const record = {
    id: sessionId,
    cwd: workspace,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [
      {
        id: 'user-1',
        role: 'user',
        state: 'complete',
        content: 'analyze fixture',
        timestamp,
      },
    ],
  };
  const sessionsDirectory = join(env.PRODUCT_USER_STATE_DIR, 'sessions');
  mkdirSync(sessionsDirectory, { recursive: true });
  // Same versioned envelope `NodeSessionStore.save` writes (session-record-codec's
  // SESSION_RECORD_ENVELOPE_VERSION); written directly here so the fixture proves the CLI's own
  // *read* path, the same way the Linux scenario writes its replay log directly.
  writeFileSync(
    join(sessionsDirectory, `${sessionId}.json`),
    JSON.stringify({ schemaVersion: 1, record }, null, 2),
  );

  const analyze = run(
    command,
    [...prefixArguments, 'session', 'analyze', '--session', sessionId],
    workspace,
    env,
  );
  if (analyze.status !== 0 || !(analyze.stdout ?? '').includes(sessionId)) {
    throw commandFailure(`${env.PRODUCT_CLI_NAME} session analyze`, analyze);
  }

  const projectStateWritten = existsSync(join(workspace, env.PRODUCT_PROJECT_STATE_DIR));
  if (projectStateWritten) {
    throw new Error(
      'A trusted workspace wrote project-relative state on a host without project file authority.',
    );
  }

  return { replaySucceeded: true, projectStateWritten };
}

export function runNativeFileAuthorityE2e(binaryPath, options = {}) {
  const binary = resolve(binaryPath);
  if (!existsSync(binary)) throw new Error(`The packaged agent executable is missing: ${binary}`);
  if (options.node !== true) assertStandaloneNativeRuntime(binary);
  const command = options.node === true ? process.execPath : binary;
  const prefixArguments = options.node === true ? [binary] : [];

  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'agent-native-cli-')));
  const home = join(fixtureRoot, 'home');
  const workspaceDirectory = join(fixtureRoot, 'workspace');
  const sessionId = 'session_1781000001000_native';
  const env = fixtureProcessEnvironment(home);
  const projectAuthority = supportsProjectFileAuthority();
  let scenario;

  try {
    mkdirSync(home, { recursive: true });
    mkdirSync(workspaceDirectory, { recursive: true });
    const git = run('git', ['init', '--quiet'], workspaceDirectory, env);
    if (git.status !== 0) throw commandFailure('git init', git);
    const workspace = resolveNativeFixtureWorkspace(workspaceDirectory, env);

    const trust = run(command, [...prefixArguments, 'trust', '--yes'], workspace, env);
    if (trust.status !== 0 || !/Workspace trust: trusted/u.test(trust.stdout ?? '')) {
      throw commandFailure(`${env.PRODUCT_CLI_NAME} trust --yes`, trust);
    }

    scenario = projectAuthority
      ? runProjectFileAuthorityScenario(
          command,
          prefixArguments,
          fixtureRoot,
          workspace,
          env,
          sessionId,
        )
      : runUserSessionStoreScenario(command, prefixArguments, home, workspace, env, sessionId);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }

  const cleanupRemoved = !existsSync(fixtureRoot);
  if (!cleanupRemoved) throw new Error('The packaged native replay fixture was not removed.');
  const detail = projectAuthority
    ? `replacementDenied=${scenario.replacementDenied}`
    : `projectStateWritten=${scenario.projectStateWritten}`;
  return (
    `native-file-authority=passed; scenario=${projectAuthority ? 'project' : 'user-store'}; ` +
    `success=${scenario.replaySucceeded}; ${detail}; cleanupRemoved=${cleanupRemoved}`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const nodeMode = process.argv[2] === '--node';
    const binaryPath = process.argv[nodeMode ? 3 : 2];
    if (!binaryPath) {
      throw new Error('Usage: e2e-native-file-authority.mjs [--node] <agent-executable>');
    }
    process.stdout.write(`${runNativeFileAuthorityE2e(binaryPath, { node: nodeMode })}\n`);
  } catch (error) {
    process.stderr.write(
      `native-file-authority e2e: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
