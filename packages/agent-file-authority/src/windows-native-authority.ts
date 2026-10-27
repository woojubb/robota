import * as koffi from 'koffi';

import { authorityError } from './contracts.js';
import {
  getWindowsApi,
  type IWindowsApi,
  type IWindowsAttributeTagInfo,
  type IWindowsIoStatus,
  type IWindowsObjectAttributes,
  type IWindowsRenameInfo,
  type IWindowsDispositionInfo,
  type IWindowsStandardInfo,
  type TNativeHandle,
} from './windows-native-api.js';
import {
  queryWindowsIdentity,
  readWindowsFile,
  windowsLastErrorCode,
  type IWindowsIdentity,
} from './windows-native-read.js';
import { classifyNtOpenFailure } from './windows-native-status.js';

import type { IFileAuthorityTestHooks } from './host-backend.js';

export type { IWindowsIdentity } from './windows-native-read.js';

const GENERIC_READ = 0x80000000;
const FILE_READ_DATA = 0x0001;
const FILE_LIST_DIRECTORY = 0x0001;
const FILE_WRITE_DATA = 0x0002;
const FILE_READ_ATTRIBUTES = 0x0080;
const DELETE = 0x00010000;
const SYNCHRONIZE = 0x00100000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const FILE_SHARE_DELETE = 0x00000004;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_OPEN = 1;
const FILE_CREATE = 2;
const FILE_OPEN_IF = 3;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const FILE_DIRECTORY_FILE = 0x00000001;
const FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
const FILE_NON_DIRECTORY_FILE = 0x00000040;
const FILE_OPEN_REPARSE_POINT = 0x00200000;
const OBJ_CASE_INSENSITIVE = 0x00000040;
const OBJ_DONT_REPARSE = 0x00001000;
const FILE_STANDARD_INFO_CLASS = 1;
const FILE_ATTRIBUTE_TAG_INFO_CLASS = 9;
const FILE_RENAME_INFO_CLASS = 3;
const FILE_DISPOSITION_INFO_CLASS = 4;
const HANDLE_WIDTH_BITS = 64;
const INVALID_HANDLE_VALUE = BigInt('-1');
const MAX_FILE_NAME_CODE_UNITS = 255;

function isInvalidHandle(handle: TNativeHandle): boolean {
  return handle === null || BigInt.asIntN(HANDLE_WIDTH_BITS, handle) === INVALID_HANDLE_VALUE;
}

/** Raw Windows handle operations. Native HANDLE and Koffi values stay inside this module. */
export class WindowsNativeAuthority {
  private readonly api: IWindowsApi;

  constructor() {
    try {
      this.api = getWindowsApi();
    } catch {
      throw authorityError('UNSUPPORTED_BACKEND', 'load-windows-backend');
    }
  }

  openRoot(rootDirectory: string): TNativeHandle {
    const handle = this.api.createFileW(
      rootDirectory,
      GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
      null,
      OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      null,
    );
    if (isInvalidHandle(handle)) {
      throw authorityError('HOST_IO', 'open-root', { hostCode: this.lastErrorCode() });
    }
    try {
      this.assertSafeHandle(handle, true, 'inspect-root');
      return handle;
    } catch (error) {
      this.close(handle);
      throw error;
    }
  }

  openRelative(
    parentHandle: TNativeHandle,
    segment: string,
    final: boolean,
    segmentIndex: number,
  ): TNativeHandle | undefined {
    const { handle, status } = this.issueRelativeOpen(parentHandle, segment, final, false);
    if (status >= 0) {
      if (isInvalidHandle(handle)) throw authorityError('HOST_IO', 'open-relative');
      try {
        this.assertSafeHandle(
          handle,
          !final,
          final ? 'inspect-file' : 'inspect-directory',
          segmentIndex,
        );
        return handle;
      } catch (error) {
        this.close(handle);
        throw error;
      }
    }
    if (!isInvalidHandle(handle)) this.close(handle);
    const failure = classifyNtOpenFailure(status);
    if (failure.kind === 'missing') return undefined;
    const details = { segmentIndex, hostCode: failure.hostCode };
    if (failure.kind === 'unsafe') {
      throw authorityError('UNSAFE_ENTRY', final ? 'open-file' : 'open-directory', details);
    }
    throw authorityError('HOST_IO', final ? 'open-file' : 'open-directory', details);
  }

