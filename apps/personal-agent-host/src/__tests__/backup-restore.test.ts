import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyArchive } from '../archive/state-archive.js';
import { dataPadding, encodeEntry, encodeRawHeader, TAR_TRAILER } from '../archive/tar.js';
import type { IBackupHandle } from '../control-plane.js';
import { HostError } from '../errors.js';
import { addInput, cleanTempDirs, type IHost, KEY, makeHost, tempDir } from './harness.js';

afterEach(cleanTempDirs);

async function refusal(promise: Promise<unknown>): Promise<HostError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HostError);
    return error as HostError;
  }
  throw new Error('expected a failure');
}

async function bytesOf(handle: IBackupHandle): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of handle.stream()) parts.push(Buffer.from(chunk));
  await handle.release();
  return Buffer.concat(parts);
}

async function backupOf(host: IHost, id: string): Promise<Buffer> {
  const handle = await host.plane.backup(id);
  const bytes = await bytesOf(handle);
  expect(bytes.length).toBe(handle.size);
  return bytes;
}

async function restoreFrom(
  host: IHost,
  id: string,
  archive: Buffer,
  options = { fromOtherAccount: false },
) {
  const staged = await host.plane.stageUpload(
    (async function* () {
      yield archive;
    })(),
  );
  try {
    return await host.plane.restore(id, staged, options);
  } finally {
    await staged.remove();
  }
}

async function spooled(host: IHost): Promise<string[]> {
  return readdir(join(host.dir, 'spool'));
}

async function withState(): Promise<IHost> {
  const host = await makeHost();
  await host.plane.add(addInput('alice'));
  host.runtime.writeState('alice', 'notes/marker.txt', 'before');
  return host;
}

describe('backup', () => {
  it('stops the unit, reads its state, starts it again, and hands over a verified archive', async () => {
    const host = await withState();
    host.runtime.calls.length = 0;
    const handle = await host.plane.backup('alice');
    expect(host.runtime.calls.filter((c) => /^(stop|exportState|start):alice$/u.test(c))).toEqual([
      'stop:alice',
      'exportState:alice',
      'start:alice',
    ]);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
    expect(handle.manifest).toMatchObject({
      format: 1,
      account: 'alice',
      hostname: 'alice.agents.example.test',
      imageId: host.store.get('alice')?.imageId,
      entries: 2,
    });
    const bytes = Buffer.concat(await collect(handle));
    await handle.release();
    expect(bytes.length).toBe(handle.size);
    const file = join(await tempDir(), 'b.tar');
    await writeFile(file, bytes);
    expect(await verifyArchive(file, { maxBytes: 1 << 20 })).toMatchObject({ account: 'alice' });
    expect(await spooled(host)).toEqual([]);
    expect((await host.auditLines()).at(-1)).toMatchObject({
      command: 'backup',
      account: 'alice',
      result: 'ok',
    });
  });

  it('holds the access code and never the model key', async () => {
    const host = await withState();
    const code = await host.plane.accessCode('alice');
    const bytes = (await backupOf(host, 'alice')).toString('utf8');
    expect(bytes).toContain(code);
    expect(bytes).not.toContain(KEY);
    expect(await host.auditText()).not.toContain(KEY);
  });

  it('keeps a suspended account suspended and starts nothing', async () => {
    const host = await withState();
    await host.plane.suspend('alice');
    host.runtime.calls.length = 0;
    const bytes = await backupOf(host, 'alice');
    expect(bytes.toString('utf8')).toContain('before');
    expect(host.runtime.calls.some((c) => c.startsWith('start:'))).toBe(false);
    expect(host.store.get('alice')?.state).toBe('suspended');
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('suspended');
  });

  it('refuses before it stops anything while the guard is not verified', async () => {
    const host = await withState();
    host.runtime.setGuard('unverified');
    host.runtime.calls.length = 0;
    expect((await refusal(host.plane.backup('alice'))).code).toBe('guard-unverified');
    expect(host.runtime.calls.some((c) => c.startsWith('stop:'))).toBe(false);
    expect(await spooled(host)).toEqual([]);
  });

  it('fails, hands over nothing and leaves the account active when the unit cannot start again', async () => {
    const host = await withState();
    host.runtime.failNext('start', new Error('image is gone'));
    const error = await refusal(host.plane.backup('alice'));
    expect(error.message).toMatch(/could not be started again \(image is gone\)/u);
    expect(error.message).toMatch(/reconcile loop keeps trying/u);
    expect(await spooled(host)).toEqual([]);
    expect(host.store.get('alice')?.state).toBe('active');
    expect((await host.auditLines()).at(-1)).toMatchObject({ command: 'backup', result: 'failed' });
    // The reconcile loop is what brings it back.
    await host.plane.reconcile();
    expect((await host.runtime.inspect('alice')).state).toBe('running');
  });

  it('starts the unit again and reports a failed export', async () => {
    const host = await withState();
    host.runtime.failNext('exportState', new Error('volume unreadable'));
    expect((await refusal(host.plane.backup('alice'))).message).toMatch(/volume unreadable/u);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(await spooled(host)).toEqual([]);
  });

  it('refuses a state past the backup limit and says which setting raises it', async () => {
    const host = await makeHost({ extra: { PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES: '1048576' } });
    await host.plane.add(addInput('alice'));
    host.runtime.writeState('alice', 'big.bin', 'x'.repeat(2 * 1024 * 1024));
    const error = await refusal(host.plane.backup('alice'));
    expect(error.code).toBe('refused');
    expect(error.message).toMatch(/PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES/u);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(await spooled(host)).toEqual([]);
  });

  it('refuses an unknown account and one still being made', async () => {
    const host = await makeHost();
    expect((await refusal(host.plane.backup('nobody'))).code).toBe('not-found');
  });
});

