/**
 * Children in their own session (decided design change 4 of #3679).
 *
 * Off — every product process today — the policy hands each caller back exactly what it passed, so
 * plain spawning is unchanged. On, a child leads its own session and process group, cannot inherit
 * this process's terminal, and its group ends with this process however the process ends.
 *
 * The ending cases run real child processes, because Node's exit sequence and a signal's default
 * action are what is under test.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Passed through, so every test runs the real call; the plain-mode test reads what `execFile` was given.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn(actual.execFile) };
});

import {
  enableOwnChildSessions,
  endWithProcess,
  execFileInChildSession,
  signalChildGroup,
  withChildSession,
} from '../node.js';
import { resetChildSessionsForTesting } from '../testing/index.js';

import type { ChildProcess, ExecFileException } from 'node:child_process';

const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const nodeSurface = pathToFileURL(fileURLToPath(new URL('../node.ts', import.meta.url))).href;
const CHILD_TIMEOUT_MS = 30_000;
const POSIX = process.platform !== 'win32';

const strays = new Set<number>();

afterEach(() => {
  resetChildSessionsForTesting();
  for (const pid of strays) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone, which is what the test wanted
    }
  }
  strays.clear();
});

function processGroupOf(pid: number): number {
  return Number(
    execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim(),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function goneWithin(pids: readonly number[], ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !alive(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return pids.every((pid) => !alive(pid));
}

function output(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    child.stdout?.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', () => resolve(text));
  });
}

/** A shell whose group holds a grandchild; resolves with the leader's and the grandchild's pids. */
function groupWithGrandchild(): Promise<{
  child: ChildProcess;
  leader: number;
  grandchild: number;
}> {
  const child = endWithProcess(
    spawn(
      '/bin/sh',
      ['-c', 'sleep 60 & echo $!; wait'],
      withChildSession({ stdio: ['ignore', 'pipe', 'ignore'] }),
    ),
  );
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout?.once('data', (chunk: Buffer) => {
      const grandchild = Number(chunk.toString('utf8').trim());
      strays.add(child.pid!);
      strays.add(grandchild);
      resolve({ child, leader: child.pid!, grandchild });
    });
  });
}

describe('while off (plain mode)', () => {
  it('hands every caller back the very options it passed', () => {
    const options = { cwd: '/', stdio: 'inherit' as const };

    expect(withChildSession(options)).toBe(options);
  });

  it('tracks nothing, so no listener is added to the process', () => {
    const exitListeners = process.listenerCount('exit');
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });

    expect(endWithProcess(child)).toBe(child);
    expect(process.listenerCount('exit')).toBe(exitListeners);
  });

  it('signals the direct child only, as callers did before', () => {
    const kill = vi.fn(() => true);
    const processKill = vi.spyOn(process, 'kill');

    signalChildGroup({ pid: 4242, kill } as unknown as ChildProcess, 'SIGTERM');

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(processKill).not.toHaveBeenCalled();
    processKill.mockRestore();
  });

  it.skipIf(!POSIX)('leaves the child in this process group', async () => {
    const child = spawn(
      '/bin/sh',
      ['-c', 'ps -o pgid= -p $$'],
      withChildSession({ stdio: ['ignore', 'pipe', 'ignore'] }),
    );

    expect(Number((await output(child)).trim())).toBe(processGroupOf(process.pid));
  });

  it('runs execFile itself, with the very options it was given', async () => {
    const options = { timeout: 5000 };
    const result = await new Promise<{ error: ExecFileException | null; stdout: string }>(
      (resolve) => {
        execFileInChildSession(
          process.execPath,
          ['-e', 'process.stdout.write("ok")'],
          options,
          (error, stdout) => resolve({ error, stdout }),
        );
      },
    );

    expect(result).toEqual({ error: null, stdout: 'ok' });
    expect(vi.mocked(execFile)).toHaveBeenLastCalledWith(
      process.execPath,
      ['-e', 'process.stdout.write("ok")'],
      options,
      expect.any(Function),
    );
    expect(vi.mocked(execFile).mock.lastCall?.[2]).toBe(options);
  });
});

describe('on Windows', () => {
  it('stays off: a Windows console has no session to leave, and detaching would open a new one', () => {
    enableOwnChildSessions({ platform: 'win32' });
    const options = { stdio: 'inherit' as const };

    expect(withChildSession(options)).toBe(options);
  });
});

