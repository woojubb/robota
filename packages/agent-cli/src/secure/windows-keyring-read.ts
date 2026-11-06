import * as koffi from 'koffi';

type THandle = bigint | null;
type TReadResult =
  | { readonly status: 'missing' | 'symlink' | 'not-regular-file' | 'unreadable' | 'too-large' }
  | {
      readonly status: 'present';
      readonly content: Buffer;
      readonly identity: Buffer;
      readonly modified: Buffer;
      readonly mtimeMs: number;
    };

interface IWindowsFileApi {
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
  readonly information: (handle: THandle, kind: number, output: Buffer, size: number) => boolean;
  readonly fileType: (handle: THandle) => number;
  readonly setInformation: (handle: THandle, kind: number, value: Buffer, size: number) => boolean;
  readonly read: (
    handle: THandle,
    output: Buffer,
    length: number,
    read: Buffer,
    overlapped: null,
  ) => boolean;
  readonly lastError: () => number;
}

let api: IWindowsFileApi | undefined;
const libraries: koffi.LibraryHandle[] = [];
function windowsApi(): IWindowsFileApi {
  if (api !== undefined) return api;
  const kernel = koffi.load('kernel32.dll');
  libraries.push(kernel);
  const handle = koffi.pointer('RobotaKeyringReadHandle', koffi.opaque());
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
    information: kernel.func('GetFileInformationByHandleEx', 'bool', [
      handle,
      'int32_t',
      'void *',
      'uint32_t',
    ]),
    fileType: kernel.func('GetFileType', 'uint32_t', [handle]),
    setInformation: kernel.func('SetFileInformationByHandle', 'bool', [
      handle,
      'int32_t',
      'void *',
      'uint32_t',
    ]),
    read: kernel.func('ReadFile', 'bool', [handle, 'void *', 'uint32_t', 'void *', 'void *']),
    lastError: kernel.func('GetLastError', 'uint32_t', []),
  };
  return api;
}

/**
 * Open the final component itself, pin it against replacement, and compare two OS handle identities
 * before reading. A matching handle identity does not establish authority over ancestor directories.
 */
export function readWindowsKeyringFile(
  path: string,
  limit: number,
  afterFirstOpen?: () => void,
): TReadResult {
  const win = windowsApi();
  // Sharing omits FILE_SHARE_DELETE, keeping a cooperating filesystem from replacing an open name.
  const open = (access: number): THandle =>
    win.open(path, access, 0x1 | 0x2, null, 3, 0x02000000 | 0x00200000, null);
  const invalid = (handle: THandle): boolean =>
    handle === null || BigInt.asIntN(64, handle) === -1n;
  const first = open(0x80);
  if (invalid(first)) {
    const error = win.lastError();
    return { status: error === 2 || error === 3 ? 'missing' : 'unreadable' };
  }
  let second: THandle = null;
  try {
    const attributes = Buffer.alloc(8);
    if (!win.information(first, 9, attributes, attributes.length)) return { status: 'unreadable' };
    const flags = attributes.readUInt32LE(0);
    if ((flags & 0x400) !== 0) return { status: 'symlink' };
    if ((flags & 0x10) !== 0 || win.fileType(first) !== 1) return { status: 'not-regular-file' };
    const firstIdentity = Buffer.alloc(24);
    if (
      !win.information(first, 18, firstIdentity, firstIdentity.length) ||
      firstIdentity.subarray(8).every((byte) => byte === 0)
    )
      return { status: 'unreadable' };
    afterFirstOpen?.();
    second = open(0x80000000);
    if (invalid(second)) return { status: 'unreadable' };
    const secondAttributes = Buffer.alloc(8);
    const secondIdentity = Buffer.alloc(24);
    if (
      !win.information(second, 9, secondAttributes, secondAttributes.length) ||
      (secondAttributes.readUInt32LE(0) & (0x400 | 0x10)) !== 0 ||
      win.fileType(second) !== 1 ||
      !win.information(second, 18, secondIdentity, secondIdentity.length) ||
      !firstIdentity.equals(secondIdentity)
    ) {
      return { status: 'unreadable' };
    }
    const basic = Buffer.alloc(40);
    if (!win.information(second, 0, basic, basic.length)) return { status: 'unreadable' };
    const modified = Buffer.from(basic.subarray(16, 24));
    const mtimeMs = Number((modified.readBigInt64LE() - 116444736000000000n) / 10000n);
    const buffer = Buffer.alloc(limit + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const bytesRead = Buffer.alloc(4);
      if (!win.read(second, buffer.subarray(filled), buffer.length - filled, bytesRead, null))
        return { status: 'unreadable' };
      const count = bytesRead.readUInt32LE(0);
      if (count === 0) break;
      filled += count;
    }
    if (filled > limit) return { status: 'too-large' };
    return {
      status: 'present',
      content: buffer.subarray(0, filled),
      identity: secondIdentity,
      modified,
      mtimeMs,
    };
  } finally {
    if (!invalid(second)) win.close(second);
    win.close(first);
  }
}

/** Remove only the same checked marker through its open Windows handle. */
export function removeWindowsMarker(
  path: string,
  expectedIdentity: Buffer,
  expectedModified: Buffer,
): boolean {
  const win = windowsApi();
  const handle = win.open(path, 0x10000 | 0x80, 0x1 | 0x2, null, 3, 0x02000000 | 0x00200000, null);
  if (handle === null || BigInt.asIntN(64, handle) === -1n) return false;
  try {
    const attributes = Buffer.alloc(8);
    const identity = Buffer.alloc(24);
    const basic = Buffer.alloc(40);
    if (
      !win.information(handle, 9, attributes, attributes.length) ||
      (attributes.readUInt32LE(0) & (0x400 | 0x10)) !== 0 ||
      win.fileType(handle) !== 1 ||
      !win.information(handle, 18, identity, identity.length) ||
      !identity.equals(expectedIdentity) ||
      !win.information(handle, 0, basic, basic.length) ||
      !basic.subarray(16, 24).equals(expectedModified)
    ) {
      return false;
    }
    return win.setInformation(handle, 4, Buffer.from([1]), 1);
  } finally {
    win.close(handle);
  }
}
