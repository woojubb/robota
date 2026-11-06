#!/usr/bin/env node
/**
 * Under a compiled Bun executable the workflow regex node (`text-replace`) does its pattern matching in a child
 * process: a regex running on a worker thread cannot be stopped, so the executable starts itself again
 * (`BUN_BE_BUN=1 <executable> -e <bootstrap>`) and kills that child when the node times out. Nothing but a
 * compiled executable reaches that code, so the Node tests cannot cover it. This runs workflows through the
 * packaged executable and checks, in order:
 *
 *   1. an ordinary regex operation succeeds, and its run time is what a catastrophic run is measured against;
 *   2. a quadratic pattern on a hostile input ends within the node's timeout plus a margin, as the timeout
 *      refusal: not a hang, a crash, an isolation error or a silent pass;
 *   3. during that run the executable had a child process carrying the worker bootstrap, so the path under test
 *      is the child-process worker and not something that merely looks like it;
 *   4. no worker process is left behind, and a following independent run succeeds.
 *
 * The pattern is quadratic on purpose. JavaScriptCore gives up on an exponential pattern such as `^(a+)+$` after
 * about half a second and reports "no match", so that pattern races any timeout instead of exercising it. The
 * quadratic one runs for tens of seconds if nothing stops it, which is what makes a missing kill show as a hang.
 *
 *   node scripts/e2e-regex-worker.mjs <agent-executable>
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveOnTerminal, resolveNativeFixtureWorkspace, stopFixtureBroker } from './e2e-native-file-authority.mjs';
import { fixtureProcessEnvironment } from './product-fixture-environment.mjs';

/** Appears in a child's command line only through the regex worker bootstrap (`boundedRegexReplace`). */
export const WORKER_MARKER = 'boundedRegexReplace';

/** Long enough for a sample to land inside it on a host where reading the process table takes a second. */
const HOSTILE_TIMEOUT_MS = 3000;
/** Ending, killing the worker and reporting must fit in this on top of the node's timeout. */
const MARGIN_MS = 8000;
/** `\s*$` retries from every leading space and scans to the end each time: the work grows with the square of the run. */
const HOSTILE_INPUT = `${' '.repeat(600_000)}x`;
const ORDINARY_TIMEOUT_MS = 30_000;

/**
 * One node between an input and an output, as the workflow file holds it. `timeoutMs` is the node's own limit.
 */
