/** Real public CLI and real worker CLI; only the E2B transport is simulated. No cloud containment claim. */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hostedFixture } from '../../hosted/__tests__/hosted-fixture.js';
import { admitHostedRuntime } from '../../hosted/hosted-runtime-admission.js';
import { createTestBinaryEnvironment, createTestProductEnvironment } from './product-runtime.js';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));

/** Simulated provider transport; real stock CLI/tools/processes, with disposable state. */
export async function hostedWorkerCliFixture(
  settings: Record<string, unknown> = {},
  options: {
    readonly runTimeoutMs?: number;
    readonly taskToken?: string;
    readonly outputDuringDelete?: 'stdout' | 'stderr';
  } = {},
) {
  const f = await hostedFixture();
  try {
    f.setProofLifetime(60_000);
    f.writeConfig({ ...f.config, lifetimeMs: 55_000, probeTimeoutMs: 10_000 });
    const admission = await admitHostedRuntime({ environment: f.environment, resume: false });
    if (!admission) throw new Error('fixture did not admit');
    const worker = join(f.directory, 'worker');
    const home = join(f.directory, 'runtime-home');
    const state = join(worker, 'product-state');
    mkdirSync(worker);
    mkdirSync(home);
    mkdirSync(state);
    writeFileSync(
      join(state, 'settings.json'),
      JSON.stringify({
        currentProvider: 'openai',
        providers: {
          openai: {
            type: 'openai',
            model: 'gpt-test',
            apiKey: '$ENV:OPENAI_API_KEY',
          },
        },
        sandbox: { enabled: false },
        ...settings,
      }),
    );
    // Trusted local probe receipts also cover detached tool groups outside the simulated SDK group.
    const groups = join(f.directory, 'owned-process-groups.jsonl');
    const processes = join(worker, 'processes.jsonl');
    const probe = join(worker, 'process-probe.mjs');
    writeFileSync(
      probe,
      `import { appendFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
appendFileSync(${JSON.stringify(processes)}, JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv, cwd: process.cwd(), ipc: typeof process.send === 'function', environment: process.env }) + String.fromCharCode(10));
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  const options = args.at(-1);
  if (options?.detached === true && child.pid) appendFileSync(${JSON.stringify(groups)}, JSON.stringify({ pid: child.pid }) + String.fromCharCode(10));
  return child;
};
syncBuiltinESMExports();`,
    );
    const workerCliHost = join(worker, 'worker-cli-host.mts');
    writeFileSync(
      workerCliHost,
      `import { startCliEntry } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/cli-entry.ts')).href)};
void startCliEntry({ environment: process.env });
`,
    );
    const artifact = join(f.directory, 'worker-cli.mjs');
    writeFileSync(
      artifact,
      `
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--import', ${JSON.stringify(join(root, 'node_modules/tsx/dist/loader.mjs'))}, '--import', ${JSON.stringify(probe)}, '--conditions=source', ${JSON.stringify(workerCliHost)}, ...process.argv.slice(2)], { stdio: 'inherit' });
child.once('error', error => { process.stderr.write(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
`,
    );
    const product = join(f.directory, 'worker-product.env');
    writeFileSync(
      product,
      Object.entries({
        ...createTestProductEnvironment('test-product'),
        PRODUCT_USER_STATE_DIR: state,
        PRODUCT_CACHE_DIR: join(worker, 'cache'),
        PRODUCT_LOG_DIR: join(worker, 'logs'),
      })
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
    );
    const access = f.signWorkerAccess({
      version: 1,
      identity: admission.config.identity,
      epoch: admission.config.epoch,
      worker: admission.config.worker.resource,
      broker: admission.config.broker.resource,
      endpoint: new URL('/v1', admission.config.broker.endpoint).href,
      token: options.taskToken ?? 'synthetic-task-token',
      issuedAt: Date.now(),
      expiresAt: admission.expiresAt,
    });
    const execution = join(f.directory, 'execution.json');
    const digest = (path: string): string =>
      createHash('sha256').update(readFileSync(path)).digest('hex');
    writeFileSync(
      execution,
      JSON.stringify({
        version: 1,
        templateId: 'fixture-template',
        nodeExecutable: process.execPath,
        workspaceRoot: worker,
        entrypoint: { path: artifact, digest: digest(artifact) },
        productConfig: { path: product, digest: digest(product) },
        access,
      }),
      { mode: 0o600 },
    );
    const receipts = join(f.directory, 'provider-receipts.jsonl');
    const providerInfo = join(f.directory, 'provider-info.json');
    writeFileSync(
      providerInfo,
      JSON.stringify({
        sandboxId: admission.config.worker.resource,
        templateId: 'fixture-template',
        metadata: admission.config.identity,
        state: 'running',
        lifecycle: { onTimeout: 'kill', autoResume: false },
        allowInternetAccess: false,
        network: { allowPublicTraffic: false, allowOut: ['127.0.0.1'] },
      }),
    );
    const usageReceipt = join(f.directory, 'runtime-usage.json');
    const entry = join(f.directory, 'runtime.mjs');
    writeFileSync(
      entry,
      `
import { spawn } from 'node:child_process';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { Sandbox, CommandExitError } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/node_modules/e2b/dist/index.mjs')).href)};
import { startCli } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/cli.ts')).href)};
import { HostedRuntimeController } from ${JSON.stringify(pathToFileURL(join(root, 'packages/agent-cli/src/hosted/hosted-runtime-controller.ts')).href)};
const originalRun = HostedRuntimeController.prototype.run;
HostedRuntimeController.prototype.run = async function() {
  try { return await originalRun.call(this); }
  finally { await writeFile(${JSON.stringify(usageReceipt)}, JSON.stringify(this.status()), { mode: 0o600 }); }
};
const children = new Set();
Sandbox.getInfo = async () => JSON.parse(await readFile(${JSON.stringify(providerInfo)}, 'utf8'));
Sandbox.connect = async () => ({ sandboxId: ${JSON.stringify(admission.config.worker.resource)}, files: { read: path => readFile(path, 'utf8'), write: (path, content) => writeFile(path, content) }, commands: { run: async (command, options) => {
  await appendFile(${JSON.stringify(receipts)}, JSON.stringify({ command, cwd: options.cwd, envs: options.envs }) + '\\n');
  const child = spawn('/bin/sh', ['-c', command], { cwd: options.cwd, env: options.envs ?? {}, detached: true, stdio: ['pipe','pipe','pipe'] });
  children.add(child);
  if (child.pid) appendFileSync(${JSON.stringify(groups)}, JSON.stringify({ pid: child.pid }) + String.fromCharCode(10));
  let stdout = '', stderr = '', disconnected = false, streamFailed = false, streamError, settleWait;
  const waiting = new Promise(resolve => { settleWait = resolve; });
  // The SDK contains callback exceptions in wait() and suppresses delivery after disconnect.
  const failStream = error => { streamFailed = true; streamError = error; disconnected = true; settleWait(); };
  const receive = (channel, data) => {
    if (disconnected) return;
    const text = data.toString();
    if (channel === 'stdout') stdout += text; else stderr += text;
    try { options[channel === 'stdout' ? 'onStdout' : 'onStderr']?.(text); }
    catch (error) { failStream(error); }
  };
  child.stdout.on('data', data => receive('stdout', data));
  child.stderr.on('data', data => receive('stderr', data));
  child.once('error', failStream);
  child.once('close', exitCode => { children.delete(child); settleWait({ exitCode, stdout, stderr }); });
  const wait = async () => { const result = await waiting; if (streamFailed) throw streamError; return result; };
  if (!options.background) return wait();
  return { pid: child.pid, wait, sendStdin: data => new Promise((resolve, reject) => child.stdin.write(data, error => error ? reject(error) : resolve())), closeStdin: async () => { child.stdin.end(); }, disconnect: async () => { disconnected = true; } };
} } });
Sandbox.kill = async () => {
  const outputDuringDelete = ${JSON.stringify(options.outputDuringDelete ?? null)};
  if (outputDuringDelete) await new Promise(resolve => queueMicrotask(() => {
    for (const child of children) child[outputDuringDelete].emit('data', Buffer.from('late-provider-output-after-withdrawal'));
    resolve();
  }));
  await appendFile(${JSON.stringify(receipts)}, JSON.stringify({ kind: 'delete', sandboxId: ${JSON.stringify(admission.config.worker.resource)}, at: Date.now() }) + String.fromCharCode(10));
  for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  return true;
};
startCli({ environment: process.env }).catch(error => { process.stderr.write(error.message + '\\n'); process.exitCode = 1; });
`,
    );
    // Fixture cleanup remains independent of the production provider deletion receipt.
    const active = new Map<ChildProcess, Promise<void>>();
    let closing: Promise<void> | undefined;
    const killOwnedGroups = (): void => {
      if (!existsSync(groups)) return;
      for (const line of readFileSync(groups, 'utf8').trim().split('\n')) {
        if (!line) continue;
        const { pid } = JSON.parse(line) as { pid: number };
        try {
          process.kill(-pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
    };
    return {
      f,
      worker,
      home,
      state,
      processes,
      receipts,
      providerInfo,
      execution,
      usageReceipt,
      run: async (args: readonly string[], signal?: AbortSignal) => {
        if (closing) throw new Error('hosted worker fixture is closed');
        return new Promise<{ status: number | null; stdout: string; stderr: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                '--import',
                join(root, 'node_modules/tsx/dist/loader.mjs'),
                '--conditions=source',
                entry,
                ...args,
              ],
              {
                cwd: home,
                env: createTestBinaryEnvironment(home, {
                  ...f.environment,
                  PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG: execution,
                  PRODUCT_E2B_API_KEY: 'runtime-management-canary',
                  ANTHROPIC_API_KEY: 'runtime-upstream-canary',
                }),
                stdio: ['pipe', 'pipe', 'pipe'],
              },
            );
            // Exit precedes pipe close: a detached simulated task can still hold those pipes.
            child.once('exit', killOwnedGroups);
            const drained = new Promise<void>((done) => child.once('close', () => done()));
            active.set(child, drained);
            let timedOut = false;
            const stop = (): void => {
              child.kill('SIGTERM');
            };
            signal?.addEventListener('abort', stop, { once: true });
            if (signal?.aborted) stop();
            let stdout = '',
              stderr = '';
            child.stdout.on('data', (data) => {
              stdout += data;
            });
            child.stderr.on('data', (data) => {
              stderr += data;
            });
            child.stdin.end();
            const timer = setTimeout(() => {
              timedOut = true;
              killOwnedGroups();
              child.kill('SIGKILL');
            }, options.runTimeoutMs ?? 60_000);
            child.once('error', (error) => {
              clearTimeout(timer);
              signal?.removeEventListener('abort', stop);
              reject(error);
            });
            child.once('close', (status) => {
              active.delete(child);
              killOwnedGroups();
              clearTimeout(timer);
              signal?.removeEventListener('abort', stop);
              if (timedOut) reject(new Error('hosted worker fixture did not settle'));
              else resolve({ status, stdout, stderr });
            });
          },
        );
      },
      close: () => {
        closing ??= (async () => {
          killOwnedGroups();
          const runs = [...active.entries()];
          for (const [child] of runs) child.kill('SIGKILL');
          await Promise.all(runs.map(([, drained]) => drained));
          killOwnedGroups();
          await f.close();
        })();
        return closing;
      },
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
