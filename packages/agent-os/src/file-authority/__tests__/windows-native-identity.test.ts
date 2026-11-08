import * as koffi from 'koffi';
import { describe, expect, it } from 'vitest';

import { queryWindowsIdentity } from '../windows-native-read.js';

import type { IWindowsApi, IWindowsFileIdInfo } from '../windows-native-api.js';

const identityType = koffi.struct('RootedDirectoryIdentityTest', {
  VolumeSerialNumber: 'uint64_t',
  FileId: koffi.array('uint8_t', 16, 'Typed'),
});

function apiReturning(
  info: IWindowsFileIdInfo,
): Pick<IWindowsApi, 'fileIdInfoType' | 'getFileIdInfo' | 'getLastError'> {
  return {
    fileIdInfoType: identityType,
    getFileIdInfo: (_handle, _kind, output) => {
      Object.assign(output, info);
      return true;
    },
    getLastError: () => 0,
  };
}

describe('Windows native identity validation', () => {
  const valid = { VolumeSerialNumber: 1n, FileId: Uint8Array.from([1, ...new Array(15).fill(0)]) };
  it('refuses an unavailable volume identity', () => {
    expect(() =>
      queryWindowsIdentity(apiReturning({ FileId: valid.FileId }), 1n, 'test'),
    ).toThrow();
  });
  it('refuses a truncated native file ID', () => {
    expect(() =>
      queryWindowsIdentity(apiReturning({ ...valid, FileId: new Uint8Array(8) }), 1n, 'test'),
    ).toThrow();
  });
  it('refuses a numeric volume identity too large to represent exactly', () => {
    expect(() =>
      queryWindowsIdentity(
        apiReturning({ ...valid, VolumeSerialNumber: Number.MAX_SAFE_INTEGER + 1 }),
        1n,
        'test',
      ),
    ).toThrow();
  });
  it.each([0, 255])('refuses a sentinel file ID filled with %s', (byte) => {
    expect(() =>
      queryWindowsIdentity(
        apiReturning({ ...valid, FileId: new Uint8Array(16).fill(byte) }),
        1n,
        'test',
      ),
    ).toThrow();
  });
  it('accepts a complete native identity', () => {
    expect(() => queryWindowsIdentity(apiReturning(valid), 1n, 'test')).not.toThrow();
  });
});
