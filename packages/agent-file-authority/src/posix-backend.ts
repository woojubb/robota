import { closeSync, constants, fstatSync, readSync, type BigIntStats } from 'node:fs';

import * as koffi from 'koffi';

import { authorityError, isStableFileAuthorityError } from './contracts.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';

interface IPosixIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
}

interface IPosixFileSnapshot extends IPosixIdentity {
  readonly size: bigint;
  readonly modified: bigint;
  readonly changed: bigint;
}

type TOpen = (path: string, flags: number) => number;
type TOpenAt = (directory: number, path: string, flags: number) => number;

const CHUNK_BYTES = 1024 * 1024;

function identity(metadata: BigIntStats): IPosixIdentity {
  return { device: metadata.dev, inode: metadata.ino, mode: metadata.mode };
}

function snapshot(metadata: BigIntStats): IPosixFileSnapshot {
  return {
    ...identity(metadata),
    size: metadata.size,
    modified: metadata.mtimeNs,
    changed: metadata.ctimeNs,
  };
}

function sameIdentity(left: IPosixIdentity, right: IPosixIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.mode === right.mode;
}

function sameSnapshot(left: IPosixFileSnapshot, right: IPosixFileSnapshot): boolean {
  return (
    sameIdentity(left, right) &&
    left.size === right.size &&
    left.modified === right.modified &&
    left.changed === right.changed
  );
}

function hostCode(errno: number): string {
  for (const [name, value] of Object.entries(koffi.os.errno)) {
    if (value === errno) return name;
  }
  return `ERRNO_${errno}`;
}

function flags(directory: boolean): number {
  const closeOnExec =
    (constants as typeof constants & { readonly O_CLOEXEC?: number }).O_CLOEXEC ??
    (process.platform === 'darwin' ? 0x01000000 : 0x00080000);
  return (
    constants.O_RDONLY |
    constants.O_NOFOLLOW |
    constants.O_NONBLOCK |
    closeOnExec |
    (directory ? constants.O_DIRECTORY : 0)
  );
}

