/**
 * Node opens its inspector when a process receives SIGUSR1, and any program of the same user can send
 * that signal and then read the environment or drive the process through the debugger. Making the
 * process undumpable does not stop this: the inspector runs inside the process. Each case starts a
 * real process the way the product starts it, sends the signal, and asserts that no inspector opened.
 */

import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SUBAGENT_WORKER_MODE_FLAG } from '@robota-sdk/agent-subagent-runner';
import { afterAll, describe, expect, it } from 'vitest';

import { resolveSelfForkWorkerEntry } from '../subagents/self-fork-worker-entry.js';

const root = fileURLToPath(new URL('../../../..', import.meta.url));
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'inspector-signal-')));
/** An unprotected process prints its inspector URL within milliseconds of the signal. */
const INSPECTOR_SETTLE_MS = 1_500;

/** Reports `ready`, then answers `url` with what the process's own inspector says it serves. */
const STAND_IN = `import inspector from 'node:inspector';
process.stdin.setEncoding('utf8').on('data', (line) => {
  if (line.includes('url')) process.stdout.write('url ' + (inspector.url() ?? 'none') + '\\n');
});
process.stdout.write('ready\\n');
`;

/** The shipped CommonJS wrapper beside a stand-in for the module graph it imports. */
const wrapper = join(scratch, 'wrapper', 'bin', 'agent.cjs');
mkdirSync(join(scratch, 'wrapper', 'bin'), { recursive: true });
mkdirSync(join(scratch, 'wrapper', 'dist', 'node'), { recursive: true });
writeFileSync(join(scratch, 'wrapper', 'package.json'), '{"type":"module"}\n');
copyFileSync(join(root, 'packages/agent-cli/bin/agent.cjs'), wrapper);
writeFileSync(join(scratch, 'wrapper', 'dist', 'node', 'bin.js'), STAND_IN);

/** A worker entry that protects nothing itself: whatever keeps the inspector closed came from its spawn. */
const workerEntry = join(scratch, 'worker-entry.mjs');
writeFileSync(
  workerEntry,
  `if (!process.argv.includes(${JSON.stringify(SUBAGENT_WORKER_MODE_FLAG)})) process.exit(2);\n${STAND_IN}`,
);

/** What the product's own entries apply to their process, imported from source. */
const hardenedEntry = join(scratch, 'hardened-entry.mjs');
writeFileSync(
  hardenedEntry,
  `import { hardenProductProcess } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/process-hardening.ts')).href)};
hardenProductProcess();
${STAND_IN}`,
);

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

interface ISignalOutcome {
  readonly inspectorOpened: boolean;
  readonly inspectorUrl: string;
  readonly alive: boolean;
}

/** Starts `argv`, sends SIGUSR1 once it is ready, and reports whether an inspector opened. */
function signalOnceReady(argv: readonly string[]): Promise<ISignalOutcome> {
  return new Promise((resolve, reject) => {
    // A random inspector port, so a process that does open one never collides with another test.
    const child = spawn(process.execPath, [...argv], {
      env: { ...process.env, NODE_OPTIONS: '--inspect-port=0' },
    });
    let stdout = '';
    let stderr = '';
    let signalled = false;
    let settle: NodeJS.Timeout | undefined;
    const finish = (outcome: ISignalOutcome): void => {
      clearTimeout(settle);
      child.kill('SIGKILL');
      resolve(outcome);
    };
    const opened = (): boolean => stderr.includes('Debugger listening');
    // A question written after the process was killed must not fail the test.
    child.stdin.on('error', () => undefined);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (signalled && opened()) child.stdin.write('url\n');
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (!signalled && /^ready$/mu.test(stdout) && child.pid !== undefined) {
        signalled = true;
        process.kill(child.pid, 'SIGUSR1');
        settle = setTimeout(() => child.stdin.write('url\n'), INSPECTOR_SETTLE_MS);
      }
      const answer = /^url (\S+)$/mu.exec(stdout);
      if (answer !== null) finish({ inspectorOpened: opened(), inspectorUrl: answer[1] ?? '', alive: true });
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (!signalled) reject(new Error(`process exited with ${code ?? signal} before it was ready: ${stderr}`));
      else finish({ inspectorOpened: opened(), inspectorUrl: 'none', alive: false });
    });
  });
}

const TSX_LOADER = ['--import', join(root, 'node_modules/tsx/dist/loader.mjs'), '--conditions=product-source'];

(process.platform === 'win32' ? describe.skip : describe)('SIGUSR1 inspector hardening', () => {
  it('keeps the inspector closed in the executable wrapper, before its module graph loads', async () => {
    const outcome = await signalOnceReady([wrapper]);

    expect(outcome).toEqual({ inspectorOpened: false, inspectorUrl: 'none', alive: true });
  }, 30_000);

  it('keeps the inspector closed in a process the product entry hardened', async () => {
    const outcome = await signalOnceReady([...TSX_LOADER, hardenedEntry]);

    expect(outcome).toEqual({ inspectorOpened: false, inspectorUrl: 'none', alive: true });
  }, 30_000);

  it.skipIf(!process.allowedNodeEnvironmentFlags.has('--disable-sigusr1'))(
    'starts a self-fork worker with the inspector signal disabled from its first instruction',
    async () => {
      const originalArgv = [...process.argv];
      let entry: ReturnType<typeof resolveSelfForkWorkerEntry>;
      try {
        process.argv.splice(1, process.argv.length - 1, workerEntry);
        entry = resolveSelfForkWorkerEntry();
      } finally {
        process.argv.splice(0, process.argv.length, ...originalArgv);
      }

      // The argv the subagent runner builds from the entry the product hands it.
      const outcome = await signalOnceReady([
        ...(entry.execArgv ?? []),
        ...entry.args,
        SUBAGENT_WORKER_MODE_FLAG,
      ]);

      expect(outcome).toEqual({ inspectorOpened: false, inspectorUrl: 'none', alive: true });
    },
    30_000,
  );
});
