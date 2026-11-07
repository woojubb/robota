import * as koffi from 'koffi';

type THandle = bigint | null;
interface IWindowsGuardApi {
  readonly open: (
    path: string,
    access: number,
    sharing: number,
    security: null,
    disposition: number,
    flags: number,
    template: null,
  ) => THandle;
  readonly close: (handle: THandle) => boolean;
  readonly lastError: () => number;
  readonly attributes: (handle: THandle, kind: number, output: object, size: number) => boolean;
  readonly attributeType: koffi.TypeObject;
  readonly standard: (handle: THandle, kind: number, output: object, size: number) => boolean;
  readonly standardType: koffi.TypeObject;
}
let api: IWindowsGuardApi | undefined;
const libraries: koffi.LibraryHandle[] = [];

function windowsApi(): IWindowsGuardApi {
  if (api !== undefined) return api;
  const kernel = koffi.load('kernel32.dll');
  libraries.push(kernel);
  const handle = koffi.pointer('RobotaSessionOperationGuardHandle', koffi.opaque());
  const attributeType = koffi.struct('RobotaSessionOperationGuardAttributes', {
    FileAttributes: 'uint32_t',
    ReparseTag: 'uint32_t',
  });
  const standardType = koffi.struct('RobotaSessionOperationGuardStandard', {
    AllocationSize: 'int64_t',
    EndOfFile: 'int64_t',
    NumberOfLinks: 'uint32_t',
    DeletePending: 'uint8_t',
    Directory: 'uint8_t',
  });
  api = {
    open: kernel.func('CreateFileW', handle, [
      koffi.pointer('char16_t'),
      'uint32_t',
      'uint32_t',
      'void *',
      'uint32_t',
      'uint32_t',
      handle,
    ]),
    close: kernel.func('CloseHandle', 'bool', [handle]),
    lastError: kernel.func('GetLastError', 'uint32_t', []),
    attributes: kernel.func('GetFileInformationByHandleEx', 'bool', [
      handle,
      'int32_t',
      koffi.out(koffi.pointer(attributeType)),
      'uint32_t',
    ]),
    attributeType,
    standard: kernel.func('GetFileInformationByHandleEx', 'bool', [
      handle,
      'int32_t',
      koffi.out(koffi.pointer(standardType)),
      'uint32_t',
    ]),
    standardType,
  };
  return api;
}

/** Exclusive non-sharing file handles are released by Windows even after a process crash. */
export function tryWindowsOperationLock(path: string): { release(): void } | undefined {
  const windows = windowsApi();
  const handle = windows.open(path, 0xc0000000, 0, null, 4, 0x80 | 0x00200000, null);
  if (handle === null || BigInt.asIntN(64, handle) === -1n) {
    const code = windows.lastError();
    if (code === 32) return undefined;
    throw new Error(`Could not acquire a process operation lock (Windows error ${code}).`);
  }
  try {
    const attributes: { FileAttributes?: number } = {};
    const standard: { Directory?: number; NumberOfLinks?: number } = {};
    if (
      !windows.attributes(handle, 9, attributes, koffi.sizeof(windows.attributeType)) ||
      !windows.standard(handle, 1, standard, koffi.sizeof(windows.standardType)) ||
      ((attributes.FileAttributes ?? 0) & 0x400) !== 0 ||
      standard.Directory !== 0 ||
      standard.NumberOfLinks !== 1
    ) {
      throw new Error('The process operation lock is not a unique regular file.');
    }
    let released = false;
    return Object.freeze({
      release: () => {
        if (released) return;
        released = true;
        if (!windows.close(handle)) throw new Error('Could not release a process operation lock.');
      },
    });
  } catch (error) {
    windows.close(handle);
    throw error;
  }
}
