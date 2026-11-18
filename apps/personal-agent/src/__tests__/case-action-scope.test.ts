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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConnectorBook, createFileConnectorStore } from '@robota-sdk/agent-product/personal';

import { createCaseActionScope } from '../connectors/case-action-scope.js';

import type { ChildProcess } from 'node:child_process';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const parent = mkdtempSync(join(tmpdir(), 'personal-case-scope-'));
  directories.push(parent);
  const path = join(parent, 'scope');
  mkdirSync(path);
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
    await scope.exclusive(() => scope.initialize('connector-mail'));
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
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.set('connector-mail', 'send', true);
    const stored = join(root, 'connector-mail');
    const name = readdirSync(stored).find((file) => file.endsWith('.json'))!;
    writeFileSync(join(stored, name), JSON.stringify({ revision: 'invalid', tools: ['send'] }));
    await expect(scope.tools('connector-mail')).rejects.toThrow();
  });

  it('keeps the old state until a revocation is committed, then keeps it revoked', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
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
    await scope.exclusive(() => scope.initialize('connector-mail'));
    const old = scope.version('connector-mail', 'send');
    await scope.set('connector-mail', 'send', false);
    await expect(scope.set('connector-mail', 'send', true, old)).rejects.toThrow();
    expect(await scope.tools('connector-mail')).toEqual([]);
  });

  it('fails closed when an existing scope loses its state file', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.set('connector-mail', 'send', true);
    rmSync(join(root, 'connector-mail', 'scope.json'));
    await expect(scope.tools('connector-mail')).rejects.toThrow();
    expect(() => scope.version('connector-mail', 'send')).toThrow();
  });

  it('does not reuse an old revision if the entire scope directory disappears', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.set('connector-mail', 'send', true);
    const old = scope.version('connector-mail', 'send');
    rmSync(join(root, 'connector-mail'), { recursive: true });
    expect(() => scope.version('connector-mail', 'send')).toThrow();
    await expect(scope.set('connector-mail', 'send', true, old)).rejects.toThrow();
    expect(await scope.tools('connector-mail')).toEqual([]);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    expect(scope.version('connector-mail', 'send')).not.toBe(old);
    await expect(scope.set('connector-mail', 'send', true, old)).rejects.toThrow();
  });

  it('refuses admission against a missing scope even if another process resets it later', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
      const scope = createCaseActionScope(${JSON.stringify(root)});
      try {
        scope.version('connector-mail', 'send');
        process.send({ error: 'admitted an allow without an initialized scope' });
      } catch { process.send({ ready: true }); }
      await new Promise((resolve) => process.once('message', resolve));
      process.send({ finished: true });
    `;
    const child = spawn(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    try {
      await message(child);
      await scope.exclusive(() => scope.reset('connector-mail'));
      const finished = message(child);
      child.send!('continue');
      await finished;
      expect(await scope.tools('connector-mail')).toEqual([]);
    } finally {
      child.kill();
    }
  });

  it.skipIf(process.platform === 'win32')(
    'does not let a suspended holder overwrite a later block from another process',
    async () => {
      const root = directory();
      const scope = createCaseActionScope(join(root, 'scope'));
      const storeDirectory = join(root, 'connectors');
      const book = new ConnectorBook({ store: createFileConnectorStore(storeDirectory) });
      const connector = await book.create({
        title: 'Notes',
        kind: 'notes',
        protocol: 'mcp',
        endpoint: 'https://notes.example/mcp',
      });
      await book.decide(connector.id, 'send', 'write');
      const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
      const program = `
        import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
        import { createFileConnectorStore } from '@robota-sdk/agent-product/personal';
        const scope = createCaseActionScope(${JSON.stringify(join(root, 'scope'))});
        const store = createFileConnectorStore(${JSON.stringify(storeDirectory)});
        await scope.exclusive(async () => {
          const captured = await store.get(${JSON.stringify(connector.id)});
          process.send({ ready: true });
          await new Promise((resolve) => process.once('message', resolve));
          await store.put({ ...captured, attention: 'Ask me about trips' });
        });
        process.send({ finished: true });
      `;
      const child = spawn(
        process.execPath,
        ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
        { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
      );
      try {
        await message(child);
        child.kill('SIGSTOP');
        let entered = false;
        const blocking = scope.exclusive(async () => {
          entered = true;
          await book.decide(connector.id, 'send', 'blocked');
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(entered).toBe(false);
        const finished = message(child);
        child.kill('SIGCONT');
        child.send!('continue');
        await Promise.all([finished, blocking]);
        const updated = await book.existing(connector.id);
        expect(updated.decisions['send']).toBe('blocked');
        expect(updated.attention).toBe('Ask me about trips');
      } finally {
        child.kill('SIGCONT');
        child.kill();
      }
    },
    30_000,
  );

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'does not treat inaccessible settings as a successful revocation',
    async () => {
      const root = directory();
      const scope = createCaseActionScope(root);
      await scope.exclusive(() => scope.initialize('connector-mail'));
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
      await scope.exclusive(() => scope.initialize('connector-mail'));
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
      await scope.exclusive(() => scope.initialize('connector-mail'));
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
    await scope.exclusive(() => scope.initialize('connector-mail'));
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

  it('keeps the same lock when an addon from another Node version needs the built-in backend', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      const original = process.dlopen;
      process.dlopen = function (module, filename, flags) {
        if (filename.includes('better_sqlite3')) {
          const error = new Error('addon built for another Node version');
          error.code = 'ERR_DLOPEN_FAILED';
          throw error;
        }
        return original.call(this, module, filename, flags);
      };
      const { createCaseActionScope } = await import(${JSON.stringify(moduleUrl)});
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
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
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

  it.skipIf(process.platform === 'win32')(
    'uses the same process lock when a state directory has another path',
    async () => {
      const root = directory();
      const real = join(root, 'state');
      const alias = join(root, 'alias');
      const scope = createCaseActionScope(real);
      symlinkSync(real, alias, 'dir');
      const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
      const program = `
        import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
        const scope = createCaseActionScope(${JSON.stringify(alias)});
        await scope.exclusive(async () => {
          process.send({ ready: true });
          await new Promise((resolve) => process.once('message', resolve));
        });
        process.send({ released: true });
      `;
      const child = spawn(
        process.execPath,
        ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
        { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
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
    },
    30_000,
  );

  it('releases the settings lock when its process exits unexpectedly', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
      const scope = createCaseActionScope(${JSON.stringify(root)});
      setInterval(() => {}, 1000);
      await scope.exclusive(async () => {
        process.send({ ready: true });
        await new Promise(() => {});
      });
    `;
    const child = spawn(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    try {
      await message(child);
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      expect(child.kill()).toBe(true);
      await exited;
      await scope.exclusive(() => scope.initialize('connector-mail'));
      expect(scope.version('connector-mail', 'send')).toBeTruthy();
    } finally {
      child.kill();
    }
  }, 30_000);
});
