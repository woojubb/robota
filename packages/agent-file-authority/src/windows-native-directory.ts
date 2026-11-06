import { authorityError } from './contracts.js';

import type { IStableRootedDirectoryEntry } from './contracts.js';
import type { IWindowsApi, TNativeHandle } from './windows-native-api.js';

const FILE_FULL_DIRECTORY_INFO = 14;
const FILE_FULL_DIRECTORY_RESTART_INFO = 15;
const ERROR_NO_MORE_FILES = 18;
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
const FILE_ATTRIBUTE_DEVICE = 0x40;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const BUFFER_BYTES = 64 * 1024;
const NAME_OFFSET = 68;

/** Decode a FILE_FULL_DIR_INFO page, refusing malformed offsets before reading the next entry. */
export function decodeWindowsDirectoryPage(buffer: Buffer): readonly IStableRootedDirectoryEntry[] {
  const entries: IStableRootedDirectoryEntry[] = [];
  let offset = 0;
  for (;;) {
    if (offset + NAME_OFFSET > buffer.length) throw authorityError('HOST_IO', 'decode-directory');
    const next = buffer.readUInt32LE(offset);
    const attributes = buffer.readUInt32LE(offset + 56);
    const nameBytes = buffer.readUInt32LE(offset + 60);
    const limit = next === 0 ? buffer.length : offset + next;
    if (
      limit > buffer.length ||
      (next !== 0 && (next < NAME_OFFSET || next % 8 !== 0)) ||
      nameBytes === 0 ||
      nameBytes % 2 !== 0 ||
      offset + NAME_OFFSET + nameBytes > limit
    ) {
      throw authorityError('HOST_IO', 'decode-directory');
    }
    const name = buffer.toString('utf16le', offset + NAME_OFFSET, offset + NAME_OFFSET + nameBytes);
    if (name.includes('\0') || name.includes('/') || name.includes('\\')) {
      throw authorityError('HOST_IO', 'decode-directory');
    }
    if (name !== '.' && name !== '..') {
      const kind =
        (attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0
          ? 'link'
          : (attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0
            ? 'directory'
            : (attributes & FILE_ATTRIBUTE_DEVICE) !== 0
              ? 'other'
              : 'file';
      entries.push({ name, kind });
    }
    if (next === 0) return entries;
    offset += next;
  }
}

/** Enumerate the retained directory handle rather than reopening its name. */
export function readWindowsDirectory(
  api: Pick<IWindowsApi, 'getDirectoryInfo' | 'getLastError'>,
  handle: TNativeHandle,
): readonly IStableRootedDirectoryEntry[] {
  const entries: IStableRootedDirectoryEntry[] = [];
  const buffer = Buffer.alloc(BUFFER_BYTES);
  let infoClass = FILE_FULL_DIRECTORY_RESTART_INFO;
  for (;;) {
    buffer.fill(0);
    if (!api.getDirectoryInfo(handle, infoClass, buffer, buffer.length)) {
      const code = api.getLastError();
      if (code === ERROR_NO_MORE_FILES) return entries;
      throw authorityError('HOST_IO', 'list-directory', { hostCode: `WIN32_${code}` });
    }
    entries.push(...decodeWindowsDirectoryPage(buffer));
    infoClass = FILE_FULL_DIRECTORY_INFO;
  }
}