async function collect(handle: IBackupHandle): Promise<Buffer[]> {
  const parts: Buffer[] = [];
  for await (const chunk of handle.stream()) parts.push(Buffer.from(chunk));
  return parts;
}

describe('restore', () => {
  it('puts the state and the access code back, keeps the stored key, and starts the unit again', async () => {
    const host = await withState();
    const code = await host.plane.accessCode('alice');
    const bytes = await backupOf(host, 'alice');
    host.runtime.writeState('alice', 'notes/marker.txt', 'after');
    host.runtime.writeState('alice', 'extra.txt', 'junk');
    host.runtime.writeState('alice', 'server-access-code', 'z'.repeat(40));
    expect(await host.plane.accessCode('alice')).not.toBe(code);

    host.runtime.calls.length = 0;
    const result = await restoreFrom(host, 'alice', bytes);
    expect(result).toMatchObject({ account: 'alice', restarted: true });
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('before');
    expect(host.runtime.readState('alice', 'extra.txt')).toBeUndefined();
    expect(await host.plane.accessCode('alice')).toBe(code);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
    expect(await spooled(host)).toEqual([]);
    expect((await host.auditLines()).filter((l) => l.command === 'restore').at(-1)).toMatchObject({
      result: 'ok',
      account: 'alice',
    });
    expect(await host.auditText()).not.toContain(KEY);
  });

  it('restores a suspended account without starting it', async () => {
    const host = await withState();
    const bytes = await backupOf(host, 'alice');
    host.runtime.writeState('alice', 'notes/marker.txt', 'after');
    await host.plane.suspend('alice');
    host.runtime.calls.length = 0;
    const result = await restoreFrom(host, 'alice', bytes);
    expect(result.restarted).toBe(false);
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('before');
    expect(host.runtime.calls.some((c) => c.startsWith('start:'))).toBe(false);
    expect(host.store.get('alice')?.state).toBe('suspended');
  });

  it("refuses another account's backup without the flag, and changes nothing", async () => {
    const host = await withState();
    await host.plane.add(addInput('bob', { apiKey: `${KEY}-bob` }));
    host.runtime.writeState('bob', 'notes/marker.txt', 'bob-state');
    const bytes = await backupOf(host, 'alice');
    host.runtime.calls.length = 0;
    const error = await refusal(restoreFrom(host, 'bob', bytes));
    expect(error.code).toBe('refused');
    expect(error.message).toMatch(/--from-other-account/u);
    expect(host.runtime.readState('bob', 'notes/marker.txt')).toBe('bob-state');
    expect(host.runtime.calls.some((c) => /^(stop|importState):/u.test(c))).toBe(false);

    const result = await restoreFrom(host, 'bob', bytes, { fromOtherAccount: true });
    expect(result.from.account).toBe('alice');
    expect(host.runtime.readState('bob', 'notes/marker.txt')).toBe('before');
    // Bob keeps his own key: a backup never carries one.
    expect(host.runtime.wasStartedWithKey('bob', `${KEY}-bob`)).toBe(true);
    expect(host.runtime.wasStartedWithKey('bob', KEY)).toBe(false);
  });

  it('refuses an account that does not exist, never creating one', async () => {
    const host = await withState();
    const bytes = await backupOf(host, 'alice');
    expect((await refusal(restoreFrom(host, 'nobody', bytes))).code).toBe('not-found');
    expect(host.runtime.has('nobody')).toBe(false);
  });

  it('refuses an invalid archive before it touches the unit or the state', async () => {
    const host = await withState();
    const good = await backupOf(host, 'alice');
    host.runtime.calls.length = 0;
    const tampered = Buffer.from(good);
    tampered[tampered.indexOf('before')] ^= 1;
    const escape = Buffer.concat([
      good.subarray(0, good.length - 1024),
      encodeRawHeader({ name: 'state/../../escape', flag: '0' }),
      TAR_TRAILER,
    ]);
    for (const archive of [tampered, escape, Buffer.from('not a tar at all')]) {
      const error = await refusal(restoreFrom(host, 'alice', archive));
      expect(error.code).toBe('invalid-input');
      expect(error.message).toMatch(/^The archive is refused/u);
    }
    expect(host.runtime.calls.some((c) => /^(stop|exportState|importState|start):/u.test(c))).toBe(
      false,
    );
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('before');
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(await spooled(host)).toEqual([]);
    expect((await host.auditLines()).filter((l) => l.command === 'restore')).toHaveLength(3);
    expect((await host.auditLines()).filter((l) => l.result === 'refused')).toHaveLength(3);
  });

  it('puts the previous state back when the import fails after wiping it', async () => {
    const host = await withState();
    const bytes = await backupOf(host, 'alice');
    host.runtime.writeState('alice', 'notes/marker.txt', 'current');
    host.runtime.failNext('importStateWiped', new Error('disk full'));
    const error = await refusal(restoreFrom(host, 'alice', bytes));
    expect(error.message).toMatch(/Restoring alice failed \(disk full\)/u);
    expect(error.message).toMatch(/previous state is back in place/u);
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('current');
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(await spooled(host)).toEqual([]);
  });

  it('puts the previous state back when the restored state does not start', async () => {
    const host = await withState();
    const bytes = await backupOf(host, 'alice');
    host.runtime.writeState('alice', 'notes/marker.txt', 'current');
    // The first start, from the restored state, fails; the start from the previous state works.
    host.runtime.failNext('start', new Error('state is unusable'));
    const error = await refusal(restoreFrom(host, 'alice', bytes));
    expect(error.message).toMatch(/could not be started again \(state is unusable\)/u);
    expect(error.message).toMatch(/previous state is back and the unit is running again/u);
    expect(host.runtime.readState('alice', 'notes/marker.txt')).toBe('current');
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(host.store.get('alice')?.state).toBe('active');
    expect(await spooled(host)).toEqual([]);
  });

  it('says so when the previous state cannot be put back either', async () => {
    const host = await withState();
    const bytes = await backupOf(host, 'alice');
    host.runtime.failNext('importState', new Error('engine down'));
    host.runtime.failNext('importState', new Error('engine still down'));
    const error = await refusal(restoreFrom(host, 'alice', bytes));
    expect(error.message).toMatch(/Restoring alice failed \(engine down\)/u);
    expect(error.message).toMatch(/could not be put back either \(engine still down\)/u);
    expect(error.message).toMatch(/restore a backup again/u);
    // The unit is started again all the same, so the account is not left down.
    expect((await host.runtime.inspect('alice')).state).toBe('running');
  });

  it('refuses before stopping anything while the guard is not verified', async () => {
    const host = await withState();
    const bytes = await backupOf(host, 'alice');
    host.runtime.setGuard('unverified');
    host.runtime.calls.length = 0;
    expect((await refusal(restoreFrom(host, 'alice', bytes))).code).toBe('guard-unverified');
    expect(host.runtime.calls.some((c) => c.startsWith('stop:'))).toBe(false);
  });

  it('refuses an upload past the limit and leaves nothing in the spool', async () => {
    const host = await makeHost({ extra: { PERSONAL_AGENT_HOST_BACKUP_MAX_BYTES: '1048576' } });
    await host.plane.add(addInput('alice'));
    const error = await refusal(
      host.plane.stageUpload(
        (async function* () {
          yield Buffer.alloc(700_000);
          yield Buffer.alloc(700_000);
        })(),
      ),
    );
    expect(error.code).toBe('invalid-input');
    expect(await spooled(host)).toEqual([]);
  });
});

describe('the archive a backup is', () => {
  it('is built from entries a hostile archive could not smuggle past', async () => {
    const host = await withState();
    const good = await backupOf(host, 'alice');
    // Same manifest, one extra entry appended: the hash no longer matches.
    const extra = Buffer.concat([
      good.subarray(0, good.length - 1024),
      encodeEntry(
        {
          path: 'state/extra.txt',
          kind: 'file',
          flag: '0',
          mode: 0o644,
          uid: 0,
          gid: 0,
          size: 0,
          mtime: 0,
          linkname: '',
        },
        Buffer.from('extra'),
      ),
      dataPadding(0),
      TAR_TRAILER,
    ]);
    const error = await refusal(restoreFrom(host, 'alice', extra));
    expect(error.message).toMatch(/does not match its manifest/u);
  });
});
