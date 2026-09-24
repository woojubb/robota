import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('/workflows tool grep stops catastrophic regex without blocking the host and runs again', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'grep-watchdog-')));
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('./fixtures/grep-watchdog.ts', import.meta.url)),
          root,
        ],
        { env: { ...process.env, HOME: root }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      const watchdog = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`External watchdog: ${stdout} ${stderr}`));
      }, 10000);
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
    expect(result.failed.success).toBe(false);
    expect(result.failed.message).toMatch(/timed out|cancelled/i);
    expect(result.terminatedAtFailure).toBe(true);
    expect(result.heartbeats).toBeGreaterThan(2);
    expect(result.succeeded.success).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 15000);
