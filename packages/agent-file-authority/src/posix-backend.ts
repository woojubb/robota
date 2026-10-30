import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  readSync,
  writeFileSync,
  type BigIntStats,
} from 'node:fs';

import * as koffi from 'koffi';

import { authorityError, StableFileAuthorityError } from './contracts.js';

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
type TOpenAt = (directory: number, path: string, flags: number, mode: number) => number;
type TVariadicOpenAt = (
  directory: number,
  path: string,
  flags: number,
  modeType: 'unsigned int',
  mode: number,
) => number;
type TMkdirAt = (directory: number, path: string, mode: number) => number;
type TRenameAt = (
  sourceDirectory: number,
  source: string,
  targetDirectory: number,
  target: string,
) => number;
type TExchangeAt = TRenameAt;
type TUnlinkAt = (directory: number, path: string, flags: number) => number;
type TFchmod = (descriptor: number, mode: number) => number;

const CHUNK_BYTES = 1_048_576;
const DARWIN_CLOSE_ON_EXEC = 0x01000000;
const LINUX_CLOSE_ON_EXEC = 0x00080000;
const RENAME_EXCHANGE = 0x00000002;
const DARWIN_RENAME_EXCLUSIVE = 0x00000004;
const LINUX_RENAME_NO_REPLACE = 0x00000001;
const TEMP_RANDOM_BYTES = 16;
const WRITE_MODE_BITS = 0o7777;
const MAX_TEMP_ATTEMPTS = 32;

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

function sameObject(left: IPosixIdentity, right: IPosixIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
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
    (process.platform === 'darwin' ? DARWIN_CLOSE_ON_EXEC : LINUX_CLOSE_ON_EXEC);
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
    const code = nodeErrorCode(typeof error === 'object' ? error : null);
    throw authorityError('HOST_IO', operation, code === undefined ? {} : { hostCode: code });
  }
}

