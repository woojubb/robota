import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';

import * as koffi from 'koffi';

import { tryWindowsOperationLock } from './windows-process-operation-lock.js';

/** A held OS lock; releasing it twice is harmless. */
export interface IProcessOperationLockHandle {
  release(): void;
}

/** Nonblocking exclusive operation locks for names in one host-owned directory. */
export interface IProcessOperationLock {
  tryAcquire(name: string): IProcessOperationLockHandle | undefined;
}

const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;
type TFlock = (descriptor: number, operation: number) => number;
let flock: TFlock | undefined;
const retainedLibraries: unknown[] = [];

function posixFlock(): TFlock {
  if (flock === undefined) {
    const library = koffi.load(
      process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
    );
    retainedLibraries.push(library);
    flock = library.func('int flock(int fd, int operation)') as TFlock;
  }
  return flock;
}

function posixLock(path: string): IProcessOperationLockHandle | undefined {
  const descriptor = openSync(
    path,
    constants.O_RDWR | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    const pathStat = lstatSync(path, { bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== pathStat.dev ||
      opened.ino !== pathStat.ino
    ) {
      throw new Error('The process operation lock is not a unique regular file.');
    }
    fchmodSync(descriptor, 0o600);
    const fn = posixFlock();
    if (fn(descriptor, LOCK_EX | LOCK_NB) !== 0) {
      const errno = koffi.errno();
      if (errno === koffi.os.errno.EAGAIN || errno === koffi.os.errno.EWOULDBLOCK) {
        closeSync(descriptor);
        return undefined;
      }
      throw new Error(`Could not acquire a process operation lock (errno ${errno}).`);
    }
    let released = false;
    return Object.freeze({
      release: (): void => {
        if (released) return;
        released = true;
        try {
          fn(descriptor, LOCK_UN);
        } finally {
          closeSync(descriptor);
        }
      },
    });
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

/**
 * Creates a host lock whose file is never unlinked while this namespace is in use. The OS releases
 * the lock if its owner exits, including on a crash. A separate same-user program can still replace
 * the path on POSIX; this is cooperative coordination, not a same-user security boundary.
 */
export function createProcessOperationLock(directory: string): IProcessOperationLock {
  const root = resolve(directory);
  return Object.freeze({
    tryAcquire: (name: string): IProcessOperationLockHandle | undefined => {
      if (!VALID_NAME.test(name))
        throw new Error('A process operation lock name must be one safe path component.');
      const path = join(root, `${name}.guard`);
      if (process.platform === 'win32') {
        return tryWindowsOperationLock(path);
      }
      if (process.platform === 'darwin' || process.platform === 'linux') return posixLock(path);
      throw new Error('Process operation locking is unsupported on this platform.');
    },
  });
}
