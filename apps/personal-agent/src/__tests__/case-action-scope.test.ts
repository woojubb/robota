import { spawn } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCaseActionScope } from '../connectors/case-action-scope.js';

import type { ChildProcess } from 'node:child_process';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const path = mkdtempSync(join(tmpdir(), 'personal-case-scope-'));
  directories.push(path);
  return path;
}

function message(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.off('message', received);
      child.off('exit', exited);
      child.off('error', failed);
    };
    const received = (value: unknown): void => {
      cleanup();
      if (typeof value === 'object' && value !== null && 'error' in value) {
        reject(new Error(String(value.error)));
      } else resolve();
    };
    const exited = (code: number | null): void => {
      cleanup();
      reject(new Error(`scope worker exited with ${code}`));
    };
    const failed = (error: Error): void => {
      cleanup();
      reject(error);
    };
    child.once('message', received);
    child.once('exit', exited);
    child.once('error', failed);
  });
}

describe('the owner’s case action scope', () => {
  it('starts empty, preserves simultaneous choices, and persists only for that connector', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    expect(await scope.tools('connector-mail')).toEqual([]);
    await Promise.all([
      scope.set('connector-mail', 'send', true),
      scope.set('connector-mail', 'draft', true),
    ]);
    const restarted = createCaseActionScope(root);
    expect([...(await restarted.tools('connector-mail'))].sort()).toEqual(['draft', 'send']);
    expect(await restarted.tools('connector-other')).toEqual([]);
    const stored = readdirSync(join(root, 'connector-mail')).find((name) => name.endsWith('.json'));
    expect(statSync(join(root, 'connector-mail', stored!)).mode & 0o077).toBe(0);
    await restarted.set('connector-mail', 'send', false);
    expect(await restarted.tools('connector-mail')).toEqual(['draft']);
    await restarted.clear('connector-mail');
    expect(await restarted.tools('connector-mail')).toEqual([]);
  });

  it('fails closed on malformed scope and unsafe identifiers', async () => {
    const root = directory();
    mkdirSync(join(root, 'connector-mail'));
    writeFileSync(join(root, 'connector-mail', 'bad.json'), '{"tool":7}');
    const scope = createCaseActionScope(root);
    await expect(scope.tools('connector-mail')).rejects.toThrow();
    await expect(scope.set('connector-mail', 'send', true)).rejects.toThrow();
    await expect(scope.tools('../outside')).rejects.toThrow();
    await expect(scope.set('connector-other', '', true)).rejects.toThrow();
    await expect(scope.set('connector-other', 'x'.repeat(129), true)).rejects.toThrow();
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'does not treat inaccessible settings as a successful revocation',
    async () => {
      const root = directory();
      const scope = createCaseActionScope(root);
      await scope.set('connector-mail', 'send', true);
      const stored = join(root, 'connector-mail');
      chmodSync(stored, 0o000);
      try {
        await expect(scope.tools('connector-mail')).rejects.toThrow();
        await expect(scope.set('connector-mail', 'send', false)).rejects.toThrow();
      } finally {
        chmodSync(stored, 0o700);
      }
      expect(await scope.tools('connector-mail')).toEqual(['send']);
    },
  );

  it('does not restore a revoked tool when another process allows a different one', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
      const scope = createCaseActionScope(${JSON.stringify(root)});
      process.on('message', async ({ tool, allowed }) => {
        try { await scope.set('connector-mail', tool, allowed); process.send({ ok: true }); }
        catch (error) { process.send({ error: String(error) }); }
      });
      process.send({ ready: true });
    `;
    const start = (): ChildProcess =>
      spawn(
        process.execPath,
        ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
        {
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        },
      );
    const first = start();
    const firstReady = message(first);
    const second = start();
    const secondReady = message(second);
    try {
      await Promise.all([firstReady, secondReady]);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await scope.set('connector-mail', 'send', true);
        await scope.set('connector-mail', 'draft', false);
        const firstDone = message(first);
        const secondDone = message(second);
        first.send!({ tool: 'send', allowed: false });
        second.send!({ tool: 'draft', allowed: true });
        await Promise.all([firstDone, secondDone]);
        expect(await scope.tools('connector-mail')).toEqual(['draft']);
      }
    } finally {
      first.kill();
      second.kill();
    }
  }, 30_000);
});
