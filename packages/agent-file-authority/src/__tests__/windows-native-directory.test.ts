import { describe, expect, it } from 'vitest';

import { decodeWindowsDirectoryPage, readWindowsDirectory } from '../windows-native-directory.js';

function entry(
  buffer: Buffer,
  offset: number,
  name: string,
  attributes: number,
  next: number,
): void {
  const encoded = Buffer.from(name, 'utf16le');
  buffer.writeUInt32LE(next, offset);
  buffer.writeUInt32LE(attributes, offset + 56);
  buffer.writeUInt32LE(encoded.length, offset + 60);
  encoded.copy(buffer, offset + 68);
}

describe('Windows directory page decoding', () => {
  it('decodes paged names and kinds without returning dot entries', () => {
    const page = Buffer.alloc(512);
    entry(page, 0, '.', 0x10, 72);
    entry(page, 72, 'child', 0x10, 80);
    entry(page, 152, 'link', 0x400, 80);
    entry(page, 232, 'file.txt', 0, 0);
    expect(decodeWindowsDirectoryPage(page)).toEqual([
      { name: 'child', kind: 'directory' },
      { name: 'link', kind: 'link' },
      { name: 'file.txt', kind: 'file' },
    ]);
  });

  it('refuses malformed record offsets and names', () => {
    const invalidOffset = Buffer.alloc(128);
    entry(invalidOffset, 0, 'a', 0, 73);
    expect(() => decodeWindowsDirectoryPage(invalidOffset)).toThrow();
    const invalidLength = Buffer.alloc(128);
    entry(invalidLength, 0, 'a', 0, 0);
    invalidLength.writeUInt32LE(3, 60);
    expect(() => decodeWindowsDirectoryPage(invalidLength)).toThrow();
  });

  it('continues through pages until Windows reports no more files', () => {
    let call = 0;
    const api = {
      getDirectoryInfo: (_handle: bigint | null, info: number, output: Uint8Array) => {
        call += 1;
        if (call > 2) return false;
        expect(info).toBe(call === 1 ? 15 : 14);
        const page = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
        entry(page, 0, call === 1 ? 'first' : 'second', 0, 0);
        return true;
      },
      getLastError: () => 18,
    };
    expect(readWindowsDirectory(api, 1n)).toEqual([
      { name: 'first', kind: 'file' },
      { name: 'second', kind: 'file' },
    ]);
  });
});
