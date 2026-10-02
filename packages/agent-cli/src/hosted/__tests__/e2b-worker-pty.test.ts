import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { Sandbox } from 'e2b/dist/index.mjs';
import { startE2BWorkerProcess } from '../e2b-worker-process.js';

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

// A real terminal line discipline/readline, rather than a mock that accepts arbitrary raw bytes.
const terminal = `
import os, pty, select, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.environ['PS1'] = 'fixture> '
    os.execl('/bin/bash', 'bash', '--noprofile', '--norc', '-i')
output = bytearray()
try:
    deadline = time.monotonic() + 5
    while b'fixture> ' not in output and time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]: output.extend(os.read(fd, 65536))
    command = sys.stdin.buffer.readline()
    os.write(fd, command)
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]:
            try: output.extend(os.read(fd, 65536))
            except OSError:
                _, status = os.waitpid(pid, 0)
                sys.stdout.buffer.write(output)
                sys.exit(os.waitstatus_to_exitcode(status))
        done, status = os.waitpid(pid, os.WNOHANG)
        if done: sys.stdout.buffer.write(output); sys.exit(os.waitstatus_to_exitcode(status))
    sys.stdout.buffer.write(output)
    sys.exit(1)
finally:
    try: os.kill(pid, 9)
    except ProcessLookupError: pass
    os.close(fd)
`;

describe.skipIf(process.platform === 'win32')('E2B bootstrap through an actual Bash PTY', () => {
  it.each([
    'prefix\u0015printf PTY_ARGUMENT_INJECTION\n#',
    'prefix\u0003suffix',
    'first\nsecond\rthird\tend\u001b',
  ])(
    'preserves terminal control bytes as argv: %j',
    async (argument) => {
      const directory = mkdtempSync(join(tmpdir(), 'worker-pty-'));
      const capture = join(directory, 'argv.json');
      const child = spawn('python3', ['-c', terminal], {
        env: { ...process.env, HOME: directory },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output = new PassThrough();
      child.stdout.pipe(output);
      let diagnostics = '';
      output.on('data', (data: Buffer) => {
        diagnostics += data.toString();
      });
      child.stderr.on('data', (data: Buffer) => {
        diagnostics += data.toString();
      });
      const waiting = new Promise<{ exitCode: number }>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve({ exitCode: code ?? 1 }));
      });
      const handle = { pid: 123, wait: () => waiting, disconnect: async () => undefined };
      const sandbox = {
        pty: {
          create: async () => handle,
          sendInput: async (_pid: number, bytes: Uint8Array) => {
            child.stdin.write(bytes);
          },
        },
      } as unknown as Sandbox;
      try {
        const program =
          'require("node:fs").writeFileSync(process.argv[1],JSON.stringify(process.argv.slice(2)))';
        const processHandle = await startE2BWorkerProcess(
          sandbox,
          {
            command: `exec ${quote(process.execPath)} -e ${quote(program)} ${quote(capture)} ${quote(argument)}`,
            cwd: directory,
            environment: {},
            timeoutMs: 5000,
            pty: { cols: 80, rows: 24 },
            onStdout: () => undefined,
            onStderr: () => undefined,
          },
          () => undefined,
        );
        expect(await processHandle.wait(), diagnostics).toBe(0);
        expect(JSON.parse(readFileSync(capture, 'utf8'))).toEqual([argument]);
        await processHandle.disconnect();
      } finally {
        child.kill('SIGKILL');
        rmSync(directory, { recursive: true, force: true });
      }
    },
    10_000,
  );
});
