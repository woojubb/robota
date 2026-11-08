/**
 * Which file a path names and which file a descriptor holds, as `append-file-rewrite.ts` compares
 * them before it replaces a file by rename. The comparison differs by platform: POSIX needs the inode
 * and the device to agree, while a Windows path reports no device number, so only the file index is
 * compared there. The platform-specific cases pass the platform in, so each is asserted on every host;
 * the real-file cases run the host's own stat numbers through the same comparison.
 */
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isSameFileIdentity, openAppendFile } from '../append-file-rewrite.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-append-identity-')));
  roots.push(root);
  return root;
}

describe('isSameFileIdentity', () => {
  it('on POSIX needs the inode and the device to agree', () => {
    const file = { ino: 42n, dev: 7n };
    expect(isSameFileIdentity(file, { ino: 42n, dev: 7n }, 'linux')).toBe(true);
    expect(isSameFileIdentity(file, { ino: 42n, dev: 7n }, 'darwin')).toBe(true);
    expect(isSameFileIdentity(file, { ino: 43n, dev: 7n }, 'linux')).toBe(false);
    expect(isSameFileIdentity(file, { ino: 42n, dev: 8n }, 'linux')).toBe(false);
    expect(isSameFileIdentity({ ino: 42n, dev: 0n }, { ino: 42n, dev: 7n }, 'darwin')).toBe(false);
  });

  it('on Windows compares the file index alone, because a path reports no device number', () => {
    const named = { ino: 0x0003000000012345n, dev: 0n };
    expect(isSameFileIdentity(named, { ino: 0x0003000000012345n, dev: 1422631540n }, 'win32')).toBe(
      true,
    );
    expect(isSameFileIdentity(named, { ino: 0x0003000000012346n, dev: 1422631540n }, 'win32')).toBe(
      false,
    );
  });

  it('on Windows keeps a file index too wide for a double exact', () => {
    const wide = 0x7fff_ffff_ffff_ffffn;
    expect(isSameFileIdentity({ ino: wide, dev: 0n }, { ino: wide, dev: 5n }, 'win32')).toBe(true);
    expect(isSameFileIdentity({ ino: wide, dev: 0n }, { ino: wide - 1n, dev: 5n }, 'win32')).toBe(
      false,
    );
  });

  it('on Windows treats a file index of 0 as no identity, so nothing is the same file', () => {
    expect(isSameFileIdentity({ ino: 0n, dev: 0n }, { ino: 0n, dev: 9n }, 'win32')).toBe(false);
  });
});

describe('the identity of a real file on this platform', () => {
  it('is the same for the path and the descriptor opened on it, and not for another file', () => {
    const root = directory();
    const first = join(root, 'first.jsonl');
    const second = join(root, 'second.jsonl');
    writeFileSync(first, 'one\n');
    writeFileSync(second, 'two\n');

    const descriptor = openSync(first, 'r');
    try {
      const held = fstatSync(descriptor, { bigint: true });
      expect(isSameFileIdentity(lstatSync(first, { bigint: true }), held)).toBe(true);
      expect(isSameFileIdentity(lstatSync(second, { bigint: true }), held)).toBe(false);
    } finally {
      closeSync(descriptor);
    }
  });
});

describe('openAppendFile', () => {
  it('opens a regular file of its own for reading', () => {
    const root = directory();
    const path = join(root, 'history.jsonl');
    writeFileSync(path, 'one\n');

    const opened = openAppendFile(path);

    expect(opened.status).toBe('open');
    if (opened.status === 'open') closeSync(opened.descriptor);
  });

  it('says a path with nothing at it is missing and a directory is not a regular file', () => {
    const root = directory();
    expect(openAppendFile(join(root, 'absent.jsonl'))).toEqual({ status: 'missing' });
    mkdirSync(join(root, 'directory'));
    expect(openAppendFile(join(root, 'directory'))).toEqual({
      status: 'refused',
      reason: 'not-a-regular-file',
    });
  });
});
