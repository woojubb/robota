import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

it('counts millions of empty lines within a constrained heap without materializing a split array', async () => {
  const child = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const childProcess = spawn(
        process.execPath,
        [
          '--max-old-space-size=64',
          '--import',
          'tsx',
          fileURLToPath(new URL('./fixtures/text-count-lines-heap.ts', import.meta.url)),
        ],
        { cwd: fileURLToPath(new URL('../../../../..', import.meta.url)) },
      );
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        childProcess.kill('SIGKILL');
        reject(new Error(`Constrained count exceeded 10 seconds: ${stderr.slice(-1000)}`));
      }, 10_000);
      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      childProcess.stderr.on('data', (data: Buffer) => {
        if (stderr.length < 2000) stderr += data.toString().slice(0, 2000 - stderr.length);
      });
      childProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      childProcess.on('close', (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    },
  );

  expect(child.code, child.stderr).toBe(0);
  expect(child.stdout).toBe('ok\n');
}, 15_000);
