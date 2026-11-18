import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
  it('serializes a connection change with the final dispatch handoff', () => {
    const root = directory();
    const first = createCaseActionScope(root);
    const second = createCaseActionScope(root);
    first.withDispatch('connector-mail', () => {
      expect(() => second.beginDisconnect('connector-mail')).toThrow(/starting an action/u);
    });
    const transition = second.beginDisconnect('connector-mail');
    transition.complete();
    transition.release();
    expect(() => first.snapshot('connector-mail')).toThrow(/disconnecting/u);
  });

  it('keeps a fallback transition closed after the primary marker location recovers', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const before = scope.snapshot('connector-mail');
    const transitions = join(dirname(root), '.scope-transitions');
    writeFileSync(transitions, 'unavailable');
    try {
      const change = scope.beginDisconnect('connector-mail');
      change.complete();
      change.release();
      rmSync(transitions);
      expect(() => scope.snapshot('connector-mail')).toThrow(/disconnecting/u);
      await scope.exclusive(() => scope.settleDisconnects('connector-mail', true));
      const after = scope.snapshot('connector-mail');
      expect(after.generation).not.toBe(before.generation);
      expect(after.tools).toEqual([]);
    } finally {
      rmSync(transitions, { force: true });
    }
  });

  it('cleans a partially created primary marker before using the fallback', async () => {
    if (process.platform === 'win32') return;
    const root = directory();
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const sync = fs.fsyncSync;
      let fail = false;
      fs.fsyncSync = fd => {
        if (fail) { fail = false; throw Object.assign(new Error('sync failed'), { code: 'EIO' }); }
        return sync(fd);
      };
      syncBuiltinESMExports();
      const { createCaseActionScope } = await import(${JSON.stringify(moduleUrl)});
      const scope = createCaseActionScope(${JSON.stringify(root)});
      await scope.exclusive(() => scope.initialize('connector-mail'));
      await scope.exclusive(() => scope.set('connector-mail', 'send', true));
      fail = true;
      const transition = scope.beginDisconnect('connector-mail');
      transition.complete();
      transition.release();
      await scope.exclusive(() => scope.settleDisconnects('connector-mail', true));
      fs.writeSync(1, JSON.stringify(scope.snapshot('connector-mail').tools));
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', program],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let errors = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('exit', resolve);
      child.once('error', reject);
    });
    expect(code, errors).toBe(0);
    expect(JSON.parse(output)).toEqual([]);
  }, 15_000);

  it('keeps authority stable when an unchanged scope is fenced', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const before = scope.snapshot('connector-mail');
    await scope.exclusive(() => scope.fence('connector-mail', before.revision));
    const after = createCaseActionScope(root).snapshot('connector-mail');
    expect(after.revision).not.toBe(before.revision);
    expect(after.generation).toBe(before.generation);
    expect(after.tools).toEqual(['send']);
  });

  it('does not restore an earlier authority generation after revoke and regrant', async () => {
    const scope = createCaseActionScope(directory());
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const allowed = scope.snapshot('connector-mail');
    await scope.exclusive(() => scope.set('connector-mail', 'send', false));
    const revoked = scope.snapshot('connector-mail');
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const reallowed = scope.snapshot('connector-mail');
    expect(revoked.generation).not.toBe(allowed.generation);
    expect(reallowed.generation).not.toBe(allowed.generation);
    expect(reallowed.generation).not.toBe(revoked.generation);
    expect(reallowed.tools).toEqual(allowed.tools);
    await scope.exclusive(() => scope.reset('connector-mail'));
    expect(scope.snapshot('connector-mail').generation).not.toBe(reallowed.generation);
  });

  it('preserves prior authority when a staged allow is canceled', async () => {
    const scope = createCaseActionScope(directory());
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const before = scope.snapshot('connector-mail');
    const staged = await scope.exclusive(async () =>
      scope.stageAllow('connector-mail', 'delete', before.revision),
    );
    await expect(scope.tools('connector-mail')).rejects.toThrow(/recovery/u);
    await scope.exclusive(() => scope.fence('connector-mail', before.revision));
    const restored = scope.snapshot('connector-mail');
    expect(restored.generation).toBe(before.generation);
    expect(restored.tools).toEqual(before.tools);
    await expect(
      scope.exclusive(async () => scope.finishAllow('connector-mail', staged, true)),
    ).rejects.toThrow();
  });

  it('invalidates prior authority when a connection change settles', async () => {
    const scope = createCaseActionScope(directory());
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const before = scope.snapshot('connector-mail');
    const transition = scope.beginDisconnect('connector-mail');
    transition.complete();
    transition.release();
    await scope.exclusive(() => scope.settleDisconnects('connector-mail'));
    const after = scope.snapshot('connector-mail');
    expect(after.generation).not.toBe(before.generation);
    expect(after.tools).toEqual(before.tools);
  });

  it('upgrades an older scope without changing its authority on a fence', async () => {
    const root = directory();
    const id = 'connector-mail';
    const revision = randomUUID();
    mkdirSync(join(root, id));
    writeFileSync(join(root, id, 'scope.json'), JSON.stringify({ revision, tools: ['send'] }));
    const scope = createCaseActionScope(root);
    expect(scope.snapshot(id).generation).toBe(revision);
    await scope.exclusive(() => scope.fence(id, revision));
    const reopened = createCaseActionScope(root).snapshot(id);
    expect(reopened.revision).not.toBe(revision);
    expect(reopened.generation).toBe(revision);
    writeFileSync(
      join(root, id, 'scope.json'),
      JSON.stringify({ revision, generation: 'invalid', tools: ['send'] }),
    );
    await expect(scope.tools(id)).rejects.toThrow(/cannot be read/u);
  });

  it('keeps settings closed until a legacy lock is migrated offline', async () => {
    const root = directory();
    const legacy = join(dirname(root), '.scope-connector-settings.sqlite');
    writeFileSync(legacy, 'legacy lock');
    const scope = createCaseActionScope(root);
    await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
      /offline migration/u,
    );
    await expect(scope.tools('connector-mail')).rejects.toThrow(/offline migration/u);
    expect(readFileSync(legacy, 'utf8')).toBe('legacy lock');

    // The owner must stop every old agent before moving the legacy lock aside.
    renameSync(legacy, `${legacy}.backup`);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    expect(await scope.tools('connector-mail')).toEqual([]);
    expect(statSync(legacy).isDirectory()).toBe(true);
    expect(() => openSync(legacy, 'a')).toThrow();
  });

  it('does not cancel a newer pending allow with an older conditional fence', async () => {
    const scope = createCaseActionScope(directory());
    await scope.exclusive(() => scope.initialize('connector-mail'));
    const old = scope.version('connector-mail', 'send');
    await scope.exclusive(() => scope.set('connector-mail', 'other', false));
    const current = scope.version('connector-mail', 'send');
    const staged = await scope.exclusive(async () =>
      scope.stageAllow('connector-mail', 'send', current),
    );
    await scope.exclusive(() => scope.fence('connector-mail', old));
    expect(scope.pendingSnapshot('connector-mail')?.revision).toBe(current);
    await scope.exclusive(async () => scope.finishAllow('connector-mail', staged, true));
    expect(await scope.tools('connector-mail')).toEqual(['send']);
  });

  it('does not recover an active allow on a read, but lets a revoke cancel it', async () => {
    const scope = createCaseActionScope(directory());
    await scope.exclusive(() => scope.initialize('connector-mail'));
    const revision = scope.version('connector-mail', 'send');
    const active = await scope.exclusive(async () =>
      scope.stageAllow('connector-mail', 'send', revision),
    );
    await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
      /progress/u,
    );
    await scope.exclusive(() => scope.set('connector-mail', 'send', false));
    await expect(
      scope.exclusive(async () => scope.finishAllow('connector-mail', active, true)),
    ).rejects.toThrow();
    expect(await scope.tools('connector-mail')).toEqual([]);
    const retry = await scope.exclusive(async () =>
      scope.stageAllow('connector-mail', 'send', scope.version('connector-mail', 'send')),
    );
    await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
      /progress/u,
    );
    await scope.exclusive(async () => scope.finishAllow('connector-mail', retry, true));
    expect(await scope.tools('connector-mail')).toEqual(['send']);
  });

  it.each(['before-write', 'after-write', 'during-recovery'] as const)(
    'recovers an interrupted allow %s without restoring it',
    async (stage) => {
      const root = directory();
      const scope = createCaseActionScope(root);
      await scope.exclusive(() => scope.initialize('connector-mail'));
      const previous = scope.snapshot('connector-mail');
      const next = randomUUID();
      const recovery = randomUUID();
      const dir = join(root, 'connector-mail');
      writeFileSync(join(dir, 'pending-allow.json'), JSON.stringify({ previous, next, recovery }));
      if (stage !== 'before-write') {
        writeFileSync(
          join(dir, 'scope.json'),
          JSON.stringify({
            revision: stage === 'after-write' ? next : recovery,
            tools: stage === 'after-write' ? ['send'] : previous.tools,
          }),
        );
      }
      await expect(scope.tools('connector-mail')).rejects.toThrow(/recovery/u);
      const transition = scope.beginDisconnect('connector-mail');
      transition.complete();
      transition.release();
      await scope.exclusive(() => scope.fence('connector-mail', previous.revision));
      await scope.exclusive(() => scope.initialize('connector-mail'));
      expect(await scope.tools('connector-mail')).toEqual([]);
      expect(scope.version('connector-mail', 'send')).not.toBe(previous.revision);
    },
  );

  it('rolls back an allow if its process dies after the scope write', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    const revision = scope.version('connector-mail', 'send');
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.renameSync;
      fs.renameSync = (source, target) => {
        rename(source, target);
        if (String(target).endsWith('/scope.json')) {
          fs.writeSync(1, 'written\\n');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
      };
      syncBuiltinESMExports();
      const { createCaseActionScope } = await import(${JSON.stringify(moduleUrl)});
      const scope = createCaseActionScope(${JSON.stringify(root)});
      await scope.exclusive(async () => scope.stageAllow('connector-mail', 'send', ${JSON.stringify(revision)}));
    `;
    const child = spawn(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout!.once('data', () => resolve());
        child.once('exit', (code) => reject(new Error(`scope writer exited with ${code}`)));
      });
      const transition = scope.beginDisconnect('connector-mail');
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      transition.complete();
      transition.release();
      await scope.exclusive(() => scope.fence('connector-mail', revision));
      await scope.exclusive(() => scope.initialize('connector-mail'));
      expect(await scope.tools('connector-mail')).toEqual([]);
      expect(scope.version('connector-mail', 'send')).not.toBe(revision);
    } finally {
      child.kill();
    }
  }, 15_000);

  it('keeps authority closed during disconnect and fences older requests after it ends', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    await scope.exclusive(() => scope.set('connector-mail', 'send', true));
    const before = scope.version('connector-mail', 'send');
    const transition = scope.beginDisconnect('connector-mail');
    try {
      await expect(scope.tools('connector-mail')).rejects.toThrow(/disconnecting/u);
      await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
        /progress|interrupted/u,
      );
      expect(await scope.tools('connector-other')).toEqual([]);
      await scope.exclusive(() => scope.set('connector-mail', 'send', false));
    } finally {
      transition.complete();
      transition.release();
    }
    const restarted = createCaseActionScope(root);
    await restarted.exclusive(() => restarted.initialize('connector-mail'));
    expect(await restarted.tools('connector-mail')).toEqual([]);
    expect(restarted.version('connector-mail', 'send')).not.toBe(before);
    await expect(
      restarted.exclusive(() => restarted.set('connector-mail', 'send', true, before)),
    ).rejects.toThrow();
  });

  it('settles completed changes and requires a new disconnect for interrupted ones', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    const before = scope.version('connector-mail', 'send');
    const done = scope.beginDisconnect('connector-mail');
    done.complete();
    done.release();
    await expect(scope.tools('connector-mail')).rejects.toThrow(/disconnecting/u);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    expect(scope.version('connector-mail', 'send')).not.toBe(before);
    const unfinished = scope.beginDisconnect('connector-mail');
    unfinished.release();
    await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
      /interrupted/u,
    );
    await scope.exclusive(() => scope.settleDisconnects('connector-mail', true));
    expect(await scope.tools('connector-mail')).toEqual([]);
  });

  it('fences an interrupted disconnect after the holding process exits', async () => {
    const root = directory();
    const scope = createCaseActionScope(root);
    await scope.exclusive(() => scope.initialize('connector-mail'));
    const before = scope.version('connector-mail', 'send');
    const moduleUrl = new URL('../connectors/case-action-scope.ts', import.meta.url).href;
    const program = `
      import { createCaseActionScope } from ${JSON.stringify(moduleUrl)};
      createCaseActionScope(${JSON.stringify(root)}).beginDisconnect('connector-mail');
      process.send({ ready: true });
      await new Promise(() => {});
    `;
    const child = spawn(
      process.execPath,
      ['--conditions=source', '--import', 'tsx', '--input-type=module', '-e', program],
      { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
    );
    try {
      await message(child);
      await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
        /progress|interrupted/u,
      );
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await exited;
      await expect(scope.exclusive(() => scope.initialize('connector-mail'))).rejects.toThrow(
        /interrupted/u,
      );
      await scope.exclusive(() => scope.settleDisconnects('connector-mail', true));
      expect(scope.version('connector-mail', 'send')).not.toBe(before);
      expect(await scope.tools('connector-mail')).toEqual([]);
    } finally {
      child.kill();
    }
  }, 15_000);

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
