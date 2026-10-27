import { randomBytes } from 'node:crypto';

import { authorityError, StableFileAuthorityError } from './contracts.js';
import { WindowsNativeAuthority, type IWindowsIdentity } from './windows-native-authority.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';
import type { TNativeHandle } from './windows-native-api.js';

const TEMP_RANDOM_BYTES = 16;
const MAX_TEMP_ATTEMPTS = 32;

function sameIdentity(left: IWindowsIdentity, right: IWindowsIdentity): boolean {
  return left.volume === right.volume && left.fileId === right.fileId;
}

/** Windows implementation; native HANDLE values never leave the native authority module. */
export class WindowsStableFileHostBackend implements IStableFileHostBackend {
  private readonly native = new WindowsNativeAuthority();
  private readonly rootIdentity: IWindowsIdentity;
  private rootHandle: TNativeHandle | undefined;

  constructor(rootDirectory: string) {
    try {
      const handle = this.native.openRoot(rootDirectory);
      this.rootHandle = handle;
      this.rootIdentity = this.native.queryIdentity(handle, 'inspect-root');
    } catch (error) {
      if (this.rootHandle !== undefined) {
        this.native.close(this.rootHandle);
        this.rootHandle = undefined;
      }
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('UNSUPPORTED_BACKEND', 'load-windows-backend');
    }
  }

