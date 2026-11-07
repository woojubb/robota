/**
 * Directories a process registers for removal are gone however it ends — a normal exit, a hangup,
 * an interrupt, a termination request, or a crash handler that rethrows — and the process ends exactly
 * as it would have without them: the same exit code, or death by the same signal.
 *
 * The signal and exit cases run real child processes, because a signal's default action and Node's
 * exit sequence are what is under test and neither can be faked in-process.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeDirectoryOnProcessExit, runProcessEndNow } from '../node.js';

const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const nodeSurface = pathToFileURL(fileURLToPath(new URL('../node.ts', import.meta.url))).href;
const CHILD_TIMEOUT_MS = 30_000;

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'process-exit-removals-')));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function scratch(name: string): string {
  const directory = join(root, name);
  mkdirSync(directory);
  writeFileSync(join(directory, 'content.txt'), 'conversation content');
  return directory;
}

interface IChildEnd {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly directory: string;
  readonly stderr: string;
}

/**
 * Run a child that registers a fresh scratch directory under `root`, runs `setup`, reports the
 * directory, and then waits. `send` (if given) is delivered once the directory is reported.
 */
function runChild(setup: string, send?: NodeJS.Signals): Promise<IChildEnd> {
  const script = [
    `import { createProcessScopedDirectory, removeDirectoryOnProcessExit } from ${JSON.stringify(nodeSurface)};`,
    "const directory = createProcessScopedDirectory(process.argv[1], 'scratch-');",
    "(await import('node:fs')).writeFileSync(directory + '/content.txt', 'conversation content');",
    'removeDirectoryOnProcessExit(directory);',
    setup,
    "process.stdout.write(directory + '\\n');",
    'setInterval(() => {}, 1000);',
  ].join('\n');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, root],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), CHILD_TIMEOUT_MS);
    let stdout = '';
    let stderr = '';
    let sent = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (send !== undefined && !sent && stdout.includes('\n')) {
        sent = true;
        expect(existsSync(stdout.trim())).toBe(true);
        child.kill(send);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, directory: stdout.trim().split('\n')[0] ?? '', stderr });
    });
  });
}

describe('one registry for the whole process', () => {
  it('adds at most one exit listener however many directories register, and none once all are cancelled', () => {
    const before = process.listenerCount('exit');
    const warnings: string[] = [];
    const onWarning = (warning: Error): void => {
      warnings.push(warning.name);
    };
    process.on('warning', onWarning);
    try {
      const cancels = Array.from({ length: 12 }, (_, index) =>
        removeDirectoryOnProcessExit(scratch(`many-${index}`)),
      );

      expect(process.listenerCount('exit') - before).toBeLessThanOrEqual(1);
      for (const cancel of cancels) cancel();
      expect(process.listenerCount('exit')).toBe(before);
    } finally {
      process.off('warning', onWarning);
    }
    expect(warnings).not.toContain('MaxListenersExceededWarning');
  });

  it('removes every registered directory when asked to now, and a second request changes nothing', () => {
    const first = scratch('first');
    const second = scratch('second');
    const cancelFirst = removeDirectoryOnProcessExit(first);
    removeDirectoryOnProcessExit(second);

    runProcessEndNow();

    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(() => runProcessEndNow()).not.toThrow();
    expect(() => cancelFirst()).not.toThrow();
  });
});

describe('a process that ends on its own', () => {
  it(
    'removes its registered directory at a normal exit and keeps its exit code',
    async () => {
      const end = await runChild('setTimeout(() => process.exit(3), 50);');

      expect(end.code).toBe(3);
      expect(existsSync(end.directory)).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );
});

describe.skipIf(process.platform === 'win32')('a process that receives a signal', () => {
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
    it(
      `removes its registered directory on ${signal} and still dies by ${signal}`,
      async () => {
        const end = await runChild('', signal);

        expect({ code: end.code, signal: end.signal }).toEqual({ code: null, signal });
        expect(existsSync(end.directory)).toBe(false);
      },
      CHILD_TIMEOUT_MS,
    );
  }

  it(
    'leaves the signal to a handler the process installed, and removes at the exit that handler makes',
    async () => {
      const end = await runChild(
        "process.on('SIGINT', () => setTimeout(() => process.exit(0), 50));",
        'SIGINT',
      );

      expect({ code: end.code, signal: end.signal }).toEqual({ code: 0, signal: null });
      expect(existsSync(end.directory)).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'leaves a signal the process own handler ignores, and removes at the exit that comes later',
    async () => {
      const end = await runChild(
        "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(5), 1500);",
        'SIGTERM',
      );

      expect({ code: end.code, signal: end.signal }).toEqual({ code: 5, signal: null });
      expect(existsSync(end.directory)).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );

  it(
    'gets along with signal-exit, which also acts only when every listener is its own',
    async () => {
      // The protocol of signal-exit 3 (which Ink loads): one listener per loaded copy, counted on
      // `process.__signal_exit_emitter__`; it runs its exit handlers and re-raises only when every
      // listener on the signal is one of its copies.
      const marker = join(root, 'signal-exit-ran');
      const end = await runChild(
        [
          "const { writeFileSync } = await import('node:fs');",
          'process.__signal_exit_emitter__ = { count: 1 };',
          'const listener = () => {',
          "  if (process.listeners('SIGHUP').length !== process.__signal_exit_emitter__.count) return;",
          `  writeFileSync(${JSON.stringify(marker)}, 'ran');`,
          "  process.removeListener('SIGHUP', listener);",
          "  process.kill(process.pid, 'SIGHUP');",
          '};',
          "process.on('SIGHUP', listener);",
        ].join('\n'),
        'SIGHUP',
      );

      expect({ code: end.code, signal: end.signal }).toEqual({ code: null, signal: 'SIGHUP' });
      expect(existsSync(marker)).toBe(true);
      expect(existsSync(end.directory)).toBe(false);
    },
    CHILD_TIMEOUT_MS,
  );
});
