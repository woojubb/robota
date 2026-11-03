import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isSupervisedTransportToken,
  readSupervisedTransportToken,
  readTransportTokenFrom,
  SUPERVISED_TRANSPORT_TOKEN_FD,
} from '../supervised-transport-token.js';

const TOKEN = 'ab12'.repeat(16);

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'rs-token-fd-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A real, readable descriptor holding `content`, standing in for the inherited pipe. */
function descriptorHolding(content: string | Buffer): number {
  const file = join(scratch, 'pipe');
  writeFileSync(file, content);
  return openSync(file, 'r');
}

describe('supervised transport token pipe', () => {
  it('is descriptor 4: the first one after stdio and the IPC channel', () => {
    expect(SUPERVISED_TRANSPORT_TOKEN_FD).toBe(4);
  });

  it('accepts exactly the 64 lowercase hex characters the launcher mints', () => {
    expect(isSupervisedTransportToken(TOKEN)).toBe(true);
    for (const value of [
      '',
      'a'.repeat(63),
      'a'.repeat(65),
      'A'.repeat(64),
      `${'a'.repeat(63)}g`,
      `${TOKEN}\n`,
    ]) {
      expect(isSupervisedTransportToken(value)).toBe(false);
    }
  });

  it('reads the token the launcher wrote, then closes the descriptor so nothing inherits it', () => {
    const fd = descriptorHolding(TOKEN);
    expect(readTransportTokenFrom(fd)).toBe(TOKEN);
    expect(() => readSync(fd, Buffer.alloc(1), 0, 1, null)).toThrow(/EBADF/u);
  });

  it.each([
    ['empty', ''],
    ['too short', 'a'.repeat(63)],
    ['uppercase', 'A'.repeat(64)],
    ['not hex', 'z'.repeat(64)],
    ['with a trailing newline', `${TOKEN}\n`],
    ['two tokens', TOKEN + TOKEN],
  ])('refuses to start when the pipe carries %s, without echoing it', (_label, content) => {
    const fd = descriptorHolding(content);
    let message = '';
    try {
      readTransportTokenFrom(fd);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('--supervised-transport-token-fd');
    expect(message).toContain('64 lowercase hex characters');
    if (content.length > 0) expect(message).not.toContain(content);
    // Closed even though it was refused.
    expect(() => readSync(fd, Buffer.alloc(1), 0, 1, null)).toThrow(/EBADF/u);
  });

  it('stops reading a pipe that carries far more than a token', () => {
    const fd = descriptorHolding(Buffer.alloc(1_000_000, 'a'));
    expect(() => readTransportTokenFrom(fd)).toThrow(/64 lowercase hex characters/u);
  });

  describe.skipIf(process.platform === 'win32')(
    'a descriptor the launcher did not hand over',
    () => {
      it('is refused when nothing is open at index 4', () => {
        // No such descriptor: a launcher that opened no extra pipe leaves the child nothing there.
        expect(() => readSupervisedTransportToken(987_654)).toThrow(
          /--supervised-transport-token-fd: descriptor 987654 could not be read \(EBADF\)/u,
        );
      });

      it('is refused, unread and left open, when it is not a pipe: a runtime without one has its own there', () => {
        const fd = descriptorHolding(TOKEN);
        expect(() => readSupervisedTransportToken(fd)).toThrow(
          /descriptor \d+ is not the pipe the launcher hands over the transport token on/u,
        );
        const buffer = Buffer.alloc(8);
        expect(readSync(fd, buffer, 0, 8, null)).toBe(8);
        closeSync(fd);
      });
    },
  );

  // Node 22's path resolution reads the file type a previous stat left in a buffer it shares with
  // `fstatSync`: a plain `fstatSync` of the pipe made the next module resolution stop following
  // links as soon as it reached a cached directory, so a pnpm-linked module loaded from its link
  // path and then found its own dependencies in the wrong place. Windows makes no such check.
  it.skipIf(process.platform === 'win32')(
    'leaves module resolution through pnpm links intact once the token is read',
    async () => {
      const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
      const fixture = fileURLToPath(new URL('./fixtures/supervised-token-then-resolve.ts', import.meta.url));
      const run = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          // Started as a launcher starts it: the token on an extra pipe at descriptor 4.
          const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
            // Where `tsx` resolves from.
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'pipe'],
          });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
          child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
          child.once('error', reject);
          child.once('close', (code) => resolve({ code, stdout, stderr }));
          const pipe = child.stdio[SUPERVISED_TRANSPORT_TOKEN_FD] as NodeJS.WritableStream;
          pipe.on('error', () => undefined);
          pipe.end(TOKEN);
        },
      );
      expect(run.stderr).toBe('');
      expect(run.code).toBe(0);
      const { resolved, realPath } = JSON.parse(run.stdout) as { resolved: string; realPath: string };
      expect(resolved).toBe(realPath);
    },
    30_000,
  );
});