  readBytes(
    relativeSegments: readonly string[],
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array | undefined {
    const rootHandle = this.rootHandle;
    if (rootHandle === undefined) throw authorityError('AUTHORITY_CLOSED', 'read');
    this.assertRootIdentity(rootHandle);

    let parentHandle = rootHandle;
    let ownsParent = false;
    let fileHandle: TNativeHandle | undefined;
    try {
      for (let index = 0; index < relativeSegments.length; index += 1) {
        const final = index === relativeSegments.length - 1;
        const handle = this.native.openRelative(
          parentHandle,
          relativeSegments[index],
          final,
          index,
        );
        if (handle === undefined) return undefined;
        if (final) {
          fileHandle = handle;
          break;
        }
        if (ownsParent) this.native.close(parentHandle);
        parentHandle = handle;
        ownsParent = true;
        hooks.afterDirectoryOpened?.(index);
      }

      if (fileHandle === undefined) throw authorityError('HOST_IO', 'open-file');
      const bytes = this.native.readFile(fileHandle, maxBytes, hooks);
      this.assertRootIdentity(rootHandle);
      return bytes;
    } catch (error) {
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('HOST_IO', 'read');
    } finally {
      if (fileHandle !== undefined) this.native.close(fileHandle);
      if (ownsParent) this.native.close(parentHandle);
    }
  }

  writeUtf8(
    relativeSegments: readonly string[],
    content: string,
    hooks: IFileAuthorityTestHooks,
  ): void {
    const rootHandle = this.rootHandle;
    if (rootHandle === undefined) throw authorityError('AUTHORITY_CLOSED', 'write');
    this.assertRootIdentity(rootHandle);

    const parentSegments = relativeSegments.slice(0, -1);
    const targetName = relativeSegments.at(-1);
    if (targetName === undefined) throw authorityError('INVALID_PATH', 'write');

    let parentHandle = rootHandle;
    let ownsParent = false;
    let temporaryHandle: TNativeHandle | undefined;
    let temporaryName: string | undefined;
    let targetInstalled = false;
    let existingHandle: TNativeHandle | undefined;
    let existingIdentity: IWindowsIdentity | undefined;
    let backupName: string | undefined;
    let completed = false;
    try {
      const walked = this.openWriteParent(rootHandle, parentSegments, hooks);
      parentHandle = walked.handle;
      ownsParent = walked.owned;

      existingHandle = this.native.openReplacementTarget(
        parentHandle,
        targetName,
        relativeSegments.length - 1,
      );
      if (existingHandle !== undefined) {
        existingIdentity = this.native.queryIdentity(existingHandle, 'inspect-existing');
      }

      const temporary = this.createTemporaryFile(parentHandle);
      temporaryHandle = temporary.handle;
      temporaryName = temporary.name;
      this.native.writeUtf8(temporaryHandle, content);
      const temporaryIdentity = this.native.queryIdentity(
        temporaryHandle,
        'inspect-temporary',
      );
      hooks.afterTemporaryWritten?.(temporary.name);

      this.assertDirectoryChain(rootHandle, parentSegments, walked.identities);
      hooks.afterPreCommitValidated?.();
      if (existingHandle !== undefined && existingIdentity !== undefined) {
        backupName = `.atomic-backup-${randomBytes(TEMP_RANDOM_BYTES).toString('hex')}`;
        this.native.renameTo(existingHandle, parentHandle, backupName, false);
        this.assertNamedIdentity(parentHandle, backupName, existingIdentity);
      }
      this.native.renameTo(temporaryHandle, parentHandle, targetName, false);
      targetInstalled = true;

      const committedHandle = this.native.openRelative(
        parentHandle,
        targetName,
        true,
        relativeSegments.length - 1,
      );
      if (committedHandle === undefined) throw authorityError('FILE_CHANGED', 'commit-write');
      try {
        const committedIdentity = this.native.queryIdentity(committedHandle, 'inspect-target');
        if (!sameIdentity(committedIdentity, temporaryIdentity)) {
          throw authorityError('FILE_CHANGED', 'commit-write');
        }
      } finally {
        this.native.close(committedHandle);
      }

      this.assertDirectoryChain(rootHandle, parentSegments, walked.identities);
      this.assertRootIdentity(rootHandle);
      completed = true;
    } catch (error) {
      if (targetInstalled && temporaryHandle !== undefined && temporaryName !== undefined) {
        try {
          this.native.renameTo(temporaryHandle, parentHandle, temporaryName, false);
          targetInstalled = false;
        } catch {
          // Keep the original failure. A retained handle prevents a pathname fallback.
        }
      }
      if (existingHandle !== undefined && backupName !== undefined) {
        try {
          this.native.renameTo(existingHandle, parentHandle, targetName, false);
          backupName = undefined;
        } catch {
          // Preserve the backup entry rather than deleting the displaced original.
        }
      }
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('HOST_IO', 'write');
    } finally {
      if (temporaryHandle !== undefined) {
        if (!targetInstalled) this.native.markForDeletion(temporaryHandle);
        this.native.close(temporaryHandle);
      }
      if (existingHandle !== undefined) {
        if (completed && backupName !== undefined) this.native.markForDeletion(existingHandle);
        this.native.close(existingHandle);
      }
      if (ownsParent) this.native.close(parentHandle);
    }
  }

  close(): void {
    const handle = this.rootHandle;
    if (handle === undefined) return;
    this.rootHandle = undefined;
    this.native.close(handle);
  }

  private openWriteParent(
    rootHandle: TNativeHandle,
    segments: readonly string[],
    hooks: IFileAuthorityTestHooks,
  ): { handle: TNativeHandle; owned: boolean; identities: readonly IWindowsIdentity[] } {
    let parentHandle = rootHandle;
    let ownsParent = false;
    const identities: IWindowsIdentity[] = [];
    try {
      for (let index = 0; index < segments.length; index += 1) {
        const handle = this.native.openOrCreateDirectory(parentHandle, segments[index], index);
        const current = this.native.queryIdentity(handle, 'inspect-directory');
        if (ownsParent) this.native.close(parentHandle);
        parentHandle = handle;
        ownsParent = true;
        identities.push(current);
        hooks.afterDirectoryOpened?.(index);
      }
      return { handle: parentHandle, owned: ownsParent, identities };
    } catch (error) {
      if (ownsParent) this.native.close(parentHandle);
      throw error;
    }
  }

  private assertDirectoryChain(
    rootHandle: TNativeHandle,
    segments: readonly string[],
    expected: readonly IWindowsIdentity[],
  ): void {
    this.assertRootIdentity(rootHandle);
    let parentHandle = rootHandle;
    let ownsParent = false;
    try {
      for (let index = 0; index < segments.length; index += 1) {
        const handle = this.native.openRelative(parentHandle, segments[index], false, index);
        if (handle === undefined) {
          throw authorityError('FILE_CHANGED', 'reopen-directory', { segmentIndex: index });
        }
        const current = this.native.queryIdentity(handle, 'reinspect-directory');
        if (!sameIdentity(current, expected[index])) {
          this.native.close(handle);
          throw authorityError('FILE_CHANGED', 'reinspect-directory', {
            segmentIndex: index,
          });
        }
        if (ownsParent) this.native.close(parentHandle);
        parentHandle = handle;
        ownsParent = true;
      }
    } finally {
      if (ownsParent) this.native.close(parentHandle);
    }
  }

  private createTemporaryFile(parentHandle: TNativeHandle): {
    handle: TNativeHandle;
    name: string;
  } {
    for (let attempt = 0; attempt < MAX_TEMP_ATTEMPTS; attempt += 1) {
      const name = `.atomic-tmp-${randomBytes(TEMP_RANDOM_BYTES).toString('hex')}`;
      const handle = this.native.createTemporaryFile(parentHandle, name);
      if (handle !== undefined) return { handle, name };
    }
    throw authorityError('HOST_IO', 'create-temporary', { hostCode: 'NAME_COLLISION' });
  }

  private assertNamedIdentity(
    parentHandle: TNativeHandle,
    name: string,
    expected: IWindowsIdentity,
  ): void {
    const handle = this.native.openRelative(parentHandle, name, true, 0);
    if (handle === undefined) throw authorityError('FILE_CHANGED', 'inspect-named-entry');
    try {
      if (!sameIdentity(this.native.queryIdentity(handle, 'inspect-named-entry'), expected)) {
        throw authorityError('FILE_CHANGED', 'inspect-named-entry');
      }
    } finally {
      this.native.close(handle);
    }
  }

  private assertRootIdentity(handle: TNativeHandle): void {
    const current = this.native.queryIdentity(handle, 'inspect-root');
    if (!sameIdentity(current, this.rootIdentity)) {
      throw authorityError('ROOT_CHANGED', 'inspect-root');
    }
  }
}
