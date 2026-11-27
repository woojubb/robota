import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRoundtable, MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import type { RoundtableEvent } from '@robota-sdk/agent-roundtable';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acpParticipant } from './acp-participant';
import { AcpParticipantError } from './errors';
import { spawnAcpAgent } from './spawn-launcher';
import type { SpawnAcpAgentOptions } from './spawn-launcher';
import { executionOptions, turnOf } from './test-support';

// These tests start real child processes: a protocol-complete agent in `test-fixtures`, run with the
// absolute path of the current Node so the explicit environment needs no PATH. Waits are on events
// the fixture reports on standard error or on the process ending, never on a delay.

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(PACKAGE_ROOT, 'test-fixtures', 'stdio-agent.mjs');
const MARKER_NAME = 'ROUNDTABLE_FIXTURE_MARKER';
const PARENT_ONLY_NAME = 'ROUNDTABLE_PARENT_ONLY';
const posixOnly = it.skipIf(process.platform === 'win32');

/** Collects the agent's standard error lines and lets a test wait for the one it needs. */
function stderrWatcher() {
  const lines: string[] = [];
  const waiters: { prefix: string; resolve: (line: string) => void }[] = [];
  return {
    lines,
    onStderr(line: string): void {
      lines.push(line);
      for (const waiter of [...waiters]) {
        if (line.startsWith(waiter.prefix)) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve(line);
        }
      }
    },
    when(prefix: string): Promise<string> {
      const found = lines.find((line) => line.startsWith(prefix));
      return found !== undefined
        ? Promise.resolve(found)
        : new Promise<string>((resolve) => waiters.push({ prefix, resolve }));
    },
  };
}

const pidOf = (line: string): number => Number(line.split(':')[1]);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A process that lost its parent is reaped by the system a moment after it dies, so poll for it. */
const gone = (pid: number) =>
  vi.waitFor(() => expect(alive(pid), `pid ${pid} is still alive`).toBe(false), {
    timeout: 5_000,
    interval: 10,
  });

function launcherFor(args: string[], overrides: Partial<SpawnAcpAgentOptions> = {}) {
  return spawnAcpAgent({
    command: process.execPath,
    args: [FIXTURE, ...args],
    cwd: PACKAGE_ROOT,
    env: { [MARKER_NAME]: 'marker-value' },
    killGraceMs: 100,
    ...overrides,
  });
}

type ParticipantOverrides = Partial<Parameters<typeof acpParticipant>[0]>;

function participantFor(args: string[], overrides: ParticipantOverrides = {}) {
  const { launcher, ...rest } = overrides;
  return acpParticipant({
    id: 'acp',
    runtime: { id: 'fixture/stdio-agent', version: '1' },
    cwd: PACKAGE_ROOT,
    launcher: launcher ?? launcherFor(args),
    cancelGraceMs: 100,
    startupTimeoutMs: 20_000,
    ...rest,
  });
}

function openLease(args: string[], overrides: ParticipantOverrides = {}) {
  return participantFor(args, overrides).factory.openSession({
    conversationId: 'conversation-1',
    participantId: 'acp',
  });
}

const settled = (promise: Promise<unknown>): Promise<{ resolved?: unknown; rejected?: unknown }> =>
  promise.then(
    (resolved) => ({ resolved }),
    (rejected: unknown) => ({ rejected }),
  );