describe.skipIf(!POSIX)('while on (secure mode)', () => {
  it('makes each child the leader of its own process group and session', async () => {
    enableOwnChildSessions();
    const child = spawn(
      '/bin/sh',
      ['-c', 'ps -o pgid= -p $$'],
      withChildSession({ stdio: ['ignore', 'pipe', 'ignore'] }),
    );

    expect(Number((await output(child)).trim())).toBe(child.pid);
  });

  it('refuses a child that would inherit a terminal descriptor of this process', () => {
    enableOwnChildSessions();

    expect(() => withChildSession({ stdio: 'inherit' })).toThrow(/terminal handover/);
    expect(() => withChildSession({ stdio: ['pipe', 'inherit', 'pipe'] })).toThrow(
      /terminal handover/,
    );
    expect(() => withChildSession({ stdio: ['pipe', 'pipe', 2] })).toThrow(/terminal handover/);
    expect(() => withChildSession({ stdio: [process.stdin, 'pipe', 'pipe'] })).toThrow(
      /terminal handover/,
    );
  });

  // Node's own defaults already hand a child no descriptor of this process's terminal (a sync spawn
  // pipes stderr and copies it afterwards), so only an explicit inheritance needs refusing.
  it('leaves the stdio a caller chose, or left to the default, as it was', () => {
    enableOwnChildSessions();

    expect(withChildSession({ encoding: 'utf8' })).toEqual({ encoding: 'utf8', detached: true });
    expect(withChildSession({ stdio: ['ignore', 'pipe', 'ignore'] })).toEqual({
      stdio: ['ignore', 'pipe', 'ignore'],
      detached: true,
    });
  });

  it('gives a sync spawn its own group too', () => {
    enableOwnChildSessions();
    const result = execFileSync(
      '/bin/sh',
      ['-c', 'echo $$ $(ps -o pgid= -p $$)'],
      withChildSession({ encoding: 'utf8' }),
    );
    const [pid, group] = result.trim().split(/\s+/u).map(Number);

    expect(group).toBe(pid);
  });

  it('signals the whole group of a tracked child', async () => {
    enableOwnChildSessions();
    const { child, leader, grandchild } = await groupWithGrandchild();

    signalChildGroup(child, 'SIGTERM');

    expect(await goneWithin([leader, grandchild], 3000)).toBe(true);
  });
});

/** Run execFile's contract through the off path (execFile) and the on path, and keep what callers read. */
function runBoth(
  file: string,
  args: readonly string[],
  options: Parameters<typeof execFileInChildSession>[2],
  abortAfterMs?: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const child = execFileInChildSession(
      file,
      args,
      abortAfterMs === undefined ? options : { ...options, signal: controller.signal },
      (error, stdout, stderr) =>
        resolve({
          stdout,
          stderr,
          stdoutLength: stdout.length,
          code: error?.code ?? null,
          killed: error?.killed ?? null,
          // The returned child's own flag, which a signal sent through `child.kill` sets.
          childKilled: child.killed,
          signal: error?.signal ?? null,
          name: error?.name ?? null,
        }),
    );
    if (abortAfterMs !== undefined) setTimeout(() => controller.abort(), abortAfterMs);
    void child;
  });
}

