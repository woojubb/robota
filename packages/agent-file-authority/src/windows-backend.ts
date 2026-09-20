import { authorityError, StableFileAuthorityError } from './contracts.js';
import { WindowsNativeAuthority, type IWindowsIdentity } from './windows-native-authority.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';
import type { TNativeHandle } from './windows-native-api.js';

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

  close(): void {
    const handle = this.rootHandle;
    if (handle === undefined) return;
    this.rootHandle = undefined;
    this.native.close(handle);
  }

  private assertRootIdentity(handle: TNativeHandle): void {
    const current = this.native.queryIdentity(handle, 'inspect-root');
    if (
      current.volume !== this.rootIdentity.volume ||
      current.fileId !== this.rootIdentity.fileId
    ) {
      throw authorityError('ROOT_CHANGED', 'inspect-root');
    }
  }
}