  openReplacementTarget(
    parentHandle: TNativeHandle,
    segment: string,
    segmentIndex: number,
  ): TNativeHandle | undefined {
    const { handle, status } = this.issueRelativeOpen(parentHandle, segment, true, true);
    if (status >= 0) {
      if (isInvalidHandle(handle)) throw authorityError('HOST_IO', 'open-replacement-target');
      try {
        this.assertSafeHandle(handle, false, 'inspect-replacement-target', segmentIndex);
        return handle;
      } catch (error) {
        this.close(handle);
        throw error;
      }
    }
    if (!isInvalidHandle(handle)) this.close(handle);
    const failure = classifyNtOpenFailure(status);
    if (failure.kind === 'missing') return undefined;
    const details = { segmentIndex, hostCode: failure.hostCode };
    if (failure.kind === 'unsafe') {
      throw authorityError('UNSAFE_ENTRY', 'open-replacement-target', details);
    }
    throw authorityError('HOST_IO', 'open-replacement-target', details);
  }

  openOrCreateDirectory(
    parentHandle: TNativeHandle,
    segment: string,
    segmentIndex: number,
  ): TNativeHandle {
    const { handle, status } = this.issueRelativeCreate(
      parentHandle,
      segment,
      true,
      FILE_OPEN_IF,
    );
    if (status < 0 || isInvalidHandle(handle)) {
      if (!isInvalidHandle(handle)) this.close(handle);
      const failure = classifyNtOpenFailure(status);
      const details = { segmentIndex, hostCode: failure.hostCode };
      if (failure.kind === 'unsafe') {
        throw authorityError('UNSAFE_ENTRY', 'open-directory', details);
      }
      throw authorityError('HOST_IO', 'open-directory', details);
    }
    try {
      this.assertSafeHandle(handle, true, 'inspect-directory', segmentIndex);
      return handle;
    } catch (error) {
      this.close(handle);
      throw error;
    }
  }

  createTemporaryFile(parentHandle: TNativeHandle, name: string): TNativeHandle | undefined {
    const { handle, status } = this.issueRelativeCreate(parentHandle, name, false, FILE_CREATE);
    if (status >= 0) {
      if (isInvalidHandle(handle)) throw authorityError('HOST_IO', 'create-temporary');
      try {
        this.assertSafeHandle(handle, false, 'inspect-temporary');
        return handle;
      } catch (error) {
        this.close(handle);
        throw error;
      }
    }
    if (!isInvalidHandle(handle)) this.close(handle);
    const failure = classifyNtOpenFailure(status);
    if (failure.kind === 'exists') return undefined;
    if (failure.kind === 'unsafe') {
      throw authorityError('UNSAFE_ENTRY', 'create-temporary', {
        hostCode: failure.hostCode,
      });
    }
    throw authorityError('HOST_IO', 'create-temporary', { hostCode: failure.hostCode });
  }