describe.skipIf(!POSIX)('execFile in a child session', () => {
  const cases: Array<{
    name: string;
    file: string;
    args: string[];
    options: Parameters<typeof execFileInChildSession>[2];
    abortAfterMs?: number;
    pick: string[];
  }> = [
    {
      name: 'success',
      file: '/bin/sh',
      args: ['-c', 'printf out; printf err >&2'],
      options: {},
      pick: ['stdout', 'stderr', 'code', 'killed', 'signal'],
    },
    {
      name: 'a non-zero exit',
      file: '/bin/sh',
      args: ['-c', 'printf out; printf err >&2; exit 3'],
      options: { encoding: 'utf8' },
      pick: ['stdout', 'stderr', 'code', 'killed', 'signal'],
    },
    {
      name: 'a timeout',
      file: '/bin/sh',
      args: ['-c', 'sleep 5'],
      options: { timeout: 200 },
      pick: ['code', 'killed', 'signal', 'childKilled'],
    },
    {
      // `execFile` keeps what fits under `maxBuffer` and drops the rest.
      name: 'too much output',
      file: '/bin/sh',
      args: ['-c', 'head -c 5000 /dev/zero | tr "\\0" x'],
      options: { maxBuffer: 100 },
      pick: ['code', 'stdoutLength', 'childKilled'],
    },
    {
      name: 'a missing program',
      file: '/nonexistent/program',
      args: [],
      options: {},
      pick: ['code'],
    },
    {
      name: 'an abort',
      file: '/bin/sh',
      args: ['-c', 'sleep 5'],
      options: {},
      abortAfterMs: 200,
      pick: ['name', 'childKilled'],
    },
  ];

  for (const testCase of cases) {
    it(`reports ${testCase.name} as execFile does`, async () => {
      const plain = await runBoth(
        testCase.file,
        testCase.args,
        testCase.options,
        testCase.abortAfterMs,
      );
      enableOwnChildSessions();
      const own = await runBoth(
        testCase.file,
        testCase.args,
        testCase.options,
        testCase.abortAfterMs,
      );
      const picked = (result: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(testCase.pick.map((key) => [key, result[key]]));

      expect(picked(own)).toEqual(picked(plain));
    });
  }

  // The program has already exited and a descendant still holds its output. On a timeout or an
  // overflow `execFile` lets go of the pipes, so it settles at once rather than when the descendant
  // ends. An abort it ignores once the program has exited, waiting for the output to close. A child
  // session does the same, signalling nothing: the group id of an exited leader may be another
  // process's, so a descendant that outlives its leader is left alone, as `execFile` leaves it.
  const leftBehind: Array<{
    name: string;
    args: string[];
    options: Parameters<typeof execFileInChildSession>[2];
    abortAfterMs?: number;
    waitsForDescendant?: boolean;
  }> = [
    { name: 'a timeout', args: ['-c', 'sleep 3 & echo $!'], options: { timeout: 500 } },
    {
      name: 'too much output',
      args: ['-c', '(sleep 0.3; head -c 5000 /dev/zero; sleep 3) & exit 0'],
      options: { maxBuffer: 100 },
    },
    {
      name: 'an abort',
      args: ['-c', 'sleep 3 & echo $!'],
      options: {},
      abortAfterMs: 500,
      waitsForDescendant: true,
    },
  ];

  for (const testCase of leftBehind) {
    it(`settles on ${testCase.name} as execFile does while a descendant holds the output`, async () => {
      const timed = async (): Promise<{ result: Record<string, unknown>; ms: number }> => {
        const started = Date.now();
        const result = await runBoth(
          '/bin/sh',
          testCase.args,
          testCase.options,
          testCase.abortAfterMs,
        );
        const descendant = Number(String(result.stdout).trim());
        if (descendant > 0) strays.add(descendant);
        return { result, ms: Date.now() - started };
      };
      const plain = await timed();
      enableOwnChildSessions();
      const own = await timed();
      const picked = ({
        result,
      }: {
        result: Record<string, unknown>;
      }): Record<string, unknown> => ({
        code: result.code,
        killed: result.killed,
        signal: result.signal,
        name: result.name,
      });

      for (const { ms } of [plain, own]) {
        if (testCase.waitsForDescendant === true) expect(ms).toBeGreaterThan(2500);
        else expect(ms).toBeLessThan(1500);
      }
      expect(picked(own)).toEqual(picked(plain));
    }, 15_000);
  }

  it('does not call back before the call returns when the signal is already aborted', async () => {
    const run = async (): Promise<{ name: string; order: string[] }> => {
      const order: string[] = [];
      const controller = new AbortController();
      controller.abort();
      const name = await new Promise<string>((resolve) => {
        execFileInChildSession(
          '/bin/sh',
          ['-c', 'sleep 5'],
          { signal: controller.signal },
          (error) => {
            order.push('callback');
            resolve(error?.name ?? 'none');
          },
        );
        order.push('returned');
        process.nextTick(() => order.push('tick'));
      });
      return { name, order };
    };
    const plain = await run();
    enableOwnChildSessions();
    const own = await run();

    expect(plain).toEqual({ name: 'AbortError', order: ['returned', 'callback', 'tick'] });
    expect(own).toEqual(plain);
  });

  it('keeps the group registered until the leader is gone when an abort leaves a program that ignores SIGTERM running', async () => {
    const run = async (): Promise<{
      ms: number;
      name: string;
      leaderAlive: boolean;
      registered: boolean;
      registeredAfterLeaderExit: boolean;
    }> => {
      const baseline = process.listenerCount('exit');
      const controller = new AbortController();
      const started = Date.now();
      let child!: ChildProcess;
      const atCallback = await new Promise<{
        name: string;
        leaderAlive: boolean;
        registered: boolean;
      }>((resolve) => {
        child = execFileInChildSession(
          '/bin/sh',
          ['-c', "trap '' TERM; echo ready; while :; do sleep 0.1; done"],
          { signal: controller.signal },
          (error) =>
            resolve({
              name: error?.name ?? 'none',
              leaderAlive: child.exitCode === null && child.signalCode === null,
              registered: process.listenerCount('exit') > baseline,
            }),
        );
        child.stdout?.once('data', () => controller.abort());
      });
      const ms = Date.now() - started;
      strays.add(child.pid!);
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      return {
        ms,
        ...atCallback,
        registeredAfterLeaderExit: process.listenerCount('exit') > baseline,
      };
    };
    const plain = await run();
    enableOwnChildSessions();
    const own = await run();

    // `execFile` settles the abort at once, with the program still running.
    expect(plain).toMatchObject({ name: 'AbortError', leaderAlive: true });
    expect(plain.ms).toBeLessThan(1500);
    expect({ ...own, ms: 0 }).toMatchObject({ name: 'AbortError', leaderAlive: true });
    expect(own.ms).toBeLessThan(1500);
    // The group is still this process's to end while its leader runs, and not after.
    expect(own.registered).toBe(true);
    expect(own.registeredAfterLeaderExit).toBe(false);
  }, 15_000);

  it('signals and registers nothing for a leader that exited while a descendant in another session holds the output', async () => {
    const leaderScript =
      "const { spawn } = require('node:child_process');" +
      "const held = spawn('/bin/sleep', ['4'], { detached: true, stdio: ['ignore', 'inherit', 'ignore'] });" +
      'console.log(held.pid); held.unref();';
    const run = async (): Promise<{
      ms: number;
      error: ExecFileException | null;
      groupSignals: number;
      registeredWhilePending: boolean;
      registeredAfter: boolean;
    }> => {
      const baseline = process.listenerCount('exit');
      const kills = vi.spyOn(process, 'kill');
      try {
        const started = Date.now();
        let child!: ChildProcess;
        let registeredWhilePending = true;
        const outcome = await new Promise<{ error: ExecFileException | null; stdout: string }>(
          (resolve) => {
            child = execFileInChildSession(
              process.execPath,
              ['-e', leaderScript],
              { timeout: 1500 },
              (error, stdout) => resolve({ error, stdout }),
            );
            // Well after the leader exited, well before the timeout.
            setTimeout(() => {
              registeredWhilePending = process.listenerCount('exit') > baseline;
            }, 900);
          },
        );
        const held = Number(outcome.stdout.trim());
        if (held > 0) strays.add(held);
        return {
          ms: Date.now() - started,
          error: outcome.error,
          groupSignals: kills.mock.calls.filter(([pid]) => pid === -child.pid!).length,
          registeredWhilePending,
          registeredAfter: process.listenerCount('exit') > baseline,
        };
      } finally {
        kills.mockRestore();
      }
    };
    const plain = await run();
    enableOwnChildSessions();
    const own = await run();

    // `execFile` lets go of the pipes at the timeout and reports the program's own, successful, end.
    for (const result of [plain, own]) {
      expect(result.error).toBeNull();
      expect(result.ms).toBeGreaterThan(1400);
      expect(result.ms).toBeLessThan(3500);
    }
    expect(own.groupSignals).toBe(0);
    expect(own.registeredWhilePending).toBe(false);
    expect(own.registeredAfter).toBe(false);
  }, 20_000);

  it('reports killed after the returned child was killed, as execFile does', async () => {
    const run = (): Promise<Record<string, unknown>> =>
      new Promise((resolve) => {
        // `exec`, so the shell is the program: killing only the leader must end the output too.
        const child = execFileInChildSession('/bin/sh', ['-c', 'exec sleep 5'], {}, (error) =>
          resolve({ killed: error?.killed, signal: error?.signal, code: error?.code ?? null }),
        );
        setTimeout(() => child.kill(), 200);
      });
    const plain = await run();
    enableOwnChildSessions();
    const own = await run();

    expect(plain).toEqual({ killed: true, signal: 'SIGTERM', code: null });
    expect(own).toEqual(plain);
  });

  it('starts the program in its own group, so its descendants go with it', async () => {
    enableOwnChildSessions();
    const group = await new Promise<string>((resolve) => {
      const child = execFileInChildSession(
        '/bin/sh',
        ['-c', 'echo $$ $(ps -o pgid= -p $$)'],
        {},
        (_error, stdout) => resolve(stdout),
      );
      void child;
    });
    const [pid, pgid] = group.trim().split(/\s+/u).map(Number);

    expect(pgid).toBe(pid);
  });

  it('ends the group, not only the program, when the timeout fires', async () => {
    enableOwnChildSessions();
    const grandchild = await new Promise<number>((resolve) => {
      let reported = 0;
      const child = execFileInChildSession(
        '/bin/sh',
        ['-c', 'sleep 60 & echo $!; wait'],
        { timeout: 300 },
        () => resolve(reported),
      );
      child.stdout?.on('data', (chunk: Buffer) => {
        reported = Number(chunk.toString('utf8').trim());
        strays.add(reported);
      });
    });

    expect(await goneWithin([grandchild], 3000)).toBe(true);
  });
});

interface IEnding {
  readonly pids: readonly number[];
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/**
 * A process with own child sessions on starts a group holding a grandchild, reports both pids, then
 * ends as `ending` says; `send` is delivered once the pids are reported.
 */
function runEnding(ending: string, send?: NodeJS.Signals): Promise<IEnding> {
  const script = [
    `import { enableOwnChildSessions, endWithProcess, runProcessEndNow, withChildSession } from ${JSON.stringify(nodeSurface)};`,
    "import { spawn } from 'node:child_process';",
    'enableOwnChildSessions();',
    "const child = endWithProcess(spawn('/bin/sh', ['-c', 'sleep 60 & echo $!; wait'], withChildSession({ stdio: ['ignore', 'pipe', 'ignore'] })));",
    "child.stdout.once('data', (chunk) => {",
    "  process.stdout.write(child.pid + ' ' + chunk.toString().trim() + '\\n');",
    `  ${ending}`,
    '});',
    'setInterval(() => {}, 1000);',
    'void runProcessEndNow;',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const parent = spawn(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => parent.kill('SIGKILL'), CHILD_TIMEOUT_MS);
    let stdout = '';
    let stderr = '';
    let sent = false;
    parent.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (!stdout.includes('\n')) return;
      for (const pid of stdout.trim().split(/\s+/u).map(Number)) strays.add(pid);
      if (send !== undefined && !sent) {
        sent = true;
        parent.kill(send);
      }
    });
    parent.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    parent.once('error', reject);
    parent.once('close', (code, signal) => {
      clearTimeout(timer);
      const pids = stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
      if (pids.length !== 2) reject(new Error(`the parent reported no group: ${stderr}`));
      else resolve({ pids, code, signal });
    });
  });
}

describe.skipIf(!POSIX)(
  'a process with own child sessions ends its children however it ends',
  () => {
    it(
      'at a normal exit, keeping its exit code',
      async () => {
        const end = await runEnding('process.exit(4);');

        expect(end.code).toBe(4);
        expect(await goneWithin(end.pids, 3000)).toBe(true);
      },
      CHILD_TIMEOUT_MS,
    );

    for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
      it(
        `on ${signal} that nothing handles, still dying by ${signal}`,
        async () => {
          const end = await runEnding('', signal);

          expect({ code: end.code, signal: end.signal }).toEqual({ code: null, signal });
          expect(await goneWithin(end.pids, 3000)).toBe(true);
        },
        CHILD_TIMEOUT_MS,
      );
    }

    it(
      'through a crash handler that ends its scope now and rethrows',
      async () => {
        const end = await runEnding(
          "process.on('uncaughtException', (error) => { runProcessEndNow(); throw error; }); setTimeout(() => { throw new Error('crash'); }, 10);",
        );

        expect(end.code).not.toBe(0);
        expect(await goneWithin(end.pids, 3000)).toBe(true);
      },
      CHILD_TIMEOUT_MS,
    );
  },
);