beforeEach(() => {
  vi.stubEnv(PARENT_ONLY_NAME, 'present-in-the-parent');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('a turn through a spawned agent', () => {
  it('takes a roundtable turn and ends the process with the session', async () => {
    const watcher = stderrWatcher();
    const acp = participantFor([], {
      launcher: launcherFor(['--reply', 'hello from the child'], { onStderr: watcher.onStderr }),
    });
    const published: string[] = [];
    const deltas: string[] = [];
    const onEvent = (event: RoundtableEvent) => {
      if (event.type === 'published')
        for (const item of event.messages) published.push(`${item.participantId}: ${item.content}`);
      if (event.type === 'delta') deltas.push(event.text);
    };
    const room = createRoundtable({
      conversationId: 'room',
      purpose: 'Say hello',
      participants: [acp],
      store: new MemoryConversationStore(),
      limits: { maxTurnsPerRun: 1 },
      onEvent,
    });
    await room.run();
    await room.dispose();

    expect(published).toEqual(['acp: hello from the child']);
    expect(deltas.join('')).toBe('hello from the child');
    // The roundtable released the session; its process is gone, not left running.
    await gone(pidOf(await watcher.when('pid:')));
  });

  it('gives the child exactly the environment it was given', async () => {
    const lease = await openLease(['--echo-env', MARKER_NAME], {
      launcher: launcherFor(['--echo-env', MARKER_NAME], {
        env: { [MARKER_NAME]: 'marker-value', EXTRA: 'one' },
      }),
    });
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();

    expect(outcome.kind).toBe('speak');
    const seen = JSON.parse((outcome as { content: string }).content) as {
      marker: string | null;
      names: string[];
    };
    expect(seen.marker).toBe('marker-value');
    expect(seen.names).not.toContain(PARENT_ONLY_NAME);
    if (process.platform !== 'win32') {
      expect(seen.names).not.toContain('PATH');
      // macOS adds one text-encoding variable to every process; nothing else may appear. Windows
      // adds its own system variables to every process, so only the absence above holds there.
      expect(seen.names.filter((name) => name !== '__CF_USER_TEXT_ENCODING')).toEqual(
        ['EXTRA', MARKER_NAME].sort(),
      );
    }
  });
});

describe('standard error', () => {
  it('is delivered one line at a time', async () => {
    const watcher = stderrWatcher();
    const lease = await openLease([], {
      launcher: launcherFor([], { onStderr: watcher.onStderr }),
    });
    await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();

    expect(watcher.lines).toEqual(expect.arrayContaining(['ready', 'prompt']));
    expect(watcher.lines.every((line) => !line.includes('\n'))).toBe(true);
  });

  it('is drained when a listener is given: a flood does not block the agent', async () => {
    const watcher = stderrWatcher();
    const lease = await openLease(['--stderr-flood', '3000000'], {
      launcher: launcherFor(['--stderr-flood', '3000000'], { onStderr: watcher.onStderr }),
    });
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();

    expect(outcome).toEqual({ kind: 'speak', content: 'fixture reply' });
    expect(watcher.lines.filter((line) => line.startsWith('xxx')).length).toBeGreaterThan(2_900);
  });

  it('is drained and discarded when no listener is given', async () => {
    const lease = await openLease(['--stderr-flood', '3000000']);
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();

    expect(outcome).toEqual({ kind: 'speak', content: 'fixture reply' });
  });

  it('survives a listener that throws', async () => {
    const lease = await openLease(['--stderr-flood', '1000000'], {
      launcher: launcherFor(['--stderr-flood', '1000000'], {
        onStderr: () => {
          throw new Error('listener failed');
        },
      }),
    });
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();

    expect(outcome.kind).toBe('speak');
  });
});

describe('closing the connection', () => {
  posixOnly('ends the agent and the process it started', async () => {
    const watcher = stderrWatcher();
    const lease = await openLease(['--grandchild'], {
      launcher: launcherFor(['--grandchild'], { onStderr: watcher.onStderr }),
    });
    const childPid = pidOf(await watcher.when('pid:'));
    const grandchildPid = pidOf(await watcher.when('grandchild:'));
    expect(alive(grandchildPid)).toBe(true);

    await lease.release();

    expect(alive(childPid)).toBe(false);
    await gone(grandchildPid);
  });

  it('is safe to repeat', async () => {
    const watcher = stderrWatcher();
    const launcher = launcherFor([], { onStderr: watcher.onStderr });
    const connection = await launcher.launch({
      conversationId: 'conversation-1',
      participantId: 'acp',
    });
    const pid = pidOf(await watcher.when('pid:'));
    await Promise.all([connection.close(), connection.close()]);
    await connection.close();

    await gone(pid);
  });

  posixOnly(
    'kills an agent that ignores the request to exit once the grace has passed',
    async () => {
      const watcher = stderrWatcher();
      const lease = await openLease(['--ignore-sigterm', '--hang'], {
        launcher: launcherFor(['--ignore-sigterm', '--hang'], { onStderr: watcher.onStderr }),
      });
      // Nothing but a process that never ends on its own keeps this agent alive past its input.
      const pid = pidOf(await watcher.when('pid:'));
      await lease.release();

      // Written when the request arrived, before the kill; it reaches us through the pipe.
      await watcher.when('sigterm');
      expect(alive(pid)).toBe(false);
    },
  );
});

describe('an agent that dies', () => {
  it('fails the running turn as a closed connection, and every later turn too', async () => {
    const watcher = stderrWatcher();
    const lease = await openLease(['--exit-mid-turn'], {
      launcher: launcherFor(['--exit-mid-turn'], { onStderr: watcher.onStderr }),
    });
    const first = await settled(lease.session.runTurn(turnOf(), executionOptions()));
    expect(first.rejected).toBeInstanceOf(AcpParticipantError);
    expect(first.rejected).toMatchObject({ code: 'connection-closed' });

    const later = await settled(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    );
    expect(later.rejected).toBeInstanceOf(AcpParticipantError);
    expect(later.rejected).toMatchObject({ code: 'connection-closed' });
    await lease.release();
  });
});

describe('an agent that cannot be started', () => {
  it('rejects launch with a typed error that names the command', async () => {
    const launcher = spawnAcpAgent({
      command: path.join(PACKAGE_ROOT, 'no-such-agent-program'),
      cwd: PACKAGE_ROOT,
      env: {},
    });
    const failure = await settled(
      launcher.launch({ conversationId: 'conversation-1', participantId: 'acp' }),
    );

    expect(failure.rejected).toBeInstanceOf(AcpParticipantError);
    expect(failure.rejected).toMatchObject({ code: 'launch-failed' });
    expect((failure.rejected as Error).message).toContain('no-such-agent-program');
  });

  it('fails the session open with launch-failed, well before the startup limit', async () => {
    const failure = await settled(
      openLease([], {
        launcher: spawnAcpAgent({
          command: path.join(PACKAGE_ROOT, 'no-such-agent-program'),
          cwd: PACKAGE_ROOT,
          env: {},
        }),
      }),
    );

    expect(failure.rejected).toMatchObject({ name: 'AcpParticipantError', code: 'launch-failed' });
  });

  it('reports a working directory that does not exist as a launch failure', async () => {
    const launcher = spawnAcpAgent({
      command: process.execPath,
      args: [FIXTURE],
      cwd: path.join(PACKAGE_ROOT, 'no-such-directory'),
      env: {},
    });
    const failure = await settled(
      launcher.launch({ conversationId: 'conversation-1', participantId: 'acp' }),
    );

    expect(failure.rejected).toMatchObject({ code: 'launch-failed' });
  });
});

describe('a host abort on a running turn', () => {
  posixOnly('ends the whole process tree after the cancel grace', async () => {
    const watcher = stderrWatcher();
    const lease = await openLease(['--hang', '--grandchild'], {
      launcher: launcherFor(['--hang', '--grandchild'], { onStderr: watcher.onStderr }),
      cancelGraceMs: 300,
    });
    const childPid = pidOf(await watcher.when('pid:'));
    const grandchildPid = pidOf(await watcher.when('grandchild:'));
    const controller = new AbortController();
    const reason = new Error('the host stopped this run');
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await watcher.when('prompt');
    controller.abort(reason);

    expect(await turn).toEqual({ rejected: reason });
    // The agent is asked to cancel and ignores it; with no further call from the host the grace
    // passes and the whole tree is killed.
    await watcher.when('cancel');
    await gone(childPid);
    await gone(grandchildPid);
    await lease.release();
  });
});

describe('options', () => {
  const base: SpawnAcpAgentOptions = { command: 'agent', cwd: '/work/space', env: {} };

  it('accepts the minimum', () => {
    expect(() => spawnAcpAgent(base)).not.toThrow();
  });

  it.each<[string, Partial<SpawnAcpAgentOptions>]>([
    ['an empty command', { command: '' }],
    ['a relative working directory', { cwd: 'work/space' }],
    ['a missing working directory', { cwd: undefined as unknown as string }],
    ['a zero grace', { killGraceMs: 0 }],
    ['a fractional grace', { killGraceMs: 1.5 }],
    ['a grace no timer can honor', { killGraceMs: 2_147_483_648 }],
    ['a missing environment', { env: undefined as unknown as Record<string, string> }],
    ['an environment with a non-string value', { env: { A: 1 as unknown as string } }],
    ['an environment with an undefined value', { env: { A: undefined as unknown as string } }],
    ['arguments that are not strings', { args: [1 as unknown as string] }],
  ])('refuses %s', (_name, overrides) => {
    let thrown: unknown;
    try {
      spawnAcpAgent({ ...base, ...overrides });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AcpParticipantError);
    expect(thrown).toMatchObject({ code: 'invalid-options' });
  });

  it('copies the environment, so a later change to the caller object does not reach the child', async () => {
    const env: Record<string, string> = { [MARKER_NAME]: 'before' };
    const launcher = spawnAcpAgent({
      command: process.execPath,
      args: [FIXTURE, '--echo-env', MARKER_NAME],
      cwd: PACKAGE_ROOT,
      env,
      killGraceMs: 100,
    });
    env[MARKER_NAME] = 'after';
    const lease = await participantFor([], { launcher }).factory.openSession({
      conversationId: 'conversation-1',
      participantId: 'acp',
    });
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();

    expect(JSON.parse((outcome as { content: string }).content)).toMatchObject({
      marker: 'before',
    });
  });
});
