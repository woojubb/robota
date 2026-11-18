import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
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

  it('reports a malformed revision rather than treating the scope as healthy', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.set('connector-mail', 'send', true);
    const stored = join(root, 'connector-mail');
    const name = readdirSync(stored).find((file) => file.endsWith('.json'))!;
    writeFileSync(join(stored, name), JSON.stringify({ revision: 'invalid', tools: ['send'] }));
    await expect(scope.tools('connector-mail')).rejects.toThrow();
  });

  it('keeps the old state until a revocation is committed, then keeps it revoked', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.set('connector-mail', 'send', true);
    const stored = join(root, 'connector-mail');
    expect(await scope.tools('connector-mail')).toEqual(['send']);
    const pending = join(stored, '.interrupted.tmp');
    writeFileSync(pending, JSON.stringify({ revision: randomUUID(), tools: [] }));
    expect(await scope.tools('connector-mail')).toEqual(['send']);
    renameSync(pending, join(stored, 'scope.json'));
    expect(await scope.tools('connector-mail')).toEqual([]);
  });

  it('does not activate an old grant written after a newer revocation', async () => {
    const scope = createCaseActionScope(directory());
    const old = scope.version('connector-mail', 'send');
    await scope.set('connector-mail', 'send', false);
    await expect(scope.set('connector-mail', 'send', true, old)).rejects.toThrow();
    expect(await scope.tools('connector-mail')).toEqual([]);
  });

  it('fails closed when an existing scope loses its state file', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.set('connector-mail', 'send', true);
    rmSync(join(root, 'connector-mail', 'scope.json'));
    await expect(scope.tools('connector-mail')).rejects.toThrow();
    expect(() => scope.version('connector-mail', 'send')).toThrow();
  });

  it('does not reuse an old revision if the entire scope directory disappears', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.set('connector-mail', 'send', true);
    const old = scope.version('connector-mail', 'send');
    rmSync(join(root, 'connector-mail'), { recursive: true });
    expect(scope.version('connector-mail', 'send')).not.toBe(old);
    await expect(scope.set('connector-mail', 'send', true, old)).rejects.toThrow();
    expect(await scope.tools('connector-mail')).toEqual([]);
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

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps the original settings if a reset cannot commit its new generation',
    async () => {
      const root = directory();
      const scope = createCaseActionScope(root);
      await scope.set('connector-mail', 'send', true);
      const before = scope.version('connector-mail', 'send');
      const stored = join(root, 'connector-mail');
      chmodSync(stored, 0o500);
      try {
        await expect(scope.reset('connector-mail')).rejects.toThrow();
      } finally {
        chmodSync(stored, 0o700);
      }
      expect(scope.version('connector-mail', 'send')).toEqual(before);
      expect(await scope.tools('connector-mail')).toEqual(['send']);
    },
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'retains reset invalidation when later cleanup cannot finish',
    async () => {
      const root = directory();
      const scope = createCaseActionScope(root);
      await scope.set('connector-mail', 'send', true);
      const before = scope.version('connector-mail', 'send');
      const stored = join(root, 'connector-mail');
      const stuck = join(stored, 'stuck');
      mkdirSync(stuck);
      writeFileSync(join(stuck, 'file'), 'fixture');
      chmodSync(stuck, 0o500);
      try {
        await expect(scope.reset('connector-mail')).rejects.toThrow();
      } finally {
        chmodSync(stuck, 0o700);
      }
      rmSync(stuck, { recursive: true, force: true });
      expect(scope.version('connector-mail', 'send')).not.toBe(before);
      expect(await scope.tools('connector-mail')).toEqual([]);
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
        try { await scope.exclusive(() => scope.set('connector-mail', tool, allowed)); process.send({ ok: true }); }
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

  it('holds connector setting changes across processes', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
      const scope = createCaseActionScope(${JSON.stringify(root)});
      await scope.exclusive(async () => {
        process.send({ ready: true });
        await new Promise((resolve) => process.once('message', resolve));
      });
      process.send({ released: true });
    `;
    const child = spawn(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
      {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      },
    );
    try {
      await message(child);
      let entered = false;
      const waiting = scope.exclusive(async () => {
        entered = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(entered).toBe(false);
      const released = message(child);
      child.send!('release');
      await Promise.all([released, waiting]);
      expect(entered).toBe(true);
    } finally {
      child.kill();
    }
  }, 30_000);
});
