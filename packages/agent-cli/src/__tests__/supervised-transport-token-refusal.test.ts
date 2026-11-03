import { createTestBinaryEnvironment } from './helpers/product-runtime.js';
/**
 * A supervised runtime told to read its WebSocket transport token from the pipe its launcher
 * inherited it on refuses to start when no valid token arrives, rather than serving under another
 * one. Runs the repo's CLI from source, as `daemon start` launches it.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const entry = path.join(repoRoot, 'packages', 'agent-cli', 'src', 'bin.ts');
const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'test-product-token-fd-')));
const home = path.join(scratch, 'home');
const workspace = path.join(scratch, 'workspace');
mkdirSync(home);
mkdirSync(workspace);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const SESSION_ID = '0f6c3a5e-8c1b-4d2a-9f3e-1a2b3c4d5e6f';

/**
 * Preloaded into the runtime: every process it starts while descriptor 4 still holds the launcher's
 * pipe ends the run with code 97, whether or not the way it was started would pass the pipe on. The
 * run ends with code 0 as soon as the runtime closes that pipe, its token read. Bigint stats only,
 * as the reader's own: a plain one would disturb the runtime's module loading.
 */
const spawnProbe = path.join(scratch, 'spawn-probe.mjs');
writeFileSync(
  spawnProbe,
  `import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const inode = () => { try { return fs.fstatSync(4, { bigint: true }).ino; } catch { return undefined; } };
const tokenPipe = inode();
const pipeOpen = () => tokenPipe !== undefined && inode() === tokenPipe;
const refuseWhilePipeOpen = (file) => {
  if (!pipeOpen()) return;
  fs.writeSync(2, 'probe: started ' + String(file) + ' while descriptor 4 still held the token pipe' + String.fromCharCode(10));
  process.exit(97);
};
const spawnChild = childProcess.ChildProcess.prototype.spawn;
childProcess.ChildProcess.prototype.spawn = function (options) {
  refuseWhilePipeOpen(options?.file);
  return spawnChild.call(this, options);
};
for (const name of ['spawnSync', 'execSync', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function (file, ...rest) {
    refuseWhilePipeOpen(file);
    return original.call(this, file, ...rest);
  };
}
const close = fs.closeSync;
fs.closeSync = function (fd) {
  const result = close.call(this, fd);
  if (fd === 4 && tokenPipe !== undefined && !pipeOpen()) {
    fs.writeSync(2, 'probe: token pipe closed' + String.fromCharCode(10));
    process.exit(0);
  }
  return result;
};
syncBuiltinESMExports();
`,
);

/**
 * Start the runtime as a supervised child, with `pipe` (or nothing) as its descriptor 4. Started
 * the way `daemon start` starts it (this Node plus the source loader, no wrapper process in between,
 * which would not pass descriptor 4 on).
 */
function startWithTokenPipe(
  pipe: string | undefined,
  preload: readonly string[] = [],
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...preload,
        '--import',
        'tsx',
        '--conditions=source',
        entry,
        '--serve',
        '--supervised-session-id',
        SESSION_ID,
        '--supervised-transport-token-fd',
      ],
      {
        // Where `tsx` resolves from.
        cwd: repoRoot,
        env: createTestBinaryEnvironment(home),
        stdio:
          pipe === undefined
            ? ['ignore', 'ignore', 'pipe']
            : ['ignore', 'ignore', 'pipe', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    // A runtime that hangs instead of refusing is reaped here, and fails the exit code assertion.
    const reaper = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(reaper);
      resolve({ code, stderr });
    });
    if (pipe !== undefined) {
      (child.stdio[4] as NodeJS.WritableStream).on('error', () => undefined);
      (child.stdio[4] as NodeJS.WritableStream).end(pipe);
    }
  });
}

describe('a supervised runtime told to read its transport token from a pipe', () => {
  // Without a pipe, index 4 holds one of the runtime's own descriptors: it must be refused, not read
  // (a blocking read of it never returns) and not closed.
  it.skipIf(process.platform === 'win32')(
    'refuses to start when its launcher passed no pipe, without hanging',
    async () => {
      const run = await startWithTokenPipe(undefined);
      expect(run.code).toBe(1);
      expect(run.stderr).toContain(
        '--supervised-transport-token-fd: descriptor 4 is not the pipe the launcher hands over',
      );
    },
    40_000,
  );

  it('refuses to start when the pipe carries something that is not a token, without echoing it', async () => {
    const run = await startWithTokenPipe('sensitive-but-malformed-value');
    expect(run.code).toBe(1);
    expect(run.stderr).toContain(
      'descriptor 4 did not carry a transport token of 64 lowercase hex characters',
    );
    expect(run.stderr).not.toContain('sensitive-but-malformed-value');
  }, 40_000);

  // Started from the workspace, the runtime's trust check runs `git` before anything else: that
  // process and every later one must find the pipe already read and closed.
  it.skipIf(process.platform === 'win32')(
    'reads its token before it starts any process',
    async () => {
      const run = await startWithTokenPipe('ab12'.repeat(16), ['--import', spawnProbe]);
      expect(run.stderr).not.toContain('while descriptor 4 still held the token pipe');
      expect(run.stderr).toContain('probe: token pipe closed');
      expect(run.code).toBe(0);
    },
    40_000,
  );
});
