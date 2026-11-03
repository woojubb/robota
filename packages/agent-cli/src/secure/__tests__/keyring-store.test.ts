import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
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
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBootId, readPidNamespace } from '@robota-sdk/agent-core/node';
import { changePassphrase, serializeKeyring, type IKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KeyringStoreError,
  createKeyringFileStore,
  type IKeyringStore,
  type IMachineIdentity,
} from '../keyring-store.js';
import { FIXTURE_PASSPHRASE, OTHER_PASSPHRASE, fixtureKeyring } from './helpers.js';

const PERMISSIVE_UMASK = 0o022;
const isWindows = process.platform === 'win32';

let root: string;
let previousUmask: number;
let keyringPath: string;

beforeEach(() => {
  previousUmask = process.umask(PERMISSIVE_UMASK);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-store-')));
  keyringPath = join(root, 'secure', 'keyring.json');
});

afterEach(() => {
  process.umask(previousUmask);
  rmSync(root, { recursive: true, force: true });
});

const mode = (path: string): number => statSync(path).mode & 0o7777;

function storeFor(
  extra: Partial<Parameters<typeof createKeyringFileStore>[0]> = {},
): IKeyringStore {
  return createKeyringFileStore({ path: keyringPath, root, ...extra });
}

function refusal(action: () => unknown): KeyringStoreError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(KeyringStoreError);
    return error as KeyringStoreError;
  }
  throw new Error('expected a KeyringStoreError');
}

describe('keyring store — reading', () => {
  it('reports a missing file as "no keyring", not as an error', () => {
    expect(storeFor().load()).toEqual({ status: 'missing' });
    expect(storeFor().inspect()).toEqual({ exists: false });
  });

  it('reads back what was created', async () => {
    const { keyring } = await fixtureKeyring();
    const store = storeFor();
    store.create(keyring);
    const loaded = store.load();
    expect(loaded.status === 'present' && serializeKeyring(loaded.keyring)).toBe(
      serializeKeyring(keyring),
    );
  });

  it.skipIf(isWindows)('tightens a group- or world-readable file before reading it', async () => {
    const { keyring } = await fixtureKeyring();
    mkdirSync(join(root, 'secure'));
    writeFileSync(keyringPath, serializeKeyring(keyring));
    chmodSync(keyringPath, 0o644);
    const before = storeFor().inspect();
    expect(before.mode).toBe(0o644);

    expect(storeFor().load().status).toBe('present');
    expect(mode(keyringPath)).toBe(0o600);
    expect(storeFor().inspect().mode).toBe(0o600);
  });

  it.skipIf(isWindows)(
    'refuses a symbolic link, even one that points at a valid keyring',
    async () => {
      const { keyring } = await fixtureKeyring();
      mkdirSync(join(root, 'secure'));
      const elsewhere = join(root, 'elsewhere.json');
      writeFileSync(elsewhere, serializeKeyring(keyring), { mode: 0o600 });
      symlinkSync(elsewhere, keyringPath);

      expect(refusal(() => storeFor().load()).code).toBe('symlink');
      expect(storeFor().inspect().kind).toBe('symlink');
    },
  );

  it('refuses a directory at the keyring path', () => {
    mkdirSync(keyringPath, { recursive: true });
    expect(refusal(() => storeFor().load()).code).toBe('not-regular-file');
  });

  it.skipIf(isWindows)('refuses a named pipe without blocking on it', () => {
    mkdirSync(join(root, 'secure'));
    execFileSync('mkfifo', [keyringPath]);
    expect(refusal(() => storeFor().load()).code).toBe('not-regular-file');
  });

  it.skipIf(isWindows)('refuses a file owned by another account', async () => {
    const { keyring } = await fixtureKeyring();
    const store = storeFor();
    store.create(keyring);
    const other = (process.getuid?.() ?? 0) + 1;

    const error = refusal(() => storeFor({ currentUserId: other }).load());
    expect(error.code).toBe('foreign-owner');
    expect(storeFor({ currentUserId: other }).inspect().ownedByCurrentUser).toBe(false);
    expect(storeFor().inspect().ownedByCurrentUser).toBe(true);
  });

  it('refuses a file far larger than any keyring without reading it', () => {
    mkdirSync(join(root, 'secure'));
    writeFileSync(keyringPath, 'x'.repeat(200 * 1024), { mode: 0o600 });
    expect(refusal(() => storeFor().load()).code).toBe('too-large');
  });

  it('reports a malformed file without quoting any of it', () => {
    mkdirSync(join(root, 'secure'));
    const marker = 'MARKER-passphrase-pasted-into-the-wrong-file';
    for (const content of [marker, `{"version":1,"note":"${marker}"}`, '']) {
      writeFileSync(keyringPath, content, { mode: 0o600 });
      const error = refusal(() => storeFor().load());
      expect(error.code).toBe('malformed');
      expect(error.message).not.toContain(marker);
      expect(JSON.stringify(error)).not.toContain(marker);
    }
  });

  it('names a newer document version as its own refusal', async () => {
    const { keyring } = await fixtureKeyring();
    mkdirSync(join(root, 'secure'));
    writeFileSync(keyringPath, JSON.stringify({ ...keyring, version: 2 }), { mode: 0o600 });
    expect(refusal(() => storeFor().load()).code).toBe('unsupported-version');
  });
});

