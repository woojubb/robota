/**
 * `the CLI session attach command` end to end on the BUILT binary, in a real terminal: start a supervised
 * session, attach and confirm on the controlling terminal, submit, detach with `/exit`, see it still
 * running, attach again read-only and find the earlier prompt, detach with Ctrl-C, peek from
 * `session view` and land back in the view, then stop it.
 *
 * The provider points at a closed local port, so the submitted turn fails without any network call
 * leaving this machine. `XDG_RUNTIME_DIR` is a short directory so the control socket path fits.
 *
 * Runs under `test:pty` against the built CLI (`pnpm --filter @robota-sdk/agent-cli build` first).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createIsolatedHome, createPtyEnv } from './isolated-home.js';
import { spawnPty } from './spawn-pty.js';

import type { IPtyRunSession } from './spawn-pty.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const AGENT_BIN = join(REPO_ROOT, 'packages/agent-cli/bin/agent.cjs');
const WAIT_MS = 20_000;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function agent(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [AGENT_BIN, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: WAIT_MS,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function attach(id: string, cwd: string, env: NodeJS.ProcessEnv, observe = false): IPtyRunSession {
  const session = spawnPty({
    command: process.execPath,
    args: [AGENT_BIN, 'session', 'attach', id, ...(observe ? ['--observe'] : [])],
    cwd,
    env,
  });
  cleanups.push(() => session.dispose());
  return session;
}

describe('the CLI session attach command on the built binary', () => {
  it('attaches, submits, detaches without stopping the session, and re-attaches', async () => {
    const project = realpathSync(mkdtempSync(join(tmpdir(), 'agent-attach-pty-')));
    // `/tmp` rather than the platform temp directory: the control socket path must stay short.
    const runtime = mkdtempSync('/tmp/rsa-');
    cleanups.push(() => rmSync(project, { recursive: true, force: true }));
    cleanups.push(() => rmSync(runtime, { recursive: true, force: true }));
    const home = createIsolatedHome();
    const stateRoot = join(runtime, 's');
    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, 'onboarded'), new Date().toISOString(), 'utf8');
    writeFileSync(
      join(stateRoot, 'settings.json'),
      JSON.stringify({
        currentProvider: 'anthropic',
        providers: {
          anthropic: {
            type: 'anthropic',
            model: 'claude-test-model',
            apiKey: 'pty-dummy-key',
            baseURL: 'http://127.0.0.1:9',
          },
        },
      }),
      'utf8',
    );
    const env = createPtyEnv({
      HOME: home,
      XDG_RUNTIME_DIR: runtime,
      PRODUCT_USER_STATE_DIR: stateRoot,
      PRODUCT_CACHE_DIR: join(runtime, 'c'),
      PRODUCT_LOG_DIR: join(runtime, 'l'),
    });

    // Workspace trust is recorded for a repository, as a user would grant it before a background start.
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: project, env, stdio: ['ignore', 'ignore', 'pipe'] });
    };
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Attach Fixture');
    git('config', 'user.email', 'attach@example.invalid');
    writeFileSync(join(project, 'README.md'), 'fixture\n');
    git('add', '--', 'README.md');
    git('commit', '-q', '-m', 'chore: fixture');
    const trusted = agent(['trust', '--yes'], project, env);
    expect(trusted.status, trusted.stderr).toBe(0);
    const started = agent(
      ['session', 'start', '--background', '--name', 'pty-attach'],
      project,
      env,
    );
    expect(started.status, started.stderr).toBe(0);
    const id = /Supervised session: ([0-9a-f-]{36})/u.exec(started.stdout)?.[1];
    expect(id).toBeDefined();
    cleanups.push(() => {
      agent(['session', 'stop', id!], project, env);
    });

    const drive = attach(id!, project, env);
    await drive.waitFor('Attach? Type yes', WAIT_MS);
    expect(drive.snapshot()).toContain('drive (send prompts, answer its questions)');
    await drive.sendKeys('yes');
    await drive.pressEnter();
    await drive.waitFor('Type a message or /help', WAIT_MS);
    await drive.sendKeys('hello from the pty');
    await drive.pressEnter();
    await drive.waitFor('Last turn failed', WAIT_MS);
    await drive.sendKeys('/exit');
    await drive.pressEnter();
    expect(await drive.expectExit(WAIT_MS)).toBe(0);

    const listed = agent(['session', 'list', '--format', 'json'], project, env);
    const supervised = (
      JSON.parse(listed.stdout) as {
        supervised: { sessions: { id: string; liveness: string; control: string }[] };
      }
    ).supervised.sessions;
    expect(supervised).toContainEqual(
      expect.objectContaining({ id, liveness: 'alive', control: 'available' }),
    );

    const observe = attach(id!, project, env, true);
    await observe.waitFor('Attach? Type yes', WAIT_MS);
    expect(observe.snapshot()).toContain('observe (read only)');
    await observe.sendKeys('yes');
    await observe.pressEnter();
    await observe.waitFor('Observing — read only', WAIT_MS);
    await observe.waitFor('hello from the pty', WAIT_MS);
    observe.write('\x03');
    expect(await observe.expectExit(WAIT_MS)).toBe(0);
    const afterObserve = agent(['session', 'list', '--format', 'json'], project, env);
    const remaining = (
      JSON.parse(afterObserve.stdout) as {
        supervised: { sessions: { id: string; liveness: string; control: string }[] };
      }
    ).supervised.sessions;
    expect(remaining).toContainEqual(
      expect.objectContaining({ id, liveness: 'alive', control: 'available' }),
    );

    // From the session view: peek at the row, confirm there, detach, and land back in the view.
    const view = spawnPty({
      command: process.execPath,
      args: [AGENT_BIN, 'session', 'view'],
      cwd: project,
      env,
    });
    cleanups.push(() => view.dispose());
    await view.waitFor('a Attach  p Peek', WAIT_MS);
    view.write('p');
    await view.waitFor('to observe (read only)?', WAIT_MS);
    view.write('y');
    await view.waitFor('Observing — read only', WAIT_MS);
    await view.waitFor('hello from the pty', WAIT_MS);
    const beforeDetach = view.outputOffset();
    view.write('\x1d');
    await view.waitForSince(beforeDetach, 'Background sessions across projects', WAIT_MS);
    view.write('q');
    expect(await view.expectExit(WAIT_MS)).toBe(0);

    expect(agent(['session', 'stop', id!], project, env).status).toBe(0);
  }, 120_000);
});
