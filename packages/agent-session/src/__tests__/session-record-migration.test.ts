/**
 * Sealing a host-filesystem session store's plain records in place (secure conversation): the
 * raw bytes of every plain record sealed under its stem, so the store reports the same status after
 * opening them; what is already sealed, or sealed so it does not open here, left as it is; a replace
 * made only while the file still holds what was read; and planning writes nothing.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import { createProcessOperationLock } from '@robota-sdk/agent-node-lock';
import { afterEach, describe, expect, it } from 'vitest';

import { SESSION_RECORD_ENVELOPE_VERSION } from '../session-record-codec/index.js';
import {
  migrateNodeSessionStore,
  readSessionStoreWorkingDirectories,
} from '../session-record-migration.js';
import { NodeSessionStore } from '../session-store.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-4b8d-typed-before-sealing';
const onWindows = process.platform === 'win32';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'session-record-migration-')));
  roots.push(root);
  return root;
}

function record(id: string, cwd = '/work'): IInteractiveSessionRecord {
  return {
    id,
    cwd,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: `${CANARY} ${id}`,
        timestamp: new Date('2026-11-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

const envelope = (value: unknown, schemaVersion: unknown = SESSION_RECORD_ENVELOPE_VERSION) =>
  JSON.stringify({ schemaVersion, record: value }, null, 2);

/** A plain store as builds before sealing left it: one record of each status the store reports. */
function seedPlainStore(dir: string): void {
  new NodeSessionStore(dir, { sealing: 'plain' }).save(record('valid_one'));
  writeFileSync(join(dir, 'corrupt_one.json'), `{"schemaVersion":1,"record":"${CANARY}`);
  writeFileSync(
    join(dir, 'unsupported_one.json'),
    envelope({ id: 'unsupported_one', note: CANARY }, 99),
  );
  writeFileSync(join(dir, 'bare_one.json'), JSON.stringify(record('bare_one')));
}

const IDS = ['bare_one', 'corrupt_one', 'unsupported_one', 'valid_one'];

/** What a store sealing with `sealer` reports for each id; a plain store and a sealed one must agree. */
/**
 * What a store that seals reports for each record, without the digest of the stored bytes, which
 * sealing changes by design. Whose a record is stays: a migration seals plaintext any program of the
 * user could have written, so a migrated record is as unverified as the plain one was.
 */
function statuses(dir: string, sealer: IArtifactSealer): Record<string, unknown> {
  const store = new NodeSessionStore(dir, { sealing: { sealer } });
  return Object.fromEntries(
    IDS.map((id) => {
      const outcome = store.load(id);
      if (outcome.status !== 'valid') return [id, outcome];
      const { digest: _digest, ...rest } = outcome;
      return [id, rest];
    }),
  );
}

function filesWithCanary(dir: string): string[] {
  // The claims directory beside the records holds the writer markers, not records.
  return readdirSync(dir).filter(
    (name) => name !== 'claims' && readFileSync(join(dir, name)).includes(Buffer.from(CANARY)),
  );
}

