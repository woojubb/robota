import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each(['source', 'built'])(
  '/workflows (%s) kills CPU-bound regex, keeps the host responsive, joins exit and runs again',
  async (mode) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'regex-watchdog-')));
    try {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '--import',
            'tsx',
            fileURLToPath(new URL('./fixtures/text-replace-watchdog.ts', import.meta.url)),
            root,
          ],
          {
            env: { ...process.env, HOME: root, ISOLATION_ARTIFACT_MODE: mode },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let stdout = '';
        let stderr = '';
        const watchdog = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`External watchdog: ${stdout} ${stderr}`));
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
      expect(result.failed.success).toBe(false);
      expect(result.failed.message).toContain('timed out');
      expect(result.terminatedAtFailure).toBe(true);
      expect(result.downstreamAtFailure).toBe(0);
      expect(result.regexCompletedAtFailure).toBe(0);
      expect(result.heartbeats).toBeGreaterThan(2);
      expect(result.succeeded.success).toBe(true);
      expect(result.entered).toBe(2);
      expect(result.exited).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  10000,
);
