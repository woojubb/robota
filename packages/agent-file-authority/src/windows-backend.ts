import * as koffi from 'koffi';

import { authorityError, isStableFileAuthorityError } from './contracts.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';

type TNativeHandle = bigint | null;
type TNativeFunction = (...arguments_: unknown[]) => unknown;

interface IWindowsApi {
  readonly handleType: koffi.TypeObject;
  readonly unicodeStringType: koffi.TypeObject;
  readonly objectAttributesType: koffi.TypeObject;
  readonly ioStatusBlockType: koffi.TypeObject;
  readonly attributeTagInfoType: koffi.TypeObject;
  readonly fileIdInfoType: koffi.TypeObject;
  readonly standardInfoType: koffi.TypeObject;
  readonly createFileW: TNativeFunction;
  readonly closeHandle: TNativeFunction;
  readonly getAttributeTagInfo: TNativeFunction;
  readonly getFileIdInfo: TNativeFunction;
  readonly getStandardInfo: TNativeFunction;
  readonly getFileSizeEx: TNativeFunction;
  readonly readFile: TNativeFunction;
  readonly getLastError: TNativeFunction;
  readonly ntCreateFile: TNativeFunction;
  readonly ntClose: TNativeFunction;
}

interface IWindowsIdentity {
  readonly volume: bigint;
  readonly fileId: string;
}

interface IWindowsFileSnapshot extends IWindowsIdentity {
  readonly size: bigint;
}

const GENERIC_READ = 0x80000000;
const FILE_READ_DATA = 0x0001;
const FILE_LIST_DIRECTORY = 0x0001;
const FILE_READ_ATTRIBUTES = 0x0080;
const SYNCHRONIZE = 0x00100000;
const FILE_SHARE_READ = 0x00000001;
const FILE_SHARE_WRITE = 0x00000002;
const FILE_SHARE_DELETE = 0x00000004;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
const FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
const FILE_OPEN = 1;
const FILE_DIRECTORY_FILE = 0x00000001;
const FILE_SYNCHRONOUS_IO_NONALERT = 0x00000020;
const FILE_NON_DIRECTORY_FILE = 0x00000040;
const FILE_OPEN_REPARSE_POINT = 0x00200000;
const OBJ_CASE_INSENSITIVE = 0x00000040;
const OBJ_DONT_REPARSE = 0x00001000;
const FILE_STANDARD_INFO_CLASS = 1;
const FILE_ATTRIBUTE_TAG_INFO_CLASS = 9;
const FILE_ID_INFO_CLASS = 18;
const CHUNK_BYTES = 1024 * 1024;

const MISSING_STATUSES = new Set([0xc000000f, 0xc0000034, 0xc000003a]);
const UNSAFE_STATUSES = new Set([0x8000002d, 0xc00000ba, 0xc0000103, 0xc0000279, 0xc000050b]);

let cachedApi: IWindowsApi | undefined;