function nodeErrorCode(error: object | null): string | undefined {
  if (error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

interface IPosixFunctions {
  readonly library: unknown;
  readonly open: TOpen;
  readonly openAt: TOpenAt;
  readonly mkdirAt: TMkdirAt;
  readonly noReplaceAt: TRenameAt;
  readonly exchangeAt: TExchangeAt;
  readonly unlinkAt: TUnlinkAt;
  readonly fchmod: TFchmod;
}

let libc: IPosixFunctions | undefined;
// Held as soon as it loads, even if declaring a function below then throws.
const retainedLibraries: unknown[] = [];

/**
 * libc is loaded once per process and the library handle itself is kept alive with its functions.
 * Bun aborts when Koffi's finalizer for a collected library handle runs ("Finalizer is calling a
 * function that may affect GC state"), so no handle may ever become garbage.
 */
function libcFunctions(): IPosixFunctions {
  if (!libc) {
    const library = koffi.load(
      process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6',
    );
    retainedLibraries.push(library);
    const renameExchange =
      process.platform === 'darwin'
        ? (library.func(
            'int renameatx_np(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags)',
          ) as (
            sourceDirectory: number,
            source: string,
            targetDirectory: number,
            target: string,
            flags: number,
          ) => number)
        : (library.func(
            'int renameat2(int olddirfd, const char *oldpath, int newdirfd, const char *newpath, unsigned int flags)',
          ) as (
            sourceDirectory: number,
            source: string,
            targetDirectory: number,
            target: string,
            flags: number,
          ) => number);
    const variadicOpenAt = library.func(
      'int openat(int fd, const char *path, int flags, ...)',
    ) as TVariadicOpenAt;
    libc = {
      library,
      open: library.func('int open(const char *path, int flags)') as TOpen,
      openAt: (directory, path, openFlags, mode) =>
        variadicOpenAt(directory, path, openFlags, 'unsigned int', mode),
      mkdirAt: library.func('int mkdirat(int fd, const char *path, unsigned int mode)') as TMkdirAt,
      noReplaceAt: (sourceDirectory, source, targetDirectory, target) =>
        renameExchange(
          sourceDirectory,
          source,
          targetDirectory,
          target,
          process.platform === 'darwin' ? DARWIN_RENAME_EXCLUSIVE : LINUX_RENAME_NO_REPLACE,
        ),
      exchangeAt: (sourceDirectory, source, targetDirectory, target) =>
        renameExchange(sourceDirectory, source, targetDirectory, target, RENAME_EXCHANGE),
      unlinkAt: library.func('int unlinkat(int fd, const char *path, int flags)') as TUnlinkAt,
      fchmod: library.func('int fchmod(int fd, unsigned int mode)') as TFchmod,
    };
  }
  return libc;
}

/** POSIX implementation; descriptors never leave this module. */
export class PosixStableFileHostBackend implements IStableFileHostBackend {
  private readonly openAt: TOpenAt;
  private readonly rootIdentity: IPosixIdentity;
  private rootDescriptor: number | undefined;

  constructor(rootDirectory: string) {
    try {
      const { open, openAt } = libcFunctions();
      this.openAt = openAt;
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
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('UNSUPPORTED_BACKEND', 'load-posix-backend');
    }
  }

  assertNamedRoot(rootDirectory: string): void {
    if (this.rootDescriptor === undefined) throw authorityError('AUTHORITY_CLOSED', 'inspect-root');
    this.assertRootIdentity(this.rootDescriptor);
    const descriptor = libcFunctions().open(rootDirectory, flags(true));
    if (descriptor < 0) throw authorityError('ROOT_CHANGED', 'inspect-named-root');
    try {
      const metadata = safeFstat(descriptor, 'inspect-named-root');
      if (!metadata.isDirectory() || !sameObject(this.rootIdentity, identity(metadata))) {
        throw authorityError('ROOT_CHANGED', 'inspect-named-root');
      }
    } finally {
      this.closeDescriptor(descriptor);
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
        const descriptor = this.openAt(parentDescriptor, relativeSegments[index], flags(!final), 0);
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
      if (error instanceof StableFileAuthorityError) throw error;
      const code = nodeErrorCode(typeof error === 'object' ? error : null);
      throw authorityError('HOST_IO', 'read', code === undefined ? {} : { hostCode: code });
    } finally {
      this.closeOptionalDescriptor(fileDescriptor);
      this.closeOptionalDescriptor(ownsParent ? parentDescriptor : undefined);
    }
  }

  writeUtf8(
    relativeSegments: readonly string[],
    content: string,
    hooks: IFileAuthorityTestHooks,
  ): void {
    const rootDescriptor = this.rootDescriptor;
    if (rootDescriptor === undefined) throw authorityError('AUTHORITY_CLOSED', 'write');
    this.assertRootIdentity(rootDescriptor);

    const parentSegments = relativeSegments.slice(0, -1);
    const targetName = relativeSegments.at(-1);
    if (targetName === undefined) throw authorityError('INVALID_PATH', 'write');

    let parentDescriptor = rootDescriptor;
    let ownsParent = false;
    let temporaryDescriptor: number | undefined;
    let temporaryName: string | undefined;
    let cleanTemporaryName = true;
    let exchanged = false;
    let existingIdentity: IPosixIdentity | undefined;
    try {
      const walked = this.openWriteParent(rootDescriptor, parentSegments, hooks);
      parentDescriptor = walked.descriptor;
      ownsParent = walked.owned;
      existingIdentity = this.readExistingFileIdentity(parentDescriptor, targetName);

      const temporary = this.createTemporaryFile(
        parentDescriptor,
        existingIdentity === undefined ? 0o666 : 0o600,
      );
      temporaryDescriptor = temporary.descriptor;
      temporaryName = temporary.name;
      writeFileSync(temporaryDescriptor, content, 'utf8');
      if (existingIdentity !== undefined) {
        this.setMode(temporaryDescriptor, Number(existingIdentity.mode & BigInt(WRITE_MODE_BITS)));
      }
      fsyncSync(temporaryDescriptor);
      const temporaryIdentity = identity(safeFstat(temporaryDescriptor, 'inspect-temporary'));
      hooks.afterTemporaryWritten?.(temporaryName);

      this.assertDirectoryChain(rootDescriptor, parentSegments, walked.identities);
      this.assertNamedIdentity(parentDescriptor, temporaryName, temporaryIdentity, 'temporary');
      hooks.afterPreCommitValidated?.();
      const stagedName = temporaryName;

      let committed = false;
      try {
        if (existingIdentity === undefined) {
          this.renameWithoutReplacement(parentDescriptor, stagedName, targetName);
        } else {
          this.exchange(parentDescriptor, stagedName, targetName);
          exchanged = true;
        }
        committed = true;
        cleanTemporaryName = false;

        const targetIdentity = this.readNamedIdentity(
          parentDescriptor,
          targetName,
          'inspect-target',
          true,
        );
        if (targetIdentity === undefined || !sameObject(targetIdentity, temporaryIdentity)) {
          throw authorityError('FILE_CHANGED', 'commit-write');
        }

        if (exchanged) {
          if (existingIdentity === undefined) throw authorityError('HOST_IO', 'commit-write');
          const displaced = this.readNamedIdentity(
            parentDescriptor,
            stagedName,
            'inspect-displaced',
            true,
          );
          if (displaced === undefined || !sameObject(displaced, existingIdentity)) {
            throw authorityError('FILE_CHANGED', 'commit-write');
          }
        }

        this.assertDirectoryChain(rootDescriptor, parentSegments, walked.identities);
        this.assertRootIdentity(rootDescriptor);

        if (exchanged) this.unlink(parentDescriptor, stagedName, false);
        temporaryName = undefined;
      } catch (error) {
        if (
          committed &&
          this.rollbackCommittedWrite(
            parentDescriptor,
            stagedName,
            targetName,
            temporaryIdentity,
            existingIdentity,
            exchanged,
          )
        ) {
          cleanTemporaryName = true;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof StableFileAuthorityError) throw error;
      const code = nodeErrorCode(typeof error === 'object' ? error : null);
      throw authorityError('HOST_IO', 'write', code === undefined ? {} : { hostCode: code });
    } finally {
      if (temporaryName !== undefined && cleanTemporaryName) {
        this.unlink(parentDescriptor, temporaryName, true);
      }
      this.closeOptionalDescriptor(temporaryDescriptor);
      this.closeOptionalDescriptor(ownsParent ? parentDescriptor : undefined);
    }
  }

  close(): void {
    const descriptor = this.rootDescriptor;
    if (descriptor === undefined) return;
    this.rootDescriptor = undefined;
    this.closeDescriptor(descriptor);
  }

  private openWriteParent(
    rootDescriptor: number,
    segments: readonly string[],
    hooks: IFileAuthorityTestHooks,
  ): { descriptor: number; owned: boolean; identities: readonly IPosixIdentity[] } {
    let parentDescriptor = rootDescriptor;
    let ownsParent = false;
    const identities: IPosixIdentity[] = [];
    try {
      for (let index = 0; index < segments.length; index += 1) {
        let descriptor = this.openAt(parentDescriptor, segments[index], flags(true), 0);
        if (descriptor < 0 && koffi.errno() === koffi.os.errno.ENOENT) {
          const { mkdirAt } = libcFunctions();
          if (mkdirAt(parentDescriptor, segments[index], 0o777) < 0) {
            const errno = koffi.errno();
            if (errno !== koffi.os.errno.EEXIST) {
              this.throwOpenFailure(errno, 'create-directory', index);
            }
          }
          descriptor = this.openAt(parentDescriptor, segments[index], flags(true), 0);
        }
        if (descriptor < 0) this.throwOpenFailure(koffi.errno(), 'open-directory', index);
        const metadata = safeFstat(descriptor, 'inspect-directory');
        if (!metadata.isDirectory()) {
          this.closeDescriptor(descriptor);
          throw authorityError('UNSAFE_ENTRY', 'inspect-directory', { segmentIndex: index });
        }
        if (ownsParent) this.closeDescriptor(parentDescriptor);
        parentDescriptor = descriptor;
        ownsParent = true;
        identities.push(identity(metadata));
        hooks.afterDirectoryOpened?.(index);
      }
      return { descriptor: parentDescriptor, owned: ownsParent, identities };
    } catch (error) {
      if (ownsParent) this.closeDescriptor(parentDescriptor);
      throw error;
    }
  }

  private assertDirectoryChain(
    rootDescriptor: number,
    segments: readonly string[],
    expected: readonly IPosixIdentity[],
  ): void {
    this.assertRootIdentity(rootDescriptor);
    let parentDescriptor = rootDescriptor;
    let ownsParent = false;
    try {
      for (let index = 0; index < segments.length; index += 1) {
        const descriptor = this.openAt(parentDescriptor, segments[index], flags(true), 0);
        if (descriptor < 0) this.throwOpenFailure(koffi.errno(), 'reopen-directory', index);
        const metadata = safeFstat(descriptor, 'reinspect-directory');
        if (!metadata.isDirectory() || !sameIdentity(expected[index], identity(metadata))) {
          this.closeDescriptor(descriptor);
          throw authorityError('FILE_CHANGED', 'reinspect-directory', { segmentIndex: index });
        }
        if (ownsParent) this.closeDescriptor(parentDescriptor);
        parentDescriptor = descriptor;
        ownsParent = true;
      }
    } finally {
      if (ownsParent) this.closeDescriptor(parentDescriptor);
    }
  }

  private readExistingFileIdentity(
    parentDescriptor: number,
    targetName: string,
  ): IPosixIdentity | undefined {
    return this.readNamedIdentity(parentDescriptor, targetName, 'inspect-existing');
  }

  private readNamedIdentity(
    parentDescriptor: number,
    name: string,
    operation: string,
    unsafeAsMissing = false,
  ): IPosixIdentity | undefined {
    const descriptor = this.openAt(parentDescriptor, name, flags(false), 0);
    if (descriptor < 0) {
      const errno = koffi.errno();
      if (errno === koffi.os.errno.ENOENT) return undefined;
      if (
        unsafeAsMissing &&
        (errno === koffi.os.errno.ELOOP ||
          errno === koffi.os.errno.ENOTDIR ||
          errno === koffi.os.errno.EISDIR)
      ) {
        return undefined;
      }
      this.throwOpenFailure(errno, operation);
    }
    try {
      const metadata = safeFstat(descriptor, operation);
      if (!metadata.isFile()) {
        if (unsafeAsMissing) return undefined;
        throw authorityError('UNSAFE_ENTRY', operation);
      }
      return identity(metadata);
    } finally {
      this.closeDescriptor(descriptor);
    }
  }

  private createTemporaryFile(
    parentDescriptor: number,
    mode: number,
  ): { descriptor: number; name: string } {
    const closeOnExec =
      (constants as typeof constants & { readonly O_CLOEXEC?: number }).O_CLOEXEC ??
      (process.platform === 'darwin' ? DARWIN_CLOSE_ON_EXEC : LINUX_CLOSE_ON_EXEC);
    const temporaryFlags =
      constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW |
      closeOnExec;
    for (let attempt = 0; attempt < MAX_TEMP_ATTEMPTS; attempt += 1) {
      const name = `.atomic-tmp-${randomBytes(TEMP_RANDOM_BYTES).toString('hex')}`;
      const descriptor = this.openAt(parentDescriptor, name, temporaryFlags, mode);
      if (descriptor >= 0) return { descriptor, name };
      const errno = koffi.errno();
      if (errno !== koffi.os.errno.EEXIST) this.throwOpenFailure(errno, 'create-temporary');
    }
    throw authorityError('HOST_IO', 'create-temporary', { hostCode: 'EEXIST' });
  }

  private assertNamedIdentity(
    parentDescriptor: number,
    name: string,
    expected: IPosixIdentity,
    operation: string,
  ): void {
    const actual = this.readNamedIdentity(parentDescriptor, name, `inspect-${operation}`);
    if (actual === undefined || !sameObject(actual, expected)) {
      throw authorityError('FILE_CHANGED', `inspect-${operation}`);
    }
  }

  private setMode(descriptor: number, mode: number): void {
    if (libcFunctions().fchmod(descriptor, mode) < 0) {
      throw authorityError('HOST_IO', 'set-temporary-mode', {
        hostCode: hostCode(koffi.errno()),
      });
    }
  }

  private renameWithoutReplacement(parentDescriptor: number, source: string, target: string): void {
    if (libcFunctions().noReplaceAt(parentDescriptor, source, parentDescriptor, target) >= 0)
      return;
    const errno = koffi.errno();
    if (errno === koffi.os.errno.EEXIST) throw authorityError('FILE_CHANGED', 'commit-write');
    throw authorityError('HOST_IO', 'commit-write', { hostCode: hostCode(errno) });
  }

  private exchange(parentDescriptor: number, source: string, target: string): void {
    if (libcFunctions().exchangeAt(parentDescriptor, source, parentDescriptor, target) < 0) {
      throw authorityError('HOST_IO', 'commit-write', { hostCode: hostCode(koffi.errno()) });
    }
  }

  private unlink(parentDescriptor: number, name: string, ignoreMissing: boolean): void {
    if (libcFunctions().unlinkAt(parentDescriptor, name, 0) >= 0) return;
    const errno = koffi.errno();
    if (ignoreMissing && errno === koffi.os.errno.ENOENT) return;
    if (ignoreMissing) return;
    throw authorityError('HOST_IO', 'remove-temporary', { hostCode: hostCode(errno) });
  }

  private rollbackCommittedWrite(
    parentDescriptor: number,
    temporaryName: string,
    targetName: string,
    temporaryIdentity: IPosixIdentity,
    existingIdentity: IPosixIdentity | undefined,
    exchanged: boolean,
  ): boolean {
    try {
      const target = this.readNamedIdentity(
        parentDescriptor,
        targetName,
        'inspect-rollback-target',
        true,
      );
      if (target === undefined || !sameObject(target, temporaryIdentity)) return false;
      if (!exchanged || existingIdentity === undefined) {
        this.renameWithoutReplacement(parentDescriptor, targetName, temporaryName);
        return true;
      }
      const displaced = this.readNamedIdentity(
        parentDescriptor,
        temporaryName,
        'inspect-rollback-displaced',
        true,
      );
      if (displaced === undefined || !sameObject(displaced, existingIdentity)) return false;
      this.exchange(parentDescriptor, temporaryName, targetName);
      return true;
    } catch {
      // allow-fallback: the original failure is retained; no unsafe pathname fallback is attempted
      return false;
    }
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
      // allow-fallback: descriptor close failures cannot restore authority or make a later read safe
    }
  }

  private closeOptionalDescriptor(descriptor: number | undefined): void {
    if (descriptor !== undefined) this.closeDescriptor(descriptor);
  }
}
