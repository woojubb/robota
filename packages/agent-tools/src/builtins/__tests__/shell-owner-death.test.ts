import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const isPosix = process.platform === 'linux' || process.platform === 'darwin';

function running(pid: number): boolean {
  try {
    const state = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).trim();
    return state.length > 0 && !state.startsWith('Z');
  } catch {
    return false;
  }
}

describe.runIf(isPosix)('foreground shell owner death', () => {
  it.each(['SIGKILL', 'SIGINT', 'SIGTERM'] as const)(
    'reaps its owned process group after %s reaches the CLI owner',
    async (signal) => {
      const dir = mkdtempSync(join(tmpdir(), 'shell-owner-death-'));
      const groupFile = join(dir, 'group.pid');
      const childFile = join(dir, 'child.pid');
      const marker = join(dir, 'marker');
      const command = `echo $$ > '${groupFile}'; printf 'once\\n' >> '${marker}'; sleep 60 & echo $! > '${childFile}'; wait`;
      const source = `import { createShellTool } from './dist/node/index.js'; await createShellTool({ cwd: ${JSON.stringify(dir)} }).execute({ command: ${JSON.stringify(command)} });`;
      const owner = spawn(process.execPath, ['--input-type=module', '-e', source], {
        cwd: ROOT, detached: true, stdio: 'ignore',
      });
      let group = 0;
      try {
        await vi.waitFor(() => {
          expect(existsSync(marker)).toBe(true);
          expect(existsSync(groupFile)).toBe(true);
          expect(existsSync(childFile)).toBe(true);
        }, { timeout: 8_000, interval: 20 });
        group = Number(readFileSync(groupFile, 'utf8'));
        const child = Number(readFileSync(childFile, 'utf8'));
        expect(running(group)).toBe(true);
        expect(running(child)).toBe(true);
        process.kill(-owner.pid!, signal);
        await vi.waitFor(() => {
          expect(running(group)).toBe(false);
          expect(running(child)).toBe(false);
        }, { timeout: 7_000, interval: 100 });
        expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['once']);
      } finally {
        try { process.kill(-owner.pid!, 'SIGKILL'); } catch { /* already gone */ }
        if (group > 0) try { process.kill(-group, 'SIGKILL'); } catch { /* already gone */ }
        rmSync(dir, { recursive: true, force: true });
      }
    },
    20_000,
  );
});