describe('migrateNodeSessionStore', () => {
  it('names each valid record it sealed by the digest of the bytes it put in place, and nothing else', () => {
    const dir = directory();
    seedPlainStore(dir);
    const sealer = createTestArtifactSealer();

    const planned = migrateNodeSessionStore(dir, { sealer, apply: false });
    const applied = migrateNodeSessionStore(dir, { sealer, apply: true });

    expect(planned.sealedRecords).toEqual([]);
    const digestOf = (id: string): string =>
      createHash('sha256')
        .update(readFileSync(join(dir, `${id}.json`)))
        .digest('hex');
    expect([...(applied.sealedRecords ?? [])].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      // A bare record from before the envelope reads as unsupported, so it is no session to accept.
      [{ id: 'valid_one', digest: digestOf('valid_one') }],
    );
    expect(migrateNodeSessionStore(dir, { sealer, apply: true }).sealedRecords).toEqual([]);
  });

  it('seals the raw bytes of every plain record, so each reports the status it had', () => {
    const dir = directory();
    seedPlainStore(dir);
    const sealer = createTestArtifactSealer();
    const before = statuses(dir, sealer);

    const result = migrateNodeSessionStore(dir, { sealer, apply: true });

    expect(result).toMatchObject({ sealed: 4, alreadySealed: 0, unopenable: [], changed: [] });
    expect(filesWithCanary(dir)).toEqual([]);
    for (const id of IDS) {
      expect(
        readFileSync(join(dir, `${id}.json`))
          .subarray(0, 4)
          .toString('ascii'),
      ).toBe('RSL1');
    }
    expect(statuses(dir, sealer)).toEqual(before);
    expect(before.valid_one).toMatchObject({ status: 'valid', authorship: 'unverified' });
    expect((before.corrupt_one as { status: string }).status).toBe('corrupt');
    expect((before.unsupported_one as { status: string }).status).toBe('unsupported');
    if (!onWindows) {
      expect(statSync(join(dir, 'valid_one.json')).mode & 0o777).toBe(0o600);
    }
  });

  it('is idempotent: a rerun changes no byte', () => {
    const dir = directory();
    seedPlainStore(dir);
    const sealer = createTestArtifactSealer();
    migrateNodeSessionStore(dir, { sealer, apply: true });
    const sealed = IDS.map((id) => readFileSync(join(dir, `${id}.json`)));

    const rerun = migrateNodeSessionStore(dir, { sealer, apply: true });

    expect(rerun).toMatchObject({ sealed: 0, alreadySealed: 4 });
    expect(IDS.map((id) => readFileSync(join(dir, `${id}.json`)))).toEqual(sealed);
  });

  it('plans exactly what it would do and writes nothing', () => {
    const dir = directory();
    seedPlainStore(dir);
    const sealer = createTestArtifactSealer();
    const before = IDS.map((id) => readFileSync(join(dir, `${id}.json`)));

    const plan = migrateNodeSessionStore(dir, { sealer, apply: false });

    expect(plan).toMatchObject({ sealed: 4, alreadySealed: 0 });
    expect(IDS.map((id) => readFileSync(join(dir, `${id}.json`)))).toEqual(before);
    expect(
      readdirSync(dir)
        .filter((name) => name !== 'claims')
        .sort(),
    ).toEqual(IDS.map((id) => `${id}.json`));
  });

  it('stops at a commit point with that record as it was, and a rerun ends where an unbroken run does', () => {
    const dir = directory();
    seedPlainStore(dir);
    const sealer = createTestArtifactSealer();
    const before = statuses(dir, sealer);
    let commits = 0;
    const crash = (): void => {
      commits += 1;
      if (commits === 2) throw new Error('crash at the second commit point');
    };

    expect(() =>
      migrateNodeSessionStore(dir, { sealer, apply: true, beforeCommit: crash }),
    ).toThrow('crash at the second commit point');
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(filesWithCanary(dir)).toHaveLength(3);

    const resumed = migrateNodeSessionStore(dir, { sealer, apply: true });

    expect(resumed).toMatchObject({ sealed: 3, alreadySealed: 1 });
    expect(filesWithCanary(dir)).toEqual([]);
    expect(statuses(dir, sealer)).toEqual(before);
  });

  it('leaves a record that changed after it was read, for the next run', () => {
    const dir = directory();
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record('running_one'));
    const saved = envelope({ ...record('running_one'), title: 'saved meanwhile' });

    const result = migrateNodeSessionStore(dir, {
      sealer: createTestArtifactSealer(),
      apply: true,
      beforeCommit: () => writeFileSync(join(dir, 'running_one.json'), saved),
    });

    expect(result).toMatchObject({ sealed: 0, changed: [join(dir, 'running_one.json')] });
    expect(readFileSync(join(dir, 'running_one.json'), 'utf8')).toBe(saved);
  });

  it('leaves alone, and reports, sealed records that do not open here and names that are not ids', () => {
    const dir = directory();
    const stranger = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer: stranger } }).save(record('theirs'));
    const theirs = readFileSync(join(dir, 'theirs.json'));
    const newer = Buffer.concat([Buffer.from('RSL9'), Buffer.from(CANARY)]);
    writeFileSync(join(dir, 'newer_one.json'), newer);
    writeFileSync(join(dir, 'not an id.json'), envelope(record('x')));

    const result = migrateNodeSessionStore(dir, {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect([...result.unopenable].sort()).toEqual([
      join(dir, 'newer_one.json'),
      join(dir, 'theirs.json'),
    ]);
    expect(result.unsafeNames).toEqual([join(dir, 'not an id.json')]);
    expect(readFileSync(join(dir, 'theirs.json'))).toEqual(theirs);
    expect(readFileSync(join(dir, 'newer_one.json'))).toEqual(newer);
  });

  it('never follows a record name that is a link', () => {
    const dir = directory();
    const elsewhere = join(directory(), 'elsewhere.json');
    writeFileSync(elsewhere, envelope(record('linked')));
    symlinkSync(elsewhere, join(dir, 'linked.json'));

    const result = migrateNodeSessionStore(dir, {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result.refused).toEqual([join(dir, 'linked.json')]);
    expect(readFileSync(elsewhere, 'utf8')).toContain(CANARY);
  });

  it('refuses a record with another name, which sealing in place would leave holding the plaintext', () => {
    const dir = directory();
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record('linked_one'));
    const backup = join(directory(), 'backup.json');
    linkSync(join(dir, 'linked_one.json'), backup);

    const result = migrateNodeSessionStore(dir, {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result).toMatchObject({ sealed: 0, refused: [join(dir, 'linked_one.json')] });
    expect(readFileSync(join(dir, 'linked_one.json'), 'utf8')).toContain(CANARY);
    expect(statSync(backup).nlink).toBe(2);
  });

  it('keeps a forced release from crossing a migration replacement', () => {
    const dir = directory();
    const id = 'migrating_one';
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record(id));
    const claims = join(dir, 'claims');
    const breaker = createProcessMarkers(claims, {
      operationLock: createProcessOperationLock(claims),
      lockWaitMs: 0,
    });
    let forced: string | undefined;
    const result = migrateNodeSessionStore(dir, {
      sealer: createTestArtifactSealer(),
      apply: true,
      beforeCommit: () => {
        forced = breaker.remove(id, { force: true }).status;
      },
    });
    expect(forced).toBe('busy');
    expect(result.sealed).toBe(1);
  });

  it('writes and flushes every sealed record beside its file before it puts any in place', () => {
    const dir = directory();
    seedPlainStore(dir);
    const staged: string[][] = [];

    migrateNodeSessionStore(dir, {
      sealer: createTestArtifactSealer(),
      apply: true,
      beforeCommit: () => {
        staged.push(readdirSync(dir).filter((name) => name.endsWith('.tmp')));
      },
    });

    expect(staged[0]).toHaveLength(IDS.length);
    expect(staged.map((names) => names.length)).toEqual([4, 3, 2, 1]);
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('judges a temp file against when the migration started, in a directory nothing changed since', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sealed_one'));
    const stale = join(dir, 'deleted_one.json.4242.tmp');
    writeFileSync(stale, envelope(record('deleted_one')));
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(stale, tenMinutesAgo, tenMinutesAgo);
    utimesSync(dir, tenMinutesAgo, tenMinutesAgo);

    const result = migrateNodeSessionStore(dir, {
      sealer,
      apply: true,
      sweepTemporaries: true,
      migrationStartedAt: Date.now(),
    });

    expect(result.staleTemporaries).toBe(1);
    expect(existsSync(stale)).toBe(false);
  });

  it('removes temp files crashed writes left only when stale, and never its own', () => {
    const dir = directory();
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record('valid_one'));
    const stale = join(dir, 'valid_one.json.4242.tmp');
    const fresh = join(dir, 'valid_one.json.4343.tmp');
    // A temp of this process's own pid (not one this run's own write takes over) is never stale.
    const own = join(dir, `other_one.json.${process.pid}.tmp`);
    for (const path of [stale, fresh, own]) writeFileSync(path, envelope(record('valid_one')));
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(stale, tenMinutesAgo, tenMinutesAgo);
    utimesSync(own, tenMinutesAgo, tenMinutesAgo);
    const sealer = createTestArtifactSealer();

    const plan = migrateNodeSessionStore(dir, { sealer, apply: false, sweepTemporaries: true });
    expect(plan.staleTemporaries).toBe(1);
    expect(existsSync(stale)).toBe(true);

    const result = migrateNodeSessionStore(dir, { sealer, apply: true, sweepTemporaries: true });

    expect(result.staleTemporaries).toBe(1);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(own)).toBe(true);
  });

  it('finds nothing in a store that does not exist', () => {
    const result = migrateNodeSessionStore(join(directory(), 'missing'), {
      sealer: createTestArtifactSealer(),
      apply: true,
    });
    expect(result).toMatchObject({ sealed: 0, alreadySealed: 0, refused: [] });
  });
});

describe('readSessionStoreWorkingDirectories', () => {
  it('names the working directory of plain and sealed records alike, and writes nothing', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    new NodeSessionStore(dir, { sealing: 'plain' }).save(record('plain_one', '/work/plain'));
    new NodeSessionStore(dir, { sealing: { sealer } }).save(record('sealed_one', '/work/sealed'));
    writeFileSync(
      join(dir, 'corrupt_one.json'),
      envelope({ id: 'corrupt_one', cwd: '/work/corrupt' }),
    );
    mkdirSync(join(dir, 'nested.json'));
    const before = readdirSync(dir).map((name) => statSync(join(dir, name)).mtimeMs);

    expect(readSessionStoreWorkingDirectories(dir, { sealer }).slice().sort()).toEqual([
      '/work/corrupt',
      '/work/plain',
      '/work/sealed',
    ]);
    expect(readdirSync(dir).map((name) => statSync(join(dir, name)).mtimeMs)).toEqual(before);
  });
});