function windowsApi(): IWindowsApi {
  if (cachedApi !== undefined) return cachedApi;

  const kernel32 = koffi.load('kernel32.dll');
  const ntdll = koffi.load('ntdll.dll');
  const handleType = koffi.pointer('RobotaStableFileHandle', koffi.opaque());
  const unicodeStringType = koffi.struct('RobotaUnicodeString', {
    Length: 'uint16_t',
    MaximumLength: 'uint16_t',
    Buffer: koffi.pointer('char16_t'),
  });
  const objectAttributesType = koffi.struct('RobotaObjectAttributes', {
    Length: 'uint32_t',
    RootDirectory: handleType,
    ObjectName: koffi.pointer(unicodeStringType),
    Attributes: 'uint32_t',
    SecurityDescriptor: 'void *',
    SecurityQualityOfService: 'void *',
  });
  const ioStatusBlockType = koffi.struct('RobotaIoStatusBlock', {
    Status: 'intptr_t',
    Information: 'uintptr_t',
  });
  const attributeTagInfoType = koffi.struct('RobotaFileAttributeTagInfo', {
    FileAttributes: 'uint32_t',
    ReparseTag: 'uint32_t',
  });
  const fileIdInfoType = koffi.struct('RobotaFileIdInfo', {
    VolumeSerialNumber: 'uint64_t',
    FileId: koffi.array('uint8_t', 16, 'Typed'),
  });
  const standardInfoType = koffi.struct('RobotaFileStandardInfo', {
    AllocationSize: 'int64_t',
    EndOfFile: 'int64_t',
    NumberOfLinks: 'uint32_t',
    DeletePending: 'uint8_t',
    Directory: 'uint8_t',
  });

  cachedApi = {
    handleType,
    unicodeStringType,
    objectAttributesType,
    ioStatusBlockType,
    attributeTagInfoType,
    fileIdInfoType,
    standardInfoType,
    createFileW: kernel32.func('CreateFileW', handleType, [
      koffi.pointer('char16_t'),
      'uint32_t',
      'uint32_t',
      'void *',
      'uint32_t',
      'uint32_t',
      handleType,
    ]) as TNativeFunction,
    closeHandle: kernel32.func('CloseHandle', 'bool', [handleType]) as TNativeFunction,
    getAttributeTagInfo: kernel32.func('GetFileInformationByHandleEx', 'bool', [
      handleType,
      'int32_t',
      koffi.out(koffi.pointer(attributeTagInfoType)),
      'uint32_t',
    ]) as TNativeFunction,
    getFileIdInfo: kernel32.func('GetFileInformationByHandleEx', 'bool', [
      handleType,
      'int32_t',
      koffi.out(koffi.pointer(fileIdInfoType)),
      'uint32_t',
    ]) as TNativeFunction,
    getStandardInfo: kernel32.func('GetFileInformationByHandleEx', 'bool', [
      handleType,
      'int32_t',
      koffi.out(koffi.pointer(standardInfoType)),
      'uint32_t',
    ]) as TNativeFunction,
    getFileSizeEx: kernel32.func('GetFileSizeEx', 'bool', [
      handleType,
      koffi.out(koffi.pointer('int64_t')),
    ]) as TNativeFunction,
    readFile: kernel32.func('ReadFile', 'bool', [
      handleType,
      koffi.out(koffi.pointer('uint8_t')),
      'uint32_t',
      koffi.out(koffi.pointer('uint32_t')),
      'void *',
    ]) as TNativeFunction,
    getLastError: kernel32.func('GetLastError', 'uint32_t', []) as TNativeFunction,
    ntCreateFile: ntdll.func('NtCreateFile', 'int32_t', [
      koffi.out(koffi.pointer(handleType)),
      'uint32_t',
      koffi.pointer(objectAttributesType),
      koffi.out(koffi.pointer(ioStatusBlockType)),
      'void *',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'void *',
      'uint32_t',
    ]) as TNativeFunction,
    ntClose: ntdll.func('NtClose', 'int32_t', [handleType]) as TNativeFunction,
  };
  return cachedApi;
}

function isInvalidHandle(handle: TNativeHandle): boolean {
  return handle === null || BigInt.asIntN(64, handle) === -1n;
}

function unsignedStatus(status: number): number {
  return status >>> 0;
}

function bytesToHex(value: unknown): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString('hex');
  throw authorityError('UNSUPPORTED_BACKEND', 'decode-file-identity');
}

/** Windows implementation; native HANDLE values never leave this module. */
export class WindowsStableFileHostBackend implements IStableFileHostBackend {
  private readonly api: IWindowsApi;
  private readonly rootIdentity: IWindowsIdentity;
  private rootHandle: TNativeHandle | undefined;

