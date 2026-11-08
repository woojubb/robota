/**
 * SEC-020 (issue #2021) — the owner-only host store, asserted against a real filesystem.
 *
 * Every case sets a PERMISSIVE umask explicitly. A test that inherits a restrictive umask passes
 * whether or not the mode was requested, which is the accidental-green shape this repository keeps
 * finding: the assertion holds either way, so it asserts nothing.
 */

import {
  chmodSync,
  existsSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  OwnerOnlyModeError,
  OwnerOnlyWriteUnconfirmedError,
  ensureOwnerOnlyDirectory,
  ownerOnlyGuarantee,
  stageOwnerOnlyFile,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from './owner-only-store.js';

const PERMISSIVE_UMASK = 0o022;

let root: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(PERMISSIVE_UMASK);
  root = realpathSync(mkdtempSync(join(tmpdir(), 'owner-only-')));
});

afterEach(() => {
  process.umask(previousUmask);
});

const mode = (path: string): number => statSync(path).mode & 0o7777;

/**
 * Windows has no POSIX mode bits to read back: `chmod` only toggles the read-only attribute and
 * inherited NTFS ACLs govern, which `ownerOnlyGuarantee()` reports (TC-13). The mode assertions
 * therefore run only where the platform defines them.
 */
const POSIX_MODES = ownerOnlyGuarantee() === 'posix-mode';

function expectMode(path: string, expected: number): void {
  if (POSIX_MODES) expect(mode(path)).toBe(expected);
}

describe('ensureOwnerOnlyDirectory — durable', () => {
  it('flushes the parent of each directory it created, and nothing when it created none', () => {
    const flushed: string[] = [];
    const syncDirectory = (directory: string): void => {
      flushed.push(directory);
    };

    ensureOwnerOnlyDirectory(join(root, 'a', 'b'), { durable: true, syncDirectory });
    expect(flushed).toEqual([root, join(root, 'a')]);

    flushed.length = 0;
    ensureOwnerOnlyDirectory(join(root, 'a', 'b'), { durable: true, syncDirectory });
    expect(flushed).toEqual([]);
  });

  it('flushes nothing unless asked to', () => {
    ensureOwnerOnlyDirectory(join(root, 'c', 'd'), {
      syncDirectory: () => expect.unreachable('a non-durable call must not flush'),
    });
  });
});

