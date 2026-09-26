import * as koffi from 'koffi';

export type TNativeHandle = bigint | null;

export interface IWindowsAttributeTagInfo {
  FileAttributes?: number;
  ReparseTag?: number;
}

export interface IWindowsFileIdInfo {
  VolumeSerialNumber?: bigint | number;
  FileId?: Uint8Array | number[];
}

export interface IWindowsStandardInfo {
  Directory?: number;
}

export interface IWindowsObjectAttributes {
  Length: number;
  RootDirectory: TNativeHandle;
  ObjectName: object;
  Attributes: number;
  SecurityDescriptor: null;
  SecurityQualityOfService: null;
}

export interface IWindowsIoStatus {
  Status: number;
  Information: number;
}

type TCreateFileW = (
  path: string,
  desiredAccess: number,
  shareMode: number,
  securityAttributes: null,
  creationDisposition: number,
  flagsAndAttributes: number,
  templateFile: TNativeHandle,
) => TNativeHandle;

type TGetInformation = (
  handle: TNativeHandle,
  informationClass: number,
  output: object,
  outputBytes: number,
) => boolean;

type TNtCreateFile = (
  output: TNativeHandle[],
  desiredAccess: number,
  objectAttributes: IWindowsObjectAttributes,
  ioStatus: IWindowsIoStatus,
  allocationSize: null,
  fileAttributes: number,
  shareAccess: number,
  createDisposition: number,
  createOptions: number,
  extendedAttributes: null,
  extendedAttributesBytes: number,
) => number;

export interface IWindowsApi {
  readonly handleType: koffi.TypeObject;
  readonly unicodeStringType: koffi.TypeObject;
  readonly objectAttributesType: koffi.TypeObject;
  readonly attributeTagInfoType: koffi.TypeObject;
  readonly fileIdInfoType: koffi.TypeObject;
  readonly standardInfoType: koffi.TypeObject;
  readonly createFileW: TCreateFileW;
  readonly closeHandle: (handle: TNativeHandle) => boolean;
  readonly getAttributeTagInfo: TGetInformation;
  readonly getFileIdInfo: TGetInformation;
  readonly getStandardInfo: TGetInformation;
  readonly getFileSizeEx: (handle: TNativeHandle, size: bigint[]) => boolean;
  readonly readFile: (
    handle: TNativeHandle,
    buffer: Uint8Array,
    bytesToRead: number,
    bytesRead: number[],
    overlapped: null,
  ) => boolean;
  readonly getLastError: () => number;
  readonly ntCreateFile: TNtCreateFile;
  readonly ntClose: (handle: TNativeHandle) => number;
}

interface IWindowsTypes {
  readonly handleType: koffi.TypeObject;
  readonly unicodeStringType: koffi.TypeObject;
  readonly objectAttributesType: koffi.TypeObject;
  readonly ioStatusBlockType: koffi.TypeObject;
  readonly attributeTagInfoType: koffi.TypeObject;
  readonly fileIdInfoType: koffi.TypeObject;
  readonly standardInfoType: koffi.TypeObject;
}

const FILE_ID_BYTES = 16;

function defineWindowsTypes(): IWindowsTypes {
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
  return {
    handleType,
    unicodeStringType,
    objectAttributesType,
    ioStatusBlockType: koffi.struct('RobotaIoStatusBlock', {
      Status: 'intptr_t',
      Information: 'uintptr_t',
    }),
    attributeTagInfoType: koffi.struct('RobotaFileAttributeTagInfo', {
      FileAttributes: 'uint32_t',
      ReparseTag: 'uint32_t',
    }),
    fileIdInfoType: koffi.struct('RobotaFileIdInfo', {
      VolumeSerialNumber: 'uint64_t',
      FileId: koffi.array('uint8_t', FILE_ID_BYTES, 'Typed'),
    }),
    standardInfoType: koffi.struct('RobotaFileStandardInfo', {
      AllocationSize: 'int64_t',
      EndOfFile: 'int64_t',
      NumberOfLinks: 'uint32_t',
      DeletePending: 'uint8_t',
      Directory: 'uint8_t',
    }),
  };
}

function bindKernel32(
  library: koffi.LibraryHandle,
  types: IWindowsTypes,
): Pick<
  IWindowsApi,
  | 'createFileW'
  | 'closeHandle'
  | 'getAttributeTagInfo'
  | 'getFileIdInfo'
  | 'getStandardInfo'
  | 'getFileSizeEx'
  | 'readFile'
  | 'getLastError'
> {
  return {
    createFileW: library.func('CreateFileW', types.handleType, [
      koffi.pointer('char16_t'),
      'uint32_t',
      'uint32_t',
      'void *',
      'uint32_t',
      'uint32_t',
      types.handleType,
    ]) as TCreateFileW,
    closeHandle: library.func('CloseHandle', 'bool', [types.handleType]),
    ...bindInformationFunctions(library, types),
    getFileSizeEx: library.func('GetFileSizeEx', 'bool', [
      types.handleType,
      koffi.out(koffi.pointer('int64_t')),
    ]),
    readFile: library.func('ReadFile', 'bool', [
      types.handleType,
      koffi.out(koffi.pointer('uint8_t')),
      'uint32_t',
      koffi.out(koffi.pointer('uint32_t')),
      'void *',
    ]),
    getLastError: library.func('GetLastError', 'uint32_t', []),
  };
}

function bindInformationFunctions(
  library: koffi.LibraryHandle,
  types: IWindowsTypes,
): Pick<IWindowsApi, 'getAttributeTagInfo' | 'getFileIdInfo' | 'getStandardInfo'> {
  const bind = (outputType: koffi.TypeObject): TGetInformation =>
    library.func('GetFileInformationByHandleEx', 'bool', [
      types.handleType,
      'int32_t',
      koffi.out(koffi.pointer(outputType)),
      'uint32_t',
    ]) as TGetInformation;
  return {
    getAttributeTagInfo: bind(types.attributeTagInfoType),
    getFileIdInfo: bind(types.fileIdInfoType),
    getStandardInfo: bind(types.standardInfoType),
  };
}

function bindNtDll(
  library: koffi.LibraryHandle,
  types: IWindowsTypes,
): Pick<IWindowsApi, 'ntCreateFile' | 'ntClose'> {
  return {
    ntCreateFile: library.func('NtCreateFile', 'int32_t', [
      koffi.out(koffi.pointer(types.handleType)),
      'uint32_t',
      koffi.pointer(types.objectAttributesType),
      koffi.out(koffi.pointer(types.ioStatusBlockType)),
      'void *',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'uint32_t',
      'void *',
      'uint32_t',
    ]) as TNtCreateFile,
    ntClose: library.func('NtClose', 'int32_t', [types.handleType]),
  };
}

let cachedApi: IWindowsApi | undefined;
/**
 * The library handles stay referenced for the life of the process: Bun aborts when Koffi's
 * finalizer for a collected library handle runs, so a handle must never become garbage.
 */
const retainedLibraries: unknown[] = [];

export function getWindowsApi(): IWindowsApi {
  if (cachedApi !== undefined) return cachedApi;
  const types = defineWindowsTypes();
  const kernel32 = koffi.load('kernel32.dll');
  retainedLibraries.push(kernel32);
  const ntdll = koffi.load('ntdll.dll');
  retainedLibraries.push(ntdll);
  cachedApi = {
    ...types,
    ...bindKernel32(kernel32, types),
    ...bindNtDll(ntdll, types),
  };
  return cachedApi;
}