describe('keyring store — saving', () => {
  it.skipIf(isWindows)(
    'creates the directory 0700 and the file 0600 under a permissive umask',
    async () => {
      const { keyring } = await fixtureKeyring();
      storeFor().create(keyring);
      expect(mode(join(root, 'secure'))).toBe(0o700);
      expect(mode(keyringPath)).toBe(0o600);
    },
  );

  it.skipIf(isWindows)(
    'tightens a user root and secure directory an older run left wide',
    async () => {
      const { keyring } = await fixtureKeyring();
      mkdirSync(join(root, 'secure'));
      chmodSync(root, 0o755);
      chmodSync(join(root, 'secure'), 0o755);
      storeFor().create(keyring);
      expect(mode(root)).toBe(0o700);
      expect(mode(join(root, 'secure'))).toBe(0o700);
    },
  );

  it('flushes the file before the rename and the directory after it', async () => {
    const { keyring } = await fixtureKeyring();
    const store = storeFor();
    store.create(keyring);
    const updated = await changePassphrase(
      keyring,
      { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE },
      OTHER_PASSPHRASE,
    );

    const seen: string[] = [];
    storeFor({
      durability: {
        syncFile: () => {
          seen.push('file');
          // The new bytes are in the temp file; the keyring that counts is still the old one.
          expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
        },
        syncDirectory: () => {
          seen.push('directory');
          expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(updated));
        },
      },
    }).save(updated, keyring);
    expect(seen).toEqual(['file', 'directory']);
  });

  it('keeps the old keyring and leaves no temp file when the flush fails', async () => {
    const { keyring } = await fixtureKeyring();
    const store = storeFor();
    store.create(keyring);
    const updated = await changePassphrase(
      keyring,
      { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE },
      OTHER_PASSPHRASE,
    );

    const error = refusal(() =>
      storeFor({
        durability: {
          syncFile: () => {
            throw Object.assign(new Error('no space left on device: /secret/path'), {
              code: 'ENOSPC',
            });
          },
        },
      }).save(updated, keyring),
    );
    expect(error.code).toBe('write-failed');
    expect(error.message).toContain('ENOSPC');
    expect(error.message).not.toContain('/secret/path');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
    expect(readdirSync(join(root, 'secure'))).toEqual(['keyring.json']);
  });

  it('reads the keyring back and refuses a result that is not what was written', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await changePassphrase(
      keyring,
      { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE },
      OTHER_PASSPHRASE,
    );
    const error = refusal(() =>
      storeFor({
        durability: {
          // Something that ignores the lock replaced the file between the rename and the read-back.
          syncDirectory: () => writeFileSync(keyringPath, serializeKeyring(other), { mode: 0o600 }),
        },
      }).create(keyring),
    );
    expect(error.code).toBe('verify-failed');
  });

  it('leaves no backup of the previous keyring after the passphrase changes', async () => {
    const { keyring } = await fixtureKeyring();
    const store = storeFor();
    store.create(keyring);
    const oldPassphraseSlot = keyring.slots.find((slot) => slot.type === 'passphrase');
    const updated = await changePassphrase(
      keyring,
      { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE },
      OTHER_PASSPHRASE,
    );
    store.save(updated, keyring);

    expect(readdirSync(join(root, 'secure'))).toEqual(['keyring.json']);
    const everythingOnDisk = [root, join(root, 'secure')]
      .flatMap((directory) => readdirSync(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
      .join('\n');
    expect(oldPassphraseSlot).toBeDefined();
    expect(everythingOnDisk).not.toContain(oldPassphraseSlot!.wrappedKey);
  });

  it('removes a temp file an interrupted save left, so no older slot outlives the next save', async () => {
    const { keyring } = await fixtureKeyring();
    mkdirSync(join(root, 'secure'));
    const crashed = join(
      root,
      'secure',
      `keyring.json.${deadPid()}-${ownTag()}-0000000000000000.tmp`,
    );
    // An earlier build's name says nothing about whose it is, so only its age lets it go.
    const legacy = join(root, 'secure', 'keyring.json.424242.tmp');
    for (const file of [crashed, legacy]) {
      writeFileSync(file, serializeKeyring(keyring), { mode: 0o600 });
    }
    ageFile(legacy, 10 * 60_000);
    const unrelated = join(root, 'secure', 'notes.txt');
    writeFileSync(unrelated, 'keep', { mode: 0o600 });

    storeFor().create(keyring);
    expect(existsSync(crashed)).toBe(false);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('never writes through a symbolic link at the path: create and save both refuse', async () => {
    if (isWindows) return;
    const { keyring } = await fixtureKeyring();
    mkdirSync(join(root, 'secure'));
    const elsewhere = join(root, 'elsewhere.json');
    writeFileSync(elsewhere, serializeKeyring(keyring), { mode: 0o600 });
    symlinkSync(elsewhere, keyringPath);

    expect(refusal(() => storeFor().create(keyring)).code).toBe('exists');
    expect(refusal(() => storeFor().save(keyring, keyring)).code).toBe('symlink');
    expect(readFileSync(elsewhere, 'utf8')).toBe(serializeKeyring(keyring));
    expect(storeFor().inspect().kind).toBe('symlink');
  });
});

/** The keyring put on disk directly, as another process (or an attacker with write access) would. */
function writeKeyringFile(keyring: IKeyring): void {
  mkdirSync(join(root, 'secure'), { recursive: true });
  writeFileSync(keyringPath, serializeKeyring(keyring), { mode: 0o600 });
}

/** A second valid keyring document that differs from `keyring`, without another key derivation. */
function reordered(keyring: IKeyring): IKeyring {
  return { ...keyring, slots: [...keyring.slots].reverse() };
}

/** The pid of a process that has already exited. */
function deadPid(): number {
  const { pid } = spawnSync(process.execPath, ['-e', '']);
  expect(pid).toBeGreaterThan(0);
  return pid!;
}

const lockPath = (): string => `${keyringPath}.lock`;

/** This machine as the store reads it. */
function thisMachine(): IMachineIdentity {
  const bootId = readBootId();
  const pidNamespace = readPidNamespace();
  return {
    host: hostname(),
    ...(bootId === undefined ? {} : { bootId }),
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
  };
}

const OTHER_HOST: IMachineIdentity = { host: 'another-host', bootId: 'another-boot' };

function monotonicNowMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

/**
 * A lock as a writer on `machine` writes it. It also carries the wall-clock `createdAt` an earlier
 * build wrote and judged by, which this store ignores.
 */
function lockOf(pid: number, machine: IMachineIdentity, token = 'another-writer'): string {
  return JSON.stringify({
    token,
    pid,
    ...machine,
    monotonicMs: monotonicNowMs(),
    createdAt: Date.now(),
  });
}

/** Moves a file's times back, as if it had been written `ms` ago by the filesystem's clock. */
function ageFile(file: string, ms: number): void {
  const at = new Date(statSync(file).mtimeMs - ms);
  utimesSync(file, at, at);
}

let cachedTag: string | undefined;

/** The machine tag this store puts in its temp file names, seen during a real save. */
function ownTag(): string {
  if (cachedTag !== undefined) return cachedTag;
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'keyring-tag-')));
  const target = join(scratch, 'secure', 'keyring.json');
  let seen: string[] = [];
  try {
    createKeyringFileStore({
      path: target,
      root: scratch,
      durability: {
        syncFile: () => {
          seen = readdirSync(join(scratch, 'secure'));
        },
      },
    }).create(JSON.parse(KEYRING_FOR_TAG) as IKeyring);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const tag = seen
    .map((name) => /^keyring\.json\.\d+-([0-9a-f]{12})-[0-9a-f]{16}\.tmp$/.exec(name)?.[1])
    .find(Boolean);
  if (tag === undefined) throw new Error(`no tagged temp file among ${seen.join(', ')}`);
  cachedTag = tag;
  return tag;
}