describe('SEC-020 — ensureOwnerOnlyDirectory', () => {
  it('TC-01: creates a directory only its owner can enter, under a permissive umask', () => {
    const target = join(root, 'sessions');
    ensureOwnerOnlyDirectory(target);
    expect(statSync(target).isDirectory()).toBe(true);
    expectMode(target, OWNER_ONLY_DIRECTORY_MODE);
  });

  it.runIf(POSIX_MODES)('TC-02: TIGHTENS a directory that already exists at a wider mode', () => {
    // `mkdirSync(path, { recursive: true, mode })` returns successfully on an existing directory
    // WITHOUT touching its mode. This is the case the old `if (!existsSync) mkdirSync` skipped
    // entirely, and it is the one an attacker creates by pre-making the directory.
    const target = join(root, 'pre-existing');
    mkdirSync(target);
    chmodSync(target, 0o777);
    expect(mode(target)).toBe(0o777);
    ensureOwnerOnlyDirectory(target);
    expectMode(target, OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-03: is idempotent', () => {
    const target = join(root, 'twice');
    ensureOwnerOnlyDirectory(target);
    ensureOwnerOnlyDirectory(target);
    expect(statSync(target).isDirectory()).toBe(true);
    expectMode(target, OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-04: creates missing parents, and every one of them is owner-only', () => {
    const target = join(root, 'a', 'b', 'c');
    ensureOwnerOnlyDirectory(target);
    expect(statSync(target).isDirectory()).toBe(true);
    expectMode(target, OWNER_ONLY_DIRECTORY_MODE);
    expectMode(join(root, 'a'), OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-05: refuses rather than proceeding when the target is not a directory', () => {
    const target = join(root, 'a-file');
    writeFileSync(target, 'x');
    expect(() => ensureOwnerOnlyDirectory(target)).toThrow();
  });
});

describe('SEC-020 — writeOwnerOnlyFile', () => {
  it('TC-06: writes a record only its owner can read', () => {
    const target = join(root, 'store', 'record.json');
    writeOwnerOnlyFile(target, '{"a":1}');
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
    expectMode(target, OWNER_ONLY_FILE_MODE);
    expectMode(join(root, 'store'), OWNER_ONLY_DIRECTORY_MODE);
  });

  it.runIf(POSIX_MODES)('TC-07: REPLACES a file that already exists at a wider mode', () => {
    // `writeFileSync(path, data, { mode })` applies the mode only when the file is CREATED, so a
    // record an older version left at 0644 keeps 0644 through every later save.
    const target = join(root, 'record.json');
    writeFileSync(target, 'old');
    chmodSync(target, 0o644);
    writeOwnerOnlyFile(target, 'new');
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });

  it('TC-08: leaves no temp file behind on success', () => {
    const target = join(root, 'record.json');
    writeOwnerOnlyFile(target, 'x');
    expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
  });

  it.runIf(POSIX_MODES)('TC-09: a temp path left at a wider mode is not adopted', () => {
    // The window this closes: the bytes are on disk under the temp name before the rename, so a
    // temp file created world-readable exposes the whole record even though the final path is 0600.
    const target = join(root, 'record.json');
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, 'stale');
    chmodSync(temp, 0o666);
    writeOwnerOnlyFile(target, 'fresh');
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });

  it('writes bytes exactly as given, at the same mode, so a sealed artifact needs no second path', () => {
    // Every value 0-255, which is not valid UTF-8: a path that re-encoded the content as text would
    // change these bytes.
    const sealed = Uint8Array.from({ length: 256 }, (_, value) => value);
    const target = join(root, 'store', 'sealed.json');
    writeOwnerOnlyFile(target, sealed);
    expect(new Uint8Array(readFileSync(target))).toEqual(sealed);
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });
});

describe('SEC-020 — tightenExistingFile', () => {
  it.runIf(POSIX_MODES)('TC-10: narrows a file an older version left readable', () => {
    const target = join(root, 'old.jsonl');
    writeFileSync(target, 'line\n');
    chmodSync(target, 0o644);
    tightenExistingFile(target);
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });

  it('TC-11: is a no-op on a path that does not exist, and does not throw', () => {
    expect(() => tightenExistingFile(join(root, 'absent'))).not.toThrow();
  });

  it.runIf(POSIX_MODES)('TC-12: leaves an already-owner-only file alone', () => {
    const target = join(root, 'fine');
    writeFileSync(target, 'x', { mode: OWNER_ONLY_FILE_MODE });
    chmodSync(target, OWNER_ONLY_FILE_MODE);
    tightenExistingFile(target);
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });
});

describe('SEC-020 — the guarantee is named, not assumed', () => {
  it('TC-13: Windows cannot express owner-only through chmod, and says so', () => {
    // Asserted through the injected platform so the case runs on Linux CI. The point is that the
    // module reports which guarantee is in force rather than making the POSIX claim everywhere —
    // on win32 inherited NTFS ACLs govern, and a project-local `.agent` inside a world-writable
    // directory is NOT protected by this module.
    expect(ownerOnlyGuarantee('win32')).toBe('windows-acl');
    expect(ownerOnlyGuarantee('linux')).toBe('posix-mode');
    expect(ownerOnlyGuarantee('darwin')).toBe('posix-mode');
  });

  it('TC-14: OwnerOnlyModeError is the failure, not a weaker mode', () => {
    expect(new OwnerOnlyModeError('x')).toBeInstanceOf(Error);
    expect(new OwnerOnlyModeError('x').name).toBe('OwnerOnlyModeError');
  });
});

describe('SEC-020 — verification, not hope', () => {
  it.runIf(POSIX_MODES)(
    'TC-29: a filesystem that silently ignores chmod is REFUSED, not used',
    () => {
      // The condition the verification step exists for, and the only one create-then-chmod cannot
      // reach on its own: `mkdir` succeeds, `chmod` returns without error, and the mode is still wide.
      // Some network and FAT mounts behave exactly this way.
      //
      // Before this case existed, deleting the verification entirely changed no test result — the
      // guard was present and unproven, which is the shape this repository keeps finding.
      const target = join(root, 'ignores-chmod');
      expect(() =>
        ensureOwnerOnlyDirectory(target, {
          makeDirectory: () => {
            mkdirSync(target, { recursive: true });
          },
          setMode: () => {
            /* the filesystem accepts the call and does nothing */
          },
          readMode: () => 0o777,
        }),
      ).toThrow(OwnerOnlyModeError);
    },
  );

  it.runIf(POSIX_MODES)(
    'TC-30: the refusal names the mode it found, so the message is actionable',
    () => {
      const target = join(root, 'ignores-chmod-2');
      try {
        ensureOwnerOnlyDirectory(target, {
          makeDirectory: () => {
            mkdirSync(target, { recursive: true });
          },
          setMode: () => {},
          readMode: () => 0o755,
        });
        expect.unreachable('the verification should have refused');
      } catch (error) {
        expect((error as Error).message).toContain('0755');
        expect((error as Error).message).toContain(target);
      }
    },
  );
});

describe('SEC-020 — withinRoot tightens the ancestors the caller owns', () => {
  it.runIf(POSIX_MODES)(
    'TC-31: a store ROOT an older version left at 0755 is tightened, not only the leaf',
    () => {
      // The defect review of PR #2224 found: `mkdirSync(path, { recursive: true, mode })` applies the
      // mode only to the directories it CREATES, so a root that already existed keeps whatever it had
      // while the sessions directory inside it came out 0700. On the restricted-workspace fallback no
      // other writer runs, so nothing else would ever repair it.
      const owned = join(root, 'store-root');
      mkdirSync(owned);
      chmodSync(owned, 0o755);
      const leaf = join(owned, 'sessions');
      ensureOwnerOnlyDirectory(leaf, { withinRoot: owned });
      expectMode(owned, OWNER_ONLY_DIRECTORY_MODE);
      expectMode(leaf, OWNER_ONLY_DIRECTORY_MODE);
    },
  );

  it.runIf(POSIX_MODES)('TC-32: every segment between the root and the leaf is tightened', () => {
    const owned = join(root, 'deep-root');
    const middle = join(owned, 'a');
    mkdirSync(middle, { recursive: true });
    chmodSync(owned, 0o755);
    chmodSync(middle, 0o777);
    const leaf = join(middle, 'b');
    ensureOwnerOnlyDirectory(leaf, { withinRoot: owned });
    for (const path of [owned, middle, leaf]) {
      expectMode(path, OWNER_ONLY_DIRECTORY_MODE);
    }
  });

  it('TC-33: a withinRoot that is NOT an ancestor is refused, not silently ignored', () => {
    // The guard that stops this module chmodding a directory nobody said it owns. Without it a
    // caller could pass a home directory and this would narrow it.
    const elsewhere = join(root, 'elsewhere');
    const leaf = join(root, 'target', 'sessions');
    mkdirSync(elsewhere, { recursive: true });
    expect(() => ensureOwnerOnlyDirectory(leaf, { withinRoot: elsewhere })).toThrow(
      OwnerOnlyModeError,
    );
  });

  it.runIf(POSIX_MODES)(
    'TC-34: without withinRoot only the leaf is touched — the parent is not this call to narrow',
    () => {
      const parent = join(root, 'not-ours');
      mkdirSync(parent);
      chmodSync(parent, 0o755);
      ensureOwnerOnlyDirectory(join(parent, 'leaf'));
      expectMode(parent, 0o755);
      expectMode(join(parent, 'leaf'), OWNER_ONLY_DIRECTORY_MODE);
    },
  );
});

describe('writeOwnerOnlyFile — durable', () => {
  it('TC-35: flushes the temp file before the rename and the directory after it', () => {
    // The order is the whole property: a rename that reaches the disk before the data does leaves a
    // present-but-empty file after a crash. Each seam looks at the real filesystem at the moment it
    // is called, so the assertions are about what was on disk then, not about call counts.
    const target = join(root, 'keys', 'keyring.json');
    mkdirSync(join(root, 'keys'));
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });
    const seen: string[] = [];
    writeOwnerOnlyFile(target, 'new-content', {
      durable: true,
      syncFile: (descriptor) => {
        seen.push('file');
        expect(fstatSync(descriptor).size).toBe('new-content'.length);
        expect(readFileSync(target, 'utf8')).toBe('old');
        expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(true);
      },
      syncDirectory: (directory) => {
        seen.push('directory');
        expect(directory).toBe(join(root, 'keys'));
        expect(readFileSync(target, 'utf8')).toBe('new-content');
        expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
      },
    });
    expect(seen).toEqual(['file', 'directory']);
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });

  it('flushes the parent of every directory the write created, outermost first, then the leaf', () => {
    // A flushed file in a directory whose own entry was never flushed is gone with the directory.
    const target = join(root, 'state', 'secure', 'keyring.json');
    const flushed: string[] = [];

    writeOwnerOnlyFile(target, 'keys', {
      durable: true,
      syncDirectory: (directory) => flushed.push(directory),
    });

    expect(flushed).toEqual([root, join(root, 'state'), join(root, 'state', 'secure')]);
  });

  it('flushes only the parent of a directory that was missing, not of one that existed', () => {
    mkdirSync(join(root, 'state'));
    const flushed: string[] = [];

    writeOwnerOnlyFile(join(root, 'state', 'secure', 'keyring.json'), 'keys', {
      durable: true,
      syncDirectory: (directory) => flushed.push(directory),
    });

    expect(flushed).toEqual([join(root, 'state'), join(root, 'state', 'secure')]);
  });

  it('flushes no created directory for a write that creates none', () => {
    mkdirSync(join(root, 'keys'));
    const flushed: string[] = [];

    writeOwnerOnlyFile(join(root, 'keys', 'keyring.json'), 'keys', {
      durable: true,
      syncDirectory: (directory) => flushed.push(directory),
    });

    expect(flushed).toEqual([join(root, 'keys')]);
  });

  it('TC-36: a plain write flushes nothing, so existing callers keep their cost', () => {
    const target = join(root, 'plain.json');
    writeOwnerOnlyFile(target, 'x', {
      syncFile: () => expect.unreachable('a non-durable write must not flush the file'),
      syncDirectory: () => expect.unreachable('a non-durable write must not flush the directory'),
    });
    expect(readFileSync(target, 'utf8')).toBe('x');
  });

  it('TC-37: a failed flush keeps the old content, removes the temp file and reports the failure', () => {
    const target = join(root, 'keyring.json');
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });
    expect(() =>
      writeOwnerOnlyFile(target, 'new', {
        durable: true,
        syncFile: () => {
          throw new Error('disk full');
        },
      }),
    ).toThrow('disk full');
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('TC-38: flushes the real file and directory on a real filesystem without error', () => {
    const target = join(root, 'real', 'keyring.json');
    writeOwnerOnlyFile(target, '{"a":1}', { durable: true });
    expect(readFileSync(target, 'utf8')).toBe('{"a":1}');
    expectMode(target, OWNER_ONLY_FILE_MODE);
  });

  it('TC-39: a failure after the rename is "in place, not confirmed", never "not written"', () => {
    // The directory flush runs after the new content has replaced the old. Reporting its failure as
    // a failed write would tell the caller the old content is still there when it is not.
    const target = join(root, 'keyring.json');
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });
    let thrown: unknown;
    try {
      writeOwnerOnlyFile(target, 'new', {
        durable: true,
        syncDirectory: () => {
          throw Object.assign(new Error('I/O error'), { code: 'EIO' });
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(OwnerOnlyWriteUnconfirmedError);
    expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe('EIO');
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('writeOwnerOnlyFile — createOnly', () => {
  it('TC-40: creates the file when nothing is there, owner-only, with no temp file left', () => {
    const target = join(root, 'secure', 'keyring.json');
    writeOwnerOnlyFile(target, 'first', { createOnly: true, durable: true });
    expect(readFileSync(target, 'utf8')).toBe('first');
    expectMode(target, OWNER_ONLY_FILE_MODE);
    expect(readdirSync(join(root, 'secure'))).toEqual(['keyring.json']);
  });

  it('TC-41: refuses with EEXIST when the file appeared first, and leaves it and no temp file', () => {
    // Check-then-write would let two creators both see "absent" and the second silently replace the
    // first; the commit itself must be the check.
    const target = join(root, 'keyring.json');
    writeFileSync(target, 'theirs', { mode: OWNER_ONLY_FILE_MODE });
    let thrown: unknown;
    try {
      writeOwnerOnlyFile(target, 'mine', { createOnly: true });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as NodeJS.ErrnoException | undefined)?.code).toBe('EEXIST');
    expect(readFileSync(target, 'utf8')).toBe('theirs');
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('writeOwnerOnlyFile — beforeCommit and temporaryPath', () => {
  it('TC-50: runs the hook with the new content complete in the temp file and the target untouched', () => {
    const target = join(root, 'keyring.json');
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });
    const temporaryPath = join(root, 'keyring.json.mine.tmp');
    const seen: string[] = [];
    writeOwnerOnlyFile(target, 'new', {
      durable: true,
      temporaryPath,
      beforeCommit: () => {
        seen.push(readFileSync(target, 'utf8'), readFileSync(temporaryPath, 'utf8'));
      },
    });
    expect(seen).toEqual(['old', 'new']);
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(existsSync(temporaryPath)).toBe(false);
  });

  it('TC-51: a hook that throws leaves the target as it was and no temp file, for replace and create', () => {
    const target = join(root, 'keyring.json');
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });
    const refuse = (): never => {
      throw new Error('lost the lock');
    };
    expect(() => writeOwnerOnlyFile(target, 'new', { beforeCommit: refuse })).toThrow(
      'lost the lock',
    );
    const created = join(root, 'created.json');
    expect(() =>
      writeOwnerOnlyFile(created, 'new', { createOnly: true, beforeCommit: refuse }),
    ).toThrow('lost the lock');
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(existsSync(created)).toBe(false);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('TC-52: links through the seam for createOnly, so a filesystem without hard links is reachable', () => {
    const target = join(root, 'keyring.json');
    let thrown: unknown;
    try {
      writeOwnerOnlyFile(target, 'new', {
        createOnly: true,
        linkFile: () => {
          throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' });
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as NodeJS.ErrnoException | undefined)?.code).toBe('EPERM');
    expect(existsSync(target)).toBe(false);
    expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});

describe('stageOwnerOnlyFile', () => {
  it('flushes an owner-only temp file and leaves the target as it was until commit', () => {
    const target = join(root, 'record.json');
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });
    const order: string[] = [];

    const staged = stageOwnerOnlyFile(target, 'new', {
      syncFile: () => order.push('flush file'),
      syncDirectory: () => order.push('flush directory'),
    });

    expect(order).toEqual(['flush file']);
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readFileSync(staged.temporaryPath, 'utf8')).toBe('new');
    if (ownerOnlyGuarantee() === 'posix-mode') {
      expectMode(staged.temporaryPath, OWNER_ONLY_FILE_MODE);
    }
    staged.commit(() => order.push('before commit'));
    expect(order).toEqual(['flush file', 'before commit', 'flush directory']);
    expect(readFileSync(target, 'utf8')).toBe('new');
    expect(existsSync(staged.temporaryPath)).toBe(false);
  });

  it('flushes the parent of a directory it created, before the temp file is staged', () => {
    const flushed: string[] = [];

    stageOwnerOnlyFile(join(root, 'fresh', 'record.json'), 'new', {
      syncDirectory: (directory) => flushed.push(directory),
    }).discard();

    expect(flushed).toEqual([root]);
  });

  it('removes the temp file when the commit hook throws or the staged file is discarded', () => {
    const target = join(root, 'record.json');
    writeFileSync(target, 'old', { mode: OWNER_ONLY_FILE_MODE });

    const refused = stageOwnerOnlyFile(target, 'new');
    expect(() =>
      refused.commit(() => {
        throw new Error('changed meanwhile');
      }),
    ).toThrow('changed meanwhile');
    const discarded = stageOwnerOnlyFile(target, 'newer', {
      temporaryPath: join(root, 'record.json.other.tmp'),
    });
    discarded.discard();
    discarded.discard();

    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(root)).toEqual(['record.json']);
  });
});
