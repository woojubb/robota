import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// createDagFramework's own default composition must isolate `text-replace` regex execution the
// same way LocalDagRuntimeProvider does: a catastrophic-backtracking pattern must not block the
// event loop, and the node must fail (via its isolated worker's own timeout) instead of freezing
// the host process. This runs the scenario in a child process, against the *built* package (the
// fixture is plain JS resolving `../../../dist/node/index.js`, so `pnpm build` must have run),
// with an external hard-kill watchdog: a regression that blocks the event loop fails this test
// (the child gets killed and the promise rejects) instead of hanging vitest.
it('runs text-replace regex isolated from a plain createDagFramework composition, staying responsive under a catastrophic pattern', async () => {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./fixtures/create-dag-framework-regex-watchdog.mjs', import.meta.url))],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`External watchdog fired — event loop likely blocked: ${stdout} ${stderr}`));
    }, 5000);
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    child.on('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(watchdog);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Child exit ${code}: ${stderr}`));
    });
  });

  expect(output).toContain('entered\n');
  const result = JSON.parse(output.trim().split('\n').at(-1)!);
  expect(result.status).toBe('failed');
  // Under 5s (well under the external watchdog) with a bounded node timeoutMs of 300ms, and the
  // heartbeat kept ticking the whole time — the host process was never blocked.
  expect(result.heartbeats).toBeGreaterThan(2);
  // Specifically an isolated-worker timeout, not the "no isolation capability was supplied"
  // fail-closed error: this proves createDagFramework actually wired the isolated executor in,
  // rather than merely refusing to run the regex at all.
  expect(result.errorCode).toBe('DAG_TASK_EXECUTION_TIMEOUT');
}, 10000);