let KEYRING_FOR_TAG = '';
beforeEach(async () => {
  KEYRING_FOR_TAG = serializeKeyring((await fixtureKeyring()).keyring);
});
const passphraseCredential = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE } as const;

describe('keyring store — one writer at a time', () => {
  it('replaces the keyring only while the file still holds the one the change was built from', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const updated = await changePassphrase(keyring, passphraseCredential, OTHER_PASSPHRASE);
    // Another writer got there first: a change built on the old file must not undo it.
    const theirs = reordered(keyring);
    writeKeyringFile(theirs);

    const error = refusal(() => storeFor().save(updated, keyring));
    expect(error.code).toBe('changed');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(theirs));
  });

  it('creates a keyring only where there is none, and refuses with exists otherwise', async () => {
    const { keyring } = await fixtureKeyring();
    const store = storeFor();
    store.create(keyring);
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));

    expect(refusal(() => store.create(reordered(keyring))).code).toBe('exists');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
    expect(readdirSync(join(root, 'secure'))).toEqual(['keyring.json']);
  });

  it('waits for a lock a live process holds, then refuses with busy and writes nothing', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const held = lockOf(process.pid, thisMachine());
    writeFileSync(lockPath(), held, { mode: 0o600 });

    const error = refusal(() => storeFor({ lockWaitMs: 100 }).save(reordered(keyring), keyring));
    expect(error.code).toBe('busy');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
    expect(readFileSync(lockPath(), 'utf8')).toBe(held);
  });

  it('breaks a lock this machine holds whose process is gone, and leaves no lock behind', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    writeFileSync(lockPath(), lockOf(deadPid(), thisMachine()), { mode: 0o600 });

    storeFor({ lockWaitMs: 100 }).save(reordered(keyring), keyring);
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(reordered(keyring)));
    expect(existsSync(lockPath())).toBe(false);
  });

  it('never probes the pid of a lock from another host: a fresh one is waited on even if that pid is gone here', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    // That number means nothing on this machine; here it happens to be no process at all.
    const held = lockOf(deadPid(), OTHER_HOST);
    writeFileSync(lockPath(), held, { mode: 0o600 });

    const error = refusal(() => storeFor({ lockWaitMs: 100 }).save(reordered(keyring), keyring));
    expect(error.code).toBe('busy');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
    expect(readFileSync(lockPath(), 'utf8')).toBe(held);
  });

  it('breaks a lock from another host, or one it cannot read, once it is old on the filesystem clock', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    let current = keyring;
    for (const held of [lockOf(process.pid, OTHER_HOST), '{"pid": 1, "cut short']) {
      writeFileSync(lockPath(), held, { mode: 0o600 });
      ageFile(lockPath(), 10 * 60_000);
      const next = reordered(current);
      storeFor({ lockWaitMs: 100 }).save(next, current);
      expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(next));
      expect(existsSync(lockPath())).toBe(false);
      current = next;
    }
  });

  it('does not break a fresh lock when the wall clock steps an hour either way', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const realNow = Date.now();
    for (const step of [60 * 60_000, -60 * 60_000]) {
      for (const held of [lockOf(process.pid, thisMachine()), lockOf(process.pid, OTHER_HOST)]) {
        writeFileSync(lockPath(), held, { mode: 0o600 });
        const clock = vi.spyOn(Date, 'now').mockReturnValue(realNow + step);
        try {
          const error = refusal(() =>
            storeFor({ lockWaitMs: 100 }).save(reordered(keyring), keyring),
          );
          expect(error.code).toBe('busy');
        } finally {
          clock.mockRestore();
        }
        expect(readFileSync(lockPath(), 'utf8')).toBe(held);
        expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
      }
    }
    rmSync(lockPath());
  });

  it('releases the lock when the save fails', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const error = refusal(() =>
      storeFor({
        durability: {
          syncFile: () => {
            throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
          },
        },
      }).save(reordered(keyring), keyring),
    );
    expect(error.code).toBe('write-failed');
    expect(existsSync(lockPath())).toBe(false);
  });

  it("sweeps a temp file of this machine whose process is gone, and another machine's only once it is old", async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const dir = join(root, 'secure');
    const gone = join(dir, `keyring.json.${deadPid()}-${ownTag()}-0000000000000000.tmp`);
    // The parent of this test process is alive: its temp file may be a save in progress.
    const live = join(dir, `keyring.json.${process.ppid}-${ownTag()}-0000000000000000.tmp`);
    // Another machine's pid is no process here, which says nothing about whether it is still writing.
    const elsewhereFresh = join(dir, `keyring.json.${deadPid()}-0123456789ab-0000000000000000.tmp`);
    const elsewhereOld = join(dir, `keyring.json.${deadPid()}-ba9876543210-0000000000000000.tmp`);
    for (const file of [gone, live, elsewhereFresh, elsewhereOld]) {
      writeFileSync(file, serializeKeyring(keyring), { mode: 0o600 });
    }
    ageFile(elsewhereOld, 10 * 60_000);

    storeFor().save(reordered(keyring), keyring);
    expect(existsSync(gone)).toBe(false);
    expect(existsSync(live)).toBe(true);
    expect(existsSync(elsewhereFresh)).toBe(true);
    expect(existsSync(elsewhereOld)).toBe(false);
  });
});

