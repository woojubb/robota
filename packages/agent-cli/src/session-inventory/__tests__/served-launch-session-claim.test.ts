/**
 * Several served runtimes in one workspace, each started by the real CLI composition in a process of
 * its own. A runtime's launch used to reuse the workspace's empty saved session even when another
 * live runtime held that session's writer claim, so the next background session or daemon was
 * refused with a claim message about a session nobody had opened. Now a claimed session is skipped
 * and a fresh one starts, while the claim stays the only fence: no two processes write one session.
 */
import type { ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import { createNodeHostSessionStore } from '@robota-sdk/agent-framework/node';
import { stopSupervisedSession } from '@robota-sdk/agent-local-host';
import { createProcessOperationLock } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import {
  listSupervisedSessions,
  renameSupervisedSession,
  resolveSupervisedDirectory,
} from '../supervised-session-control.js';
import { launchSupervisedSession } from '../supervised-session-launch.js';

const fixture = fileURLToPath(
  new URL('./fixtures/served-real-composition-fixture.ts', import.meta.url),
);
const tsxLoader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

const scratchRoots: string[] = [];
const runtimes: { readonly id: string; readonly root: string }[] = [];
const spawned: ChildProcess[] = [];

afterEach(async () => {
  for (const { id, root } of runtimes.splice(0)) {
    try {
      await stopSupervisedSession(id, root);
    } catch {
      // Already stopped or killed by the test itself.
    }
  }
  for (const child of spawned.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  for (const scratch of scratchRoots.splice(0)) rmSync(scratch, { recursive: true, force: true });
});

/** A trusted workspace with its own disposable state; every runtime of one test shares it. */
function createWorkspace() {
  // Short paths: a runtime's control socket lives under the state root, and a local socket path is bounded.
  const scratch = mkdtempSync(join(tmpdir(), 'sl-'));
  scratchRoots.push(scratch);
  const home = join(scratch, 'h');
  const project = join(scratch, 'p');
  const stateRoot = join(scratch, 's');
  mkdirSync(join(project, '.test-product'), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(project, '.test-product', 'settings.json'),
    JSON.stringify({
      currentProvider: 'scripted',
      providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
    }),
  );
  const productRuntime = createTestProductRuntime('test-product', {
    HOME: home,
    PRODUCT_USER_STATE_DIR: stateRoot,
    PRODUCT_CACHE_DIR: join(stateRoot, 'cache'),
    PRODUCT_LOG_DIR: join(stateRoot, 'logs'),
  });
  const root = resolveSupervisedDirectory(productRuntime);
  // The trusted project store holds the sessions on Linux; the user store everywhere else.
  const sessionsDirectory =
    process.platform === 'linux'
      ? join(project, '.test-product', 'sessions')
      : join(stateRoot, 'sessions');

  /** Starts one runtime through the real composition, as `session start --background` does. */
  async function launch(): Promise<{ readonly id: string; readonly child: ChildProcess }> {
    let child: ChildProcess | undefined;
    const id = await launchSupervisedSession(project, {
      productRuntime,
      entrypoint: fixture,
      execArgs: ['--import', tsxLoader, '--conditions=product-source'],
      env: {
        ...(process.env['PATH'] === undefined ? {} : { PATH: process.env['PATH'] }),
        ...(process.env['TMPDIR'] === undefined ? {} : { TMPDIR: process.env['TMPDIR'] }),
        HOME: home,
        PRODUCT_TEST_HOME: home,
        PRODUCT_TEST_STATE_ROOT: stateRoot,
      },
      onSpawn: (started) => {
        child = started;
        spawned.push(started);
      },
    });
    runtimes.push({ id, root });
    if (child === undefined) throw new Error('the launcher did not report the process it started');
    return { id, child };
  }

  /** The saved session ids, and the pid of the process holding each one's writer claim. */
  function claimHolders(): Record<string, number | undefined> {
    const claims = join(sessionsDirectory, 'claims');
    const markers = createProcessMarkers(claims, {
      operationLock: createProcessOperationLock(claims),
    });
    const ids = existsSync(sessionsDirectory)
      ? readdirSync(sessionsDirectory)
          .filter((file) => file.endsWith('.json'))
          .map((file) => file.slice(0, -'.json'.length))
      : [];
    return Object.fromEntries(
      ids.map((id) => {
        const standing = markers.inspect(id);
        return [id, standing.status === 'held' ? standing.holder.owner?.pid : undefined];
      }),
    );
  }

  /** The pid a runtime registered, which is the process that holds its session's claim. */
  const pidOf = (id: string): number =>
    (JSON.parse(readFileSync(join(root, id, 'state.json'), 'utf8')) as { pid: number }).pid;

  const savedName = (sessionId: string): string | undefined => {
    const outcome = createNodeHostSessionStore(sessionsDirectory, { sealing: 'plain' }).load(
      sessionId,
    );
    return outcome.status === 'valid' ? outcome.record.name : undefined;
  };

  return { root, sessionsDirectory, launch, claimHolders, pidOf, savedName };
}

describe('served runtimes in one workspace, started by the real composition', () => {
  it('runs a second runtime beside a live one, each on its own saved session and writing only that one', async () => {
    const workspace = createWorkspace();

    const first = await workspace.launch();
    const second = await workspace.launch();

    expect(await listSupervisedSessions(workspace.root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first.id, liveness: 'alive', control: 'available' }),
        expect.objectContaining({ id: second.id, liveness: 'alive', control: 'available' }),
      ]),
    );
    const holders = workspace.claimHolders();
    const [firstSession, secondSession] = [first, second].map((runtime) =>
      Object.keys(holders).find((sessionId) => holders[sessionId] === workspace.pidOf(runtime.id)),
    );
    expect(Object.keys(holders)).toHaveLength(2);
    expect(firstSession).toBeDefined();
    expect(secondSession).toBeDefined();
    expect(firstSession).not.toBe(secondSession);

    // Each runtime writes its own record: a name given to one lands on its session and not the other's.
    await renameSupervisedSession(first.id, 'first runtime', workspace.root);
    await renameSupervisedSession(second.id, 'second runtime', workspace.root);
    await vi.waitFor(
      () => {
        expect(workspace.savedName(firstSession!)).toBe('first runtime');
        expect(workspace.savedName(secondSession!)).toBe('second runtime');
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(Object.keys(workspace.claimHolders())).toHaveLength(2);
  }, 90_000);

  it('runs a third runtime beside two live ones', async () => {
    const workspace = createWorkspace();

    const launched = [await workspace.launch(), await workspace.launch(), await workspace.launch()];

    const holders = Object.values(workspace.claimHolders());
    expect(holders.sort()).toEqual(launched.map((runtime) => workspace.pidOf(runtime.id)).sort());
  }, 120_000);

  it('still reuses the empty session of a runtime that is gone, taking its claim over', async () => {
    const workspace = createWorkspace();
    const first = await workspace.launch();
    const [session] = Object.keys(workspace.claimHolders());
    const exited = new Promise<void>((resolve) => first.child.once('exit', () => resolve()));
    first.child.kill('SIGKILL');
    await exited;

    // The killed runtime never released its claim; its owner is provably gone, so the claim is broken.
    const second = await workspace.launch();

    expect(Object.keys(workspace.claimHolders())).toEqual([session]);
    expect(workspace.claimHolders()[session!]).toBe(workspace.pidOf(second.id));
  }, 90_000);
});