function safeFstat(descriptor: number, operation: string): BigIntStats {
  try {
    return fstatSync(descriptor, { bigint: true });
  } catch (error) {
    const code = nodeErrorCode(error);
    throw authorityError('HOST_IO', operation, code === undefined ? {} : { hostCode: code });
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/** POSIX implementation; descriptors never leave this module. */
export class PosixStableFileHostBackend implements IStableFileHostBackend {
  private readonly openAt: TOpenAt;
  private readonly rootIdentity: IPosixIdentity;
  private rootDescriptor: number | undefined;

  constructor(rootDirectory: string) {
    try {
      const libc = koffi.load(
        process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
      );
      const open = libc.func('int open(const char *path, int flags)') as TOpen;
      this.openAt = libc.func('int openat(int fd, const char *path, int flags)') as TOpenAt;
      const descriptor = open(rootDirectory, flags(true));
      if (descriptor < 0) this.throwOpenFailure(koffi.errno(), 'open-root');
      this.rootDescriptor = descriptor;
      const metadata = safeFstat(descriptor, 'inspect-root');
      if (!metadata.isDirectory()) throw authorityError('UNSAFE_ENTRY', 'open-root');
      this.rootIdentity = identity(metadata);
    } catch (error) {
      if (this.rootDescriptor !== undefined) {
        this.closeDescriptor(this.rootDescriptor);
        this.rootDescriptor = undefined;
      }
      if (isStableFileAuthorityError(error)) throw error;
      throw authorityError('UNSUPPORTED_BACKEND', 'load-posix-backend');
    }
  }

  readBytes(
    relativeSegments: readonly string[],
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array | undefined {
    const rootDescriptor = this.rootDescriptor;
    if (rootDescriptor === undefined) throw authorityError('AUTHORITY_CLOSED', 'read');
    this.assertRootIdentity(rootDescriptor);

    let parentDescriptor = rootDescriptor;
    let ownsParent = false;
    let fileDescriptor: number | undefined;
    try {
      for (let index = 0; index < relativeSegments.length; index += 1) {
        const final = index === relativeSegments.length - 1;
        const descriptor = this.openAt(parentDescriptor, relativeSegments[index], flags(!final));
        if (descriptor < 0) {
          const errno = koffi.errno();
          if (errno === koffi.os.errno.ENOENT) return undefined;
          this.throwOpenFailure(errno, final ? 'open-file' : 'open-directory', index);
        }

        if (final) {
          fileDescriptor = descriptor;
          break;
        }

        const metadata = safeFstat(descriptor, 'inspect-directory');
        if (!metadata.isDirectory()) {
          this.closeDescriptor(descriptor);
          throw authorityError('UNSAFE_ENTRY', 'inspect-directory', { segmentIndex: index });
        }
        if (ownsParent) this.closeDescriptor(parentDescriptor);
        parentDescriptor = descriptor;
        ownsParent = true;
        hooks.afterDirectoryOpened?.(index);
      }

      if (fileDescriptor === undefined) throw authorityError('HOST_IO', 'open-file');
      const bytes = this.readFile(fileDescriptor, maxBytes, hooks);
      this.assertRootIdentity(rootDescriptor);
      return bytes;
    } catch (error) {
      if (isStableFileAuthorityError(error)) throw error;
      const code = nodeErrorCode(error);
      throw authorityError('HOST_IO', 'read', code === undefined ? {} : { hostCode: code });
    } finally {
      if (fileDescriptor !== undefined) this.closeDescriptor(fileDescriptor);
      if (ownsParent) this.closeDescriptor(parentDescriptor);
    }
  }

  close(): void {
    const descriptor = this.rootDescriptor;
    if (descriptor === undefined) return;
    this.rootDescriptor = undefined;
    this.closeDescriptor(descriptor);
  }

  private readFile(
    descriptor: number,
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array {
    const beforeMetadata = safeFstat(descriptor, 'inspect-file');
    if (!beforeMetadata.isFile()) throw authorityError('UNSAFE_ENTRY', 'inspect-file');
    if (beforeMetadata.size > BigInt(maxBytes)) throw authorityError('OVER_BUDGET', 'read-file');

    const expectedBytes = Number(beforeMetadata.size);
    let bytes: Buffer;
    try {
      bytes = Buffer.alloc(expectedBytes);
    } catch {
      throw authorityError('HOST_IO', 'allocate-read-buffer');
    }

    let offset = 0;
    while (offset < expectedBytes) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        Math.min(CHUNK_BYTES, expectedBytes - offset),
        offset,
      );
      if (count === 0) break;
      offset += count;
      hooks.afterReadChunk?.(offset);
    }

    const probe = Buffer.alloc(1);
    const grew = readSync(descriptor, probe, 0, 1, expectedBytes) !== 0;
    const afterMetadata = safeFstat(descriptor, 'reinspect-file');
    if (grew && expectedBytes >= maxBytes) throw authorityError('OVER_BUDGET', 'read-file');
    if (
      offset !== expectedBytes ||
      grew ||
      !sameSnapshot(snapshot(beforeMetadata), snapshot(afterMetadata))
    ) {
      throw authorityError('FILE_CHANGED', 'read-file');
    }
    return bytes;
  }

  private assertRootIdentity(descriptor: number): void {
    const metadata = safeFstat(descriptor, 'inspect-root');
    if (!metadata.isDirectory() || !sameIdentity(this.rootIdentity, identity(metadata))) {
      throw authorityError('ROOT_CHANGED', 'inspect-root');
    }
  }

  private throwOpenFailure(errno: number, operation: string, segmentIndex?: number): never {
    const code = hostCode(errno);
    const details =
      segmentIndex === undefined ? { hostCode: code } : { hostCode: code, segmentIndex };
    if (
      errno === koffi.os.errno.ELOOP ||
      errno === koffi.os.errno.ENOTDIR ||
      errno === koffi.os.errno.EISDIR
    ) {
      throw authorityError('UNSAFE_ENTRY', operation, details);
    }
    throw authorityError('HOST_IO', operation, details);
  }

  private closeDescriptor(descriptor: number): void {
    try {
      closeSync(descriptor);
    } catch {
      // A close failure cannot make a later read safe. The descriptor is never reused by this object.
    }
  }
}