describe('keyring store — a write that reached the file but was not confirmed', () => {
  it('reports a failure after the rename as committed-unconfirmed, with the new keyring in place', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const updated = await changePassphrase(keyring, passphraseCredential, OTHER_PASSPHRASE);

    const error = refusal(() =>
      storeFor({
        durability: {
          syncDirectory: () => {
            throw Object.assign(new Error('I/O error at /secret/path'), { code: 'EIO' });
          },
        },
      }).save(updated, keyring),
    );
    expect(error.code).toBe('committed-unconfirmed');
    expect(error.message).toContain('EIO');
    expect(error.message).not.toContain('/secret/path');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(updated));
    expect(existsSync(lockPath())).toBe(false);
  });
});

/** The lock as it is now, with its holder's pid swapped for a gone one: judged abandoned from here on. */
function abandonCurrentLock(): void {
  const held = JSON.parse(readFileSync(lockPath(), 'utf8')) as Record<string, unknown>;
  writeFileSync(lockPath(), JSON.stringify({ ...held, pid: deadPid() }), { mode: 0o600 });
}

describe('keyring store — a writer overtaken while it stalls', () => {
  it('re-checks immediately before its commit, so it reports changed instead of undoing the writer that took over', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const mine = await changePassphrase(keyring, passphraseCredential, OTHER_PASSPHRASE);
    const theirs = reordered(keyring);
    let overtaken = false;
    const stalling = storeFor({
      durability: {
        // Between writing its temp file and committing it, this writer stalls past the stale bound:
        // another writer judges its lock abandoned, takes it, and saves a change of its own.
        syncFile: () => {
          if (overtaken) return;
          overtaken = true;
          abandonCurrentLock();
          storeFor({ lockWaitMs: 100 }).save(theirs, keyring);
        },
      },
    });

    const error = refusal(() => stalling.save(mine, keyring));
    expect(error.code).toBe('changed');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(theirs));
    expect(readdirSync(join(root, 'secure')).sort()).toEqual(['keyring.json']);
  });

  it('re-checks after its read-back, so a lock taken over meanwhile leaves the result unconfirmed', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    const mine = reordered(keyring);
    let overtaken = false;
    const stalling = storeFor({
      durability: {
        // After the rename, before the read-back: another writer takes the lock over (and, finding
        // the file changed under the keyring it expected, writes nothing).
        syncDirectory: () => {
          if (overtaken) return;
          overtaken = true;
          abandonCurrentLock();
          expect(refusal(() => storeFor({ lockWaitMs: 100 }).save(keyring, keyring)).code).toBe(
            'changed',
          );
        },
      },
    });

    const error = refusal(() => stalling.save(mine, keyring));
    expect(error.code).toBe('committed-unconfirmed');
    expect(error.reason).toBe('lock-lost');
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(mine));
  });
});

describe('keyring store — a filesystem without hard links', () => {
  const noHardLinks = vi.fn(() => {
    throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' });
  });

  afterEach(() => noHardLinks.mockClear());

  it('creates the keyring by a rename checked under the lock', async () => {
    const { keyring } = await fixtureKeyring();
    storeFor({ linkFile: noHardLinks }).create(keyring);
    expect(noHardLinks).toHaveBeenCalledOnce();
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
    if (!isWindows) expect(mode(keyringPath)).toBe(0o600);
    expect(readdirSync(join(root, 'secure'))).toEqual(['keyring.json']);
  });

  it('still refuses with exists where a keyring already is', async () => {
    const { keyring } = await fixtureKeyring();
    writeKeyringFile(keyring);
    expect(refusal(() => storeFor({ linkFile: noHardLinks }).create(reordered(keyring))).code).toBe(
      'exists',
    );
    expect(readFileSync(keyringPath, 'utf8')).toBe(serializeKeyring(keyring));
    expect(readdirSync(join(root, 'secure'))).toEqual(['keyring.json']);
  });
});