  constructor(rootDirectory: string) {
    try {
      this.api = windowsApi();
      const handle = this.api.createFileW(
        rootDirectory,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        null,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
        null,
      ) as TNativeHandle;
      if (isInvalidHandle(handle)) {
        throw authorityError('HOST_IO', 'open-root', { hostCode: this.lastErrorCode() });
      }
      this.rootHandle = handle;
      this.assertSafeHandle(handle, true, 'inspect-root');
      this.rootIdentity = this.queryIdentity(handle, 'inspect-root');
    } catch (error) {
      if (this.rootHandle !== undefined && !isInvalidHandle(this.rootHandle)) {
        this.closeNativeHandle(this.rootHandle);
        this.rootHandle = undefined;
      }
      if (isStableFileAuthorityError(error)) throw error;
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
        const handle = this.openRelative(parentHandle, relativeSegments[index], final, index);
        if (handle === undefined) return undefined;
        this.assertSafeHandle(handle, !final, final ? 'inspect-file' : 'inspect-directory', index);
        if (final) {
          fileHandle = handle;
          break;
        }
        if (ownsParent) this.closeNativeHandle(parentHandle);
        parentHandle = handle;
        ownsParent = true;
        hooks.afterDirectoryOpened?.(index);
      }

      if (fileHandle === undefined) throw authorityError('HOST_IO', 'open-file');
      const bytes = this.readFile(fileHandle, maxBytes, hooks);
      this.assertRootIdentity(rootHandle);
      return bytes;
    } catch (error) {
      if (isStableFileAuthorityError(error)) throw error;
      throw authorityError('HOST_IO', 'read');
    } finally {
      if (fileHandle !== undefined) this.closeNativeHandle(fileHandle);
      if (ownsParent) this.closeNativeHandle(parentHandle);
    }
  }

  close(): void {
    const handle = this.rootHandle;
    if (handle === undefined) return;
    this.rootHandle = undefined;
    this.closeNativeHandle(handle);
  }

  private openRelative(
    parentHandle: TNativeHandle,
    segment: string,
    final: boolean,
    segmentIndex: number,
  ): TNativeHandle | undefined {
    const unicodeName = koffi.alloc(this.api.unicodeStringType, 1);
    try {
      koffi.encode(unicodeName, this.api.unicodeStringType, {
        Length: Buffer.byteLength(segment, 'utf16le'),
        MaximumLength: Buffer.byteLength(`${segment}\0`, 'utf16le'),
        Buffer: segment,
      });
      const attributes = {
        Length: koffi.sizeof(this.api.objectAttributesType),
        RootDirectory: parentHandle,
        ObjectName: unicodeName,
        Attributes: OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE,
        SecurityDescriptor: null,
        SecurityQualityOfService: null,
      };
      const output: TNativeHandle[] = [null];
      const ioStatus = { Status: 0, Information: 0 };
      const status = Number(
        this.api.ntCreateFile(
          output,
          (final ? FILE_READ_DATA : FILE_LIST_DIRECTORY) | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
          attributes,
          ioStatus,
          null,
          0,
          FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
          FILE_OPEN,
          (final ? FILE_NON_DIRECTORY_FILE : FILE_DIRECTORY_FILE) |
            FILE_SYNCHRONOUS_IO_NONALERT |
            FILE_OPEN_REPARSE_POINT,
          null,
          0,
        ),
      );
      if (status >= 0) {
        const handle = output[0];
        if (isInvalidHandle(handle)) throw authorityError('HOST_IO', 'open-relative');
        return handle;
      }

      const normalized = unsignedStatus(status);
      if (MISSING_STATUSES.has(normalized)) return undefined;
      const details = { segmentIndex, hostCode: `NTSTATUS_0x${normalized.toString(16)}` };
      if (UNSAFE_STATUSES.has(normalized)) {
        throw authorityError('UNSAFE_ENTRY', final ? 'open-file' : 'open-directory', details);
      }
      throw authorityError('HOST_IO', final ? 'open-file' : 'open-directory', details);
    } finally {
      koffi.free(unicodeName);
    }
  }

  private readFile(
    handle: TNativeHandle,
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array {
    const before = this.queryFileSnapshot(handle);
    if (before.size > BigInt(maxBytes)) throw authorityError('OVER_BUDGET', 'read-file');
    const expectedBytes = Number(before.size);
    let bytes: Buffer;
    try {
      bytes = Buffer.alloc(expectedBytes);
    } catch {
      throw authorityError('HOST_IO', 'allocate-read-buffer');
    }

    let offset = 0;
    while (offset < expectedBytes) {
      const length = Math.min(CHUNK_BYTES, expectedBytes - offset);
      const chunk = bytes.subarray(offset, offset + length);
      const count = [0];
      if (!this.api.readFile(handle, chunk, length, count, null)) {
        throw authorityError('HOST_IO', 'read-file', { hostCode: this.lastErrorCode() });
      }
      if (count[0] === 0) break;
      offset += count[0];
      hooks.afterReadChunk?.(offset);
    }

    const probe = Buffer.alloc(1);
    const probeCount = [0];
    if (!this.api.readFile(handle, probe, 1, probeCount, null)) {
      throw authorityError('HOST_IO', 'probe-file', { hostCode: this.lastErrorCode() });
    }
    const after = this.queryFileSnapshot(handle);
    if (probeCount[0] !== 0 && expectedBytes >= maxBytes) {
      throw authorityError('OVER_BUDGET', 'read-file');
    }
    if (
      offset !== expectedBytes ||
      probeCount[0] !== 0 ||
      before.volume !== after.volume ||
      before.fileId !== after.fileId ||
      before.size !== after.size
    ) {
      throw authorityError('FILE_CHANGED', 'read-file');
    }
    return bytes;
  }

  private assertSafeHandle(
    handle: TNativeHandle,
    directory: boolean,
    operation: string,
    segmentIndex?: number,
  ): void {
    const attributes = {} as { FileAttributes?: number; ReparseTag?: number };
    if (
      !this.api.getAttributeTagInfo(
        handle,
        FILE_ATTRIBUTE_TAG_INFO_CLASS,
        attributes,
        koffi.sizeof(this.api.attributeTagInfoType),
      )
    ) {
      throw authorityError('HOST_IO', operation, { hostCode: this.lastErrorCode() });
    }
    const standard = {} as { Directory?: number };
    if (
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

  private queryIdentity(handle: TNativeHandle, operation: string): IWindowsIdentity {
    const info = {} as { VolumeSerialNumber?: bigint | number; FileId?: unknown };
    if (
      !this.api.getFileIdInfo(
        handle,
        FILE_ID_INFO_CLASS,
        info,
        koffi.sizeof(this.api.fileIdInfoType),
      )
    ) {
      throw authorityError('UNSUPPORTED_BACKEND', operation, {
        hostCode: this.lastErrorCode(),
      });
    }
    return {
      volume: BigInt(info.VolumeSerialNumber ?? 0),
      fileId: bytesToHex(info.FileId),
    };
  }

  private queryFileSnapshot(handle: TNativeHandle): IWindowsFileSnapshot {
    const identity = this.queryIdentity(handle, 'inspect-file');
    const size = [0n];
    if (!this.api.getFileSizeEx(handle, size)) {
      throw authorityError('HOST_IO', 'inspect-file', { hostCode: this.lastErrorCode() });
    }
    return { ...identity, size: BigInt(size[0]) };
  }

  private assertRootIdentity(handle: TNativeHandle): void {
    const current = this.queryIdentity(handle, 'inspect-root');
    if (
      current.volume !== this.rootIdentity.volume ||
      current.fileId !== this.rootIdentity.fileId
    ) {
      throw authorityError('ROOT_CHANGED', 'inspect-root');
    }
  }

  private closeNativeHandle(handle: TNativeHandle): void {
    try {
      this.api.ntClose(handle);
    } catch {
      try {
        this.api.closeHandle(handle);
      } catch {
        // The handle is removed from this authority even if the host reports a close failure.
      }
    }
  }

  private lastErrorCode(): string {
    return `WIN32_${Number(this.api.getLastError())}`;
  }
}