  writeUtf8(handle: TNativeHandle, content: string): void {
    const bytes = Buffer.from(content, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + 1_048_576));
      const written = [0];
      if (!this.api.writeFile(handle, chunk, chunk.length, written, null)) {
        throw authorityError('HOST_IO', 'write-temporary', { hostCode: this.lastErrorCode() });
      }
      if (written[0] <= 0 || written[0] > chunk.length) {
        throw authorityError('HOST_IO', 'write-temporary');
      }
      offset += written[0];
    }
    if (!this.api.flushFileBuffers(handle)) {
      throw authorityError('HOST_IO', 'flush-temporary', { hostCode: this.lastErrorCode() });
    }
  }

  renameTo(
    handle: TNativeHandle,
    parentHandle: TNativeHandle,
    targetName: string,
    replaceExisting: boolean,
  ): void {
    const fileName = this.encodeFileName(targetName);
    const info = koffi.alloc(this.api.renameInfoType, 1);
    try {
      const value: IWindowsRenameInfo = {
        ReplaceIfExists: replaceExisting ? 1 : 0,
        RootDirectory: parentHandle,
        FileNameLength: Buffer.byteLength(targetName, 'utf16le'),
        FileName: fileName,
      };
      koffi.encode(info, this.api.renameInfoType, value);
      if (
        !this.api.setFileInformation(
          handle,
          FILE_RENAME_INFO_CLASS,
          info,
          koffi.sizeof(this.api.renameInfoType),
        )
      ) {
        throw authorityError('HOST_IO', 'commit-write', { hostCode: this.lastErrorCode() });
      }
    } finally {
      koffi.free(info);
    }
  }

  markForDeletion(handle: TNativeHandle): void {
    const info = koffi.alloc(this.api.dispositionInfoType, 1);
    try {
      const value: IWindowsDispositionInfo = { DeleteFile: 1 };
      koffi.encode(info, this.api.dispositionInfoType, value);
      this.api.setFileInformation(
        handle,
        FILE_DISPOSITION_INFO_CLASS,
        info,
        koffi.sizeof(this.api.dispositionInfoType),
      );
    } catch {
      // allow-fallback: best-effort cleanup cannot make the failed write authorized
    } finally {
      koffi.free(info);
    }
  }

  readFile(handle: TNativeHandle, maxBytes: number, hooks: IFileAuthorityTestHooks): Uint8Array {
    return readWindowsFile(this.api, handle, maxBytes, hooks);
  }

  queryIdentity(handle: TNativeHandle, operation: string): IWindowsIdentity {
    return queryWindowsIdentity(this.api, handle, operation);
  }

  close(handle: TNativeHandle): void {
    try {
      if (this.api.ntClose(handle) >= 0) return;
    } catch {
      // allow-fallback: CloseHandle is the native cleanup fallback after NtClose itself throws
    }
    try {
      this.api.closeHandle(handle);
    } catch {
      // allow-fallback: close failure cannot restore authority or make a later read safe
    }
  }

  private issueRelativeOpen(
    parentHandle: TNativeHandle,
    segment: string,
    final: boolean,
    replaceable: boolean,
  ): { handle: TNativeHandle; status: number } {
    const unicodeName = koffi.alloc(this.api.unicodeStringType, 1);
    try {
      koffi.encode(unicodeName, this.api.unicodeStringType, {
        Length: Buffer.byteLength(segment, 'utf16le'),
        MaximumLength: Buffer.byteLength(`${segment}\0`, 'utf16le'),
        Buffer: segment,
      });
      const attributes: IWindowsObjectAttributes = {
        Length: koffi.sizeof(this.api.objectAttributesType),
        RootDirectory: parentHandle,
        ObjectName: unicodeName,
        Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        SecurityDescriptor: null,
        SecurityQualityOfService: null,
      };
      const output: TNativeHandle[] = [null];
      const ioStatus: IWindowsIoStatus = { Status: 0, Information: 0 };
      // A final read cannot verify same-size in-place rewrites from identity and size alone.
      // Deny write sharing for that handle so existing and new writers cannot race the read.
      const shareAccess = final
        ? FILE_SHARE_READ | FILE_SHARE_DELETE
        : FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
      const status = this.api.ntCreateFile(
        output,
        (final ? FILE_READ_DATA | (replaceable ? DELETE : 0) : FILE_LIST_DIRECTORY) |
          FILE_READ_ATTRIBUTES |
          SYNCHRONIZE,
        attributes,
        ioStatus,
        null,
        0,
        shareAccess,
        FILE_OPEN,
        (final ? FILE_NON_DIRECTORY_FILE : FILE_DIRECTORY_FILE) |
          FILE_SYNCHRONOUS_IO_NONALERT |
          FILE_OPEN_REPARSE_POINT,
        null,
        0,
      );
      return { handle: output[0], status };
    } finally {
      koffi.free(unicodeName);
    }
  }

  private issueRelativeCreate(
    parentHandle: TNativeHandle,
    segment: string,
    directory: boolean,
    disposition: number,
  ): { handle: TNativeHandle; status: number } {
    const unicodeName = koffi.alloc(this.api.unicodeStringType, 1);
    try {
      koffi.encode(unicodeName, this.api.unicodeStringType, {
        Length: Buffer.byteLength(segment, 'utf16le'),
        MaximumLength: Buffer.byteLength(`${segment}\0`, 'utf16le'),
        Buffer: segment,
      });
      const attributes: IWindowsObjectAttributes = {
        Length: koffi.sizeof(this.api.objectAttributesType),
        RootDirectory: parentHandle,
        ObjectName: unicodeName,
        Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        SecurityDescriptor: null,
        SecurityQualityOfService: null,
      };
      const output: TNativeHandle[] = [null];
      const ioStatus: IWindowsIoStatus = { Status: 0, Information: 0 };
      const status = this.api.ntCreateFile(
        output,
        (directory ? FILE_LIST_DIRECTORY : FILE_WRITE_DATA | DELETE) |
          FILE_READ_ATTRIBUTES |
          SYNCHRONIZE,
        attributes,
        ioStatus,
        null,
        directory ? 0 : FILE_ATTRIBUTE_NORMAL,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        disposition,
        (directory ? FILE_DIRECTORY_FILE : FILE_NON_DIRECTORY_FILE) |
          FILE_SYNCHRONOUS_IO_NONALERT |
          FILE_OPEN_REPARSE_POINT,
        null,
        0,
      );
      return { handle: output[0], status };
    } finally {
      koffi.free(unicodeName);
    }
  }

  private encodeFileName(name: string): Uint16Array {
    if (name.length === 0 || name.length > MAX_FILE_NAME_CODE_UNITS) {
      throw authorityError('INVALID_PATH', 'commit-write');
    }
    const encoded = new Uint16Array(MAX_FILE_NAME_CODE_UNITS + 1);
    for (let index = 0; index < name.length; index += 1) {
      encoded[index] = name.charCodeAt(index);
    }
    return encoded;
  }

  private assertSafeHandle(
    handle: TNativeHandle,
    directory: boolean,
    operation: string,
    segmentIndex?: number,
  ): void {
    const attributes: IWindowsAttributeTagInfo = {};
    const standard: IWindowsStandardInfo = {};
    if (
      !this.api.getAttributeTagInfo(
        handle,
        FILE_ATTRIBUTE_TAG_INFO_CLASS,
        attributes,
        koffi.sizeof(this.api.attributeTagInfoType),
      ) ||
      !this.api.getStandardInfo(
        handle,
        FILE_STANDARD_INFO_CLASS,
        standard,
        koffi.sizeof(this.api.standardInfoType),
      )
    ) {
      throw authorityError('HOST_IO', operation, { hostCode: this.lastErrorCode() });
    }
    const unsafe =
      ((attributes.FileAttributes ?? 0) & FILE_ATTRIBUTE_REPARSE_POINT) !== 0 ||
      Boolean(standard.Directory) !== directory;
    if (unsafe) {
      throw authorityError(
        'UNSAFE_ENTRY',
        operation,
        segmentIndex === undefined ? {} : { segmentIndex },
      );
    }
  }

  private lastErrorCode(): string {
    return windowsLastErrorCode(this.api);
  }
}