export function regexWorkflow({ text, search, flags = '', replacement, timeoutMs }) {
  return {
    dagId: 'regex-worker-e2e',
    version: 1,
    status: 'draft',
    nodes: [
      { nodeId: 'input', nodeType: 'input', dependsOn: [], config: { text } },
      {
        nodeId: 'regex',
        nodeType: 'text-replace',
        dependsOn: ['input'],
        timeoutMs,
        config: { search, flags, useRegex: true, replacement },
      },
      { nodeId: 'after', nodeType: 'text-output', dependsOn: ['regex'], config: {} },
    ],
    edges: [
      { from: 'input', to: 'regex', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      { from: 'regex', to: 'after', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    ],
  };
}

/**
 * Rows of `ps -o pid= -o ppid= -o command=`. A row starts with two integers; a command line that itself contains
 * line breaks continues on the lines after it.
 */
export function parseProcessTable(output) {
  const rows = [];
  for (const line of output.split(/\r?\n/u)) {
    const start = /^\s*(\d+)\s+(\d+)\s?(.*)$/u.exec(line);
    if (start) rows.push({ pid: Number(start[1]), ppid: Number(start[2]), command: start[3] });
    else if (rows.length > 0) rows.at(-1).command += `\n${line}`;
  }
  return rows;
}

const WINDOWS_QUERY = [
  '$ErrorActionPreference = "Stop"',
  '$ProgressPreference = "SilentlyContinue"',
  '$rows = Get-CimInstance Win32_Process -Filter ("Name = \'" + $env:E2E_WORKER_IMAGE + "\'") |',
  '  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:E2E_WORKER_MARKER) } |',
  '  ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId } }',
  'if ($rows) { ConvertTo-Json -Compress -InputObject @($rows) }',
].join('\n');

/** The processes of `binary` that carry the regex worker bootstrap: `[{ pid, ppid }]`. */
export function workerProcesses(binary) {
  const image = basename(binary);
  if (process.platform === 'win32') {
    const query = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        Buffer.from(WINDOWS_QUERY, 'utf16le').toString('base64'),
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
        env: { ...process.env, E2E_WORKER_IMAGE: image, E2E_WORKER_MARKER: WORKER_MARKER },
      },
    );
    if (query.status !== 0) {
      throw failure('The process table could not be read.', `${query.stdout}\n${query.stderr}`);
    }
    const output = query.stdout.trim();
    return output === '' ? [] : JSON.parse(output);
  }
  const output = execFileSync('ps', ['-axww', '-o', 'pid=', '-o', 'ppid=', '-o', 'command='], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return parseProcessTable(output)
    .filter(({ command }) => command.includes(WORKER_MARKER) && command.includes(image))
    .map(({ pid, ppid }) => ({ pid, ppid }));
}

function killProcess(pid) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function failure(label, detail) {
  return new Error(`${label}\n${detail}`);
}

/**
 * Runs `/workflows run <file>` in print mode and records workers observed as this process's children.
 * A run that outlasts `limitMs` is killed and flagged.
 */
async function runWorkflow(context, file, { limitMs }) {
  const started = Date.now();
  const child = spawn(
    context.binary,
    ['-p', `/workflows run ${file}`, '--output-format', 'json', '--no-session-persistence'],
    {
      cwd: context.workspace,
      env: context.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  let exited = false;
  const closed = new Promise((resolveClosed) => {
    child.once('error', (error) => {
      stderr += String(error);
      exited = true;
      resolveClosed({ status: null, signal: null });
    });
    child.once('close', (status, signal) => {
      exited = true;
      resolveClosed({ status, signal });
    });
  });
  let overran = false;
  const limit = setTimeout(() => {
    overran = true;
    if (child.pid !== undefined) killProcess(child.pid);
  }, limitMs);
  const workers = new Set();
  while (!exited) {
    for (const { pid, ppid } of workerProcesses(context.binary)) {
      if (ppid === child.pid) {
        workers.add(pid);
      }
    }
    await Promise.race([closed, sleep(100)]);
  }
  const { status, signal } = await closed;
  clearTimeout(limit);
  return { status, signal, stdout, stderr, wallMs: Date.now() - started, overran, workers };
}

/** The `{ type, result, subtype }` envelope print mode writes with `--output-format json`. */
function envelopeOf(run, label) {
  const lines = run.stdout.split(/\r?\n/u).filter((line) => line.trim() !== '');
  try {
    return JSON.parse(lines.at(-1) ?? '');
  } catch {
    throw failure(`${label}: print mode wrote no JSON envelope.`, describe(run));
  }
}

function describe(run) {
  return (
    `status ${String(run.status)} signal ${String(run.signal)} after ${run.wallMs}ms` +
    `${run.overran ? ' (killed: it did not end in time)' : ''}\n` +
    `stdout:\n${run.stdout.slice(0, 2000)}\nstderr:\n${run.stderr.slice(0, 2000)}`
  );
}

/** Waits briefly for a worker's exit to be reaped, then removes any that remain so a failure leaves no busy process. */
async function leftoverWorkers(binary) {
  const deadline = Date.now() + 5000;
  let remaining = workerProcesses(binary);
  while (remaining.length > 0 && Date.now() < deadline) {
    await sleep(250);
    remaining = workerProcesses(binary);
  }
  for (const { pid } of remaining) killProcess(pid);
  return remaining.map(({ pid }) => pid);
}

/** Verdict on the catastrophic run; throws for each way the case can be passed vacuously or fail. */
export function assertHostileRun(run, { timeoutMs, marginMs, baselineMs }) {
  const bound = baselineMs + timeoutMs + marginMs;
  if (run.overran) {
    throw failure(
      `The hostile run hung: it did not end within ${bound}ms (an ordinary run took ${baselineMs}ms, the node's timeout is ${timeoutMs}ms).`,
      describe(run),
    );
  }
  const envelope = envelopeOf(run, 'Hostile run');
  const refusal =
    /^Workflow failed \((\d+)ms\): regex: Task execution timed out after (\d+)ms$/u.exec(
      envelope.result ?? '',
    );
  if (run.status !== 1 || envelope.subtype !== 'error' || refusal === null) {
    throw failure(
      `The hostile run did not end as the node's timeout refusal (a crash, an isolation error or a silent pass looks different).`,
      describe(run),
    );
  }
  const [, durationMs, limitMs] = refusal.map(Number);
  // The worker reports the remaining deadline after setup, not necessarily the configured timeout.
  if (
    limitMs <= 0 ||
    limitMs > timeoutMs ||
    durationMs < timeoutMs ||
    durationMs > timeoutMs + marginMs
  ) {
    throw failure(
      `The refusal reports ${durationMs}ms against a ${timeoutMs}ms timeout; expected the timeout to elapse, then the run to end within ${marginMs}ms.`,
      describe(run),
    );
  }
  if (run.workers.size === 0) {
    throw failure(
      `The hostile run never had a regex worker child process (a command line carrying ${WORKER_MARKER}); the case did not reach the compiled-binary worker.`,
      describe(run),
    );
  }
  if (run.wallMs > bound) {
    throw failure(`The hostile run took ${run.wallMs}ms; the bound is ${bound}ms.`, describe(run));
  }
}

export async function runRegexWorkerE2e(binaryPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? HOSTILE_TIMEOUT_MS;
  const marginMs = options.marginMs ?? MARGIN_MS;
  const hostileInput = options.hostileInput ?? HOSTILE_INPUT;
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-regex-worker-')));
  // The worker deliberately drops inherited environment variables. A per-fixture executable name
  // still identifies its workers after reparenting without selecting another run's processes.
  const binary = join(root, `regex-worker-${randomUUID()}${extname(binaryPath)}`);
  const home = join(root, 'home');
  // Reassigned once the repository exists: see below.
  let workspace = join(root, 'workspace');
  const env = fixtureProcessEnvironment(home);
  const context = { binary, workspace, env };
  const cli = (args) =>
    spawnSync(binary, args, { cwd: workspace, env, encoding: 'utf8', timeout: 120_000 });
  const writeWorkflow = (name, definition) =>
    writeFileSync(join(workspace, name), JSON.stringify(definition));
  try {
    copyFileSync(resolve(binaryPath), binary);
    mkdirSync(home, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    const git = spawnSync('git', ['init', '--quiet'], { cwd: workspace, env, encoding: 'utf8' });
    if (git.status !== 0) throw failure('git init failed.', `${git.stdout}\n${git.stderr}`);
    // Workspace trust is keyed by paths the product derives from the directory it is started in. Windows
    // reports a temporary directory by its 8.3 short name (`RUNNER~1`), which Node's `realpathSync` keeps and
    // git expands, so the CLI is started in the root as git names it, as the native file authority fixture does.
    workspace = resolveNativeFixtureWorkspace(workspace, env);
    context.workspace = workspace;

    const trust = await approveOnTerminal(binary, ['trust', '--yes'], workspace, env);
    if (trust.status !== 0 || !/Workspace trust: trusted/u.test(trust.stdout ?? '')) {
      throw failure(
        'trust --yes failed.',
        `${trust.stdout}\n${trust.stderr}\nworkspace given to the CLI: ${workspace}`,
      );
    }
    // Print mode needs a configured provider to start. A local one whose address is never dialled: a workflow
    // file runs without a model.
    const provider = cli([
      '--configure-provider',
      'offline',
      '--type',
      'gemma',
      '--base-url',
      'http://127.0.0.1:9',
      '--model',
      'offline-fixture',
      '--set-current',
    ]);
    if (provider.status !== 0) {
      throw failure('provider setup failed.', `${provider.stdout}\n${provider.stderr}`);
    }

    writeWorkflow(
      'ordinary.json',
      regexWorkflow({
        text: 'robota 3 workers 42',
        search: '\\d+',
        flags: 'g',
        replacement: '#',
        timeoutMs: ORDINARY_TIMEOUT_MS,
      }),
    );
    writeWorkflow(
      'hostile.json',
      regexWorkflow({ text: hostileInput, search: '\\s*$', replacement: '', timeoutMs }),
    );

    const expectOrdinary = (run, label) => {
      const envelope = envelopeOf(run, label);
      if (
        run.overran ||
        run.status !== 0 ||
        envelope.subtype !== 'success' ||
        !/^Workflow completed in \d+ms\./u.test(envelope.result ?? '') ||
        !(envelope.result ?? '').includes('"regex.text": "robota # workers #"')
      ) {
        throw failure(`${label}: the ordinary regex operation did not succeed.`, describe(run));
      }
    };
    const expectNoWorkerLeft = async (label) => {
      const leaked = await leftoverWorkers(binary);
      if (leaked.length > 0) {
        throw failure(
          `${label}: regex worker process(es) ${leaked.join(', ')} outlived the run (now killed).`,
          '',
        );
      }
    };

    const ordinary = await runWorkflow(context, 'ordinary.json', { limitMs: 120_000 });
    expectOrdinary(ordinary, 'Ordinary run');
    await expectNoWorkerLeft('Ordinary run');

    const hostile = await runWorkflow(context, 'hostile.json', {
      limitMs: ordinary.wallMs + timeoutMs + marginMs,
    });
    try {
      assertHostileRun(hostile, { timeoutMs, marginMs, baselineMs: ordinary.wallMs });
    } catch (error) {
      // A run that failed its own checks may have left its worker busy; remove it before reporting.
      await leftoverWorkers(binary);
      throw error;
    }
    await expectNoWorkerLeft('Hostile run');

    const recovery = await runWorkflow(context, 'ordinary.json', { limitMs: 120_000 });
    expectOrdinary(recovery, 'Run after the hostile one');
    await expectNoWorkerLeft('Run after the hostile one');

    return (
      `regex-worker=passed; worker=child process(es) ${[...hostile.workers].join(',')}; ` +
      `hostile=timeout refusal in ${hostile.wallMs}ms (ordinary ${ordinary.wallMs}ms); leaked=0; recovery=passed`
    );
  } finally {
    await leftoverWorkers(binary).catch(() => undefined);
    await stopFixtureBroker(env);
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [binaryPath] = process.argv.slice(2);
    if (!binaryPath) throw new Error('Usage: e2e-regex-worker.mjs <agent-executable>');
    process.stdout.write(`${await runRegexWorkerE2e(binaryPath)}\n`);
  } catch (error) {
    process.stderr.write(
      `regex-worker e2e: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
