/**
 * SEC-020 (issue #2021) — the owner-only host store, asserted against a real filesystem.
 *
 * Every case sets a PERMISSIVE umask explicitly. A test that inherits a restrictive umask passes
 * whether or not the mode was requested, which is the accidental-green shape this repository keeps
 * finding: the assertion holds either way, so it asserts nothing.
 */

import { chmodSync, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  OwnerOnlyModeError,
  ensureOwnerOnlyDirectory,
  ownerOnlyGuarantee,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from './owner-only-store.js';

const PERMISSIVE_UMASK = 0o022;

let root: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(PERMISSIVE_UMASK);
  root = mkdtempSync(join(tmpdir(), 'owner-only-'));
});

afterEach(() => {
  process.umask(previousUmask);
});

const mode = (path: string): number => statSync(path).mode & 0o7777;

describe('SEC-020 — ensureOwnerOnlyDirectory', () => {
  it('TC-01: creates a directory only its owner can enter, under a permissive umask', () => {
    const target = join(root, 'sessions');
    ensureOwnerOnlyDirectory(target);
    expect(mode(target)).toBe(OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-02: TIGHTENS a directory that already exists at a wider mode', () => {
    // `mkdirSync(path, { recursive: true, mode })` returns successfully on an existing directory
    // WITHOUT touching its mode. This is the case the old `if (!existsSync) mkdirSync` skipped
    // entirely, and it is the one an attacker creates by pre-making the directory.
    const target = join(root, 'pre-existing');
    mkdirSync(target);
    chmodSync(target, 0o777);
    expect(mode(target)).toBe(0o777);
    ensureOwnerOnlyDirectory(target);
    expect(mode(target)).toBe(OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-03: is idempotent', () => {
    const target = join(root, 'twice');
    ensureOwnerOnlyDirectory(target);
    ensureOwnerOnlyDirectory(target);
    expect(mode(target)).toBe(OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-04: creates missing parents, and every one of them is owner-only', () => {
    const target = join(root, 'a', 'b', 'c');
    ensureOwnerOnlyDirectory(target);
    expect(mode(target)).toBe(OWNER_ONLY_DIRECTORY_MODE);
    expect(mode(join(root, 'a'))).toBe(OWNER_ONLY_DIRECTORY_MODE);
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
    expect(mode(target)).toBe(OWNER_ONLY_FILE_MODE);
    expect(mode(join(root, 'store'))).toBe(OWNER_ONLY_DIRECTORY_MODE);
  });

  it('TC-07: REPLACES a file that already exists at a wider mode', () => {
    // `writeFileSync(path, data, { mode })` applies the mode only when the file is CREATED, so a
    // record an older version left at 0644 keeps 0644 through every later save.
    const target = join(root, 'record.json');
    writeFileSync(target, 'old');
    chmodSync(target, 0o644);
    writeOwnerOnlyFile(target, 'new');
    expect(mode(target)).toBe(OWNER_ONLY_FILE_MODE);
  });

  it('TC-08: leaves no temp file behind on success', () => {
    const target = join(root, 'record.json');
    writeOwnerOnlyFile(target, 'x');
    expect(existsSync(`${target}.${process.pid}.tmp`)).toBe(false);
  });

  it('TC-09: a temp path left at a wider mode is not adopted', () => {
    // The window this closes: the bytes are on disk under the temp name before the rename, so a
    // temp file created world-readable exposes the whole record even though the final path is 0600.
    const target = join(root, 'record.json');
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, 'stale');
    chmodSync(temp, 0o666);
    writeOwnerOnlyFile(target, 'fresh');
    expect(mode(target)).toBe(OWNER_ONLY_FILE_MODE);
  });
});

describe('SEC-020 — tightenExistingFile', () => {
  it('TC-10: narrows a file an older version left readable', () => {
    const target = join(root, 'old.jsonl');
    writeFileSync(target, 'line\n');
    chmodSync(target, 0o644);
    tightenExistingFile(target);
    expect(mode(target)).toBe(OWNER_ONLY_FILE_MODE);
  });

  it('TC-11: is a no-op on a path that does not exist, and does not throw', () => {
    expect(() => tightenExistingFile(join(root, 'absent'))).not.toThrow();
  });

  it('TC-12: leaves an already-owner-only file alone', () => {
    const target = join(root, 'fine');
    writeFileSync(target, 'x', { mode: OWNER_ONLY_FILE_MODE });
    chmodSync(target, OWNER_ONLY_FILE_MODE);
    tightenExistingFile(target);
    expect(mode(target)).toBe(OWNER_ONLY_FILE_MODE);
  });
});

describe('SEC-020 — the guarantee is named, not assumed', () => {
  it('TC-13: Windows cannot express owner-only through chmod, and says so', () => {
    // Asserted through the injected platform so the case runs on Linux CI. The point is that the
    // module reports which guarantee is in force rather than making the POSIX claim everywhere —
    // on win32 inherited NTFS ACLs govern, and a project-local `.robota` inside a world-writable
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
  it('TC-29: a filesystem that silently ignores chmod is REFUSED, not used', () => {
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
  });

  it('TC-30: the refusal names the mode it found, so the message is actionable', () => {
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
  });
});
